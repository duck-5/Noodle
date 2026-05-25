import os
import sys
import shutil
import re
import subprocess
from clients import get_enrolled_courses
from config import MOODLE_TOKEN, MOODLE_URL, SPREADSHEET_NAME, WORKSHEET_NAME

def save_env_var(key, value):
    env_path = '.env'
    if not os.path.exists(env_path):
        if os.path.exists('.env.example'):
            shutil.copy('.env.example', env_path)
        else:
            with open(env_path, 'w', encoding='utf-8') as f:
                f.write("")

    with open(env_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    updated = False
    new_lines = []
    for line in lines:
        if line.strip().startswith(f"{key}="):
            new_lines.append(f"{key}={value}\n")
            updated = True
        else:
            new_lines.append(line)

    if not updated:
        new_lines.append(f"\n{key}={value}\n")

    with open(env_path, 'w', encoding='utf-8') as f:
        f.writelines(new_lines)

def check_playwright():
    try:
        import playwright
        return True
    except ImportError:
        return False

def run_interactive_course_config():
    print("\n--- Step 3: Moodle Course Selection ---")
    print("Fetching enrolled courses from Moodle...")
    enrolled_courses = get_enrolled_courses()

    if not enrolled_courses:
        print("[Warning] Could not fetch courses from Moodle.")
        print("This might be because your MOODLE_TOKEN in .env is incorrect, or you lack internet access.")
        return False

    from clients import parse_course_metadata

    parsed_courses = []
    semester_groups = {} # "2025 - Semester B" -> list of courses
    
    for course in enrolled_courses:
        shortname = course.get('shortname', '')
        if not shortname:
            continue

        # Cleanly extract course ID and display name
        parts = shortname.split('-')
        if len(parts) >= 2:
            course_id = parts[0].strip()
            course_english = parts[-1].strip()
            course_display_name = f"{course_id} - {course_english}"
        else:
            course_id = str(course.get('id', ''))
            course_display_name = shortname

        metadata = parse_course_metadata(course)
        group_key = "Other/Yearly"
        if metadata:
            group_key = f"{metadata['year']} - {metadata['semester_name']}"

        course_item = (course_id, course_display_name, course.get('fullname', ''), group_key, course.get('startdate', 0))
        parsed_courses.append(course_item)
        semester_groups.setdefault(group_key, []).append(course_item)

    # Determine active/latest semester
    group_max_startdate = {}
    for group_key, items in semester_groups.items():
        group_max_startdate[group_key] = max((item[4] for item in items), default=0)

    sorted_groups = sorted(
        [g for g in semester_groups.keys() if g != "Other/Yearly"],
        key=lambda g: group_max_startdate[g],
        reverse=True
    )
    active_semester = sorted_groups[0] if sorted_groups else "Other/Yearly"

    print("----------------------------------------------------")
    print(f"Active Semester Detected: {active_semester}")
    print("----------------------------------------------------")
    print("Select a viewing/filtering mode:")
    print(f" [1] Show active semester courses only ({active_semester}) [RECOMMENDED]")
    print(" [2] Show all enrolled courses (including past semesters)")
    print(" [3] Search/filter courses by keyword")
    print("----------------------------------------------------")

    mode = input("Select mode [1]: ").strip()
    if not mode:
        mode = "1"

    filtered_courses = []
    if mode == "1":
        filtered_courses = semester_groups.get(active_semester, parsed_courses)
        print(f"\nShowing courses for active semester ({active_semester}):")
    elif mode == "3":
        keyword = input("Enter search keyword (e.g. course name or ID): ").strip().lower()
        filtered_courses = [c for c in parsed_courses if keyword in c[1].lower() or keyword in c[2].lower()]
        print(f"\nShowing courses matching '{keyword}':")
    else:
        filtered_courses = parsed_courses
        print("\nShowing all enrolled courses:")

    # Sort courses by display name for easier scanning
    filtered_courses.sort(key=lambda x: x[1])

    if not filtered_courses:
        print("[Warning] No courses match the filter. Showing all instead.")
        filtered_courses = parsed_courses
        filtered_courses.sort(key=lambda x: x[1])

    print(f"\nFound {len(filtered_courses)} matching courses:")
    for idx, (cid, disp_name, fullname, gkey, sdate) in enumerate(filtered_courses, 1):
        print(f"[{idx:2d}] {disp_name}")

    print("\n----------------------------------------------------")
    print("Choose which courses to synchronize:")
    print("- Enter a comma-separated list of numbers (e.g., '1, 3, 5')")
    print("- Type 'all' to select all courses")
    print("- Press Enter to skip course selection")
    print("----------------------------------------------------")

    user_input = input("Selection: ").strip()

    if not user_input:
        print("Skipped course selection.")
        return True

    selected_indices = []
    if user_input.lower() == 'all':
        selected_indices = list(range(len(filtered_courses)))
    else:
        try:
            parts = [p.strip() for p in user_input.split(',')]
            for part in parts:
                if not part:
                    continue
                idx = int(part) - 1
                if 0 <= idx < len(filtered_courses):
                    selected_indices.append(idx)
        except ValueError:
            print("[Error] Invalid format. Skipping course configuration.")
            return False

    if not selected_indices:
        print("No valid courses selected.")
        return False

    selected_indices = sorted(list(set(selected_indices)))
    selected_courses = [filtered_courses[idx] for idx in selected_indices]
    selected_ids = [cid for cid, _, _, _, _ in selected_courses]
    moodle_courses_str = ", ".join(selected_ids)

    save_env_var("MOODLE_COURSES", moodle_courses_str)
    print(f"\nSaved course IDs: {moodle_courses_str} to .env!")

    # Save a human-readable display name for each selected course
    for cid, disp_name, fullname, _, _ in selected_courses:
        # Extract just the English part as the canonical name (e.g. "Introduction to Thermodynamics")
        parts = disp_name.split(' - ', 1)
        short_name = parts[1].strip() if len(parts) == 2 else disp_name
        course_key = f"COURSE_{cid}"
        save_env_var(course_key, short_name)
        os.environ[course_key] = short_name
        print(f"[+] Saved {course_key}={short_name}")

    # Check/Append Panopto placeholders or auto-resolve them
    env_lines = []
    if os.path.exists('.env'):
        with open('.env', 'r', encoding='utf-8') as f:
            env_lines = f.readlines()

    existing_panopto_keys = set()
    for line in env_lines:
        match = re.match(r'^\s*(PANOPTO_COURSE_\w+)\s*=', line)
        if match:
            existing_panopto_keys.add(match.group(1))

    # --- University SSO Credentials Setup ---
    from dotenv import load_dotenv
    load_dotenv(override=True)

    # Step A: Migrate legacy PANOPTO_USER / PANOPTO_PASS / PANOPTO_PID keys if present
    legacy_map = {
        "PANOPTO_USER": "UNIVERSITY_USERNAME",
        "PANOPTO_PASS": "UNIVERSITY_PASSWORD",
        "PANOPTO_PID": "STUDENT_ID",
    }
    migrated = False
    for old_key, new_key in legacy_map.items():
        old_val = os.getenv(old_key, "").strip()
        new_val = os.getenv(new_key, "").strip()
        if old_val and not new_val:
            save_env_var(new_key, old_val)
            os.environ[new_key] = old_val
            # Remove the legacy key from .env (best effort)
            if os.path.exists('.env'):
                with open('.env', 'r', encoding='utf-8') as f:
                    raw = f.readlines()
                with open('.env', 'w', encoding='utf-8') as f:
                    for l in raw:
                        if not l.strip().startswith(f"{old_key}="):
                            f.write(l)
            migrated = True
    if migrated:
        print("\n[+] Migrated legacy credential keys to new names (UNIVERSITY_USERNAME / UNIVERSITY_PASSWORD / STUDENT_ID).")
        load_dotenv(override=True)

    # Step B: Load new credential keys
    panopto_user = os.getenv("UNIVERSITY_USERNAME", "").strip()
    panopto_pass = os.getenv("UNIVERSITY_PASSWORD", "").strip()
    panopto_pid = os.getenv("STUDENT_ID", "").strip()

    to_resolve_cids = [cid for cid, _, _, _, _ in selected_courses if f"PANOPTO_COURSE_{cid}" not in existing_panopto_keys]

    # Step C: If credentials are missing and there are courses to resolve, prompt the user
    if to_resolve_cids and not (panopto_user and panopto_pass and panopto_pid):
        print("\n----------------------------------------------------")
        print("  University SSO Credentials (Optional but Recommended)")
        print("----------------------------------------------------")
        print("TauTracker can automatically discover and map Panopto")
        print("lecture folder links for your selected courses.")
        print("")
        print("To do this, it needs your university (TAU) login credentials:")
        print("  - Username : Your TAU Moodle username (e.g. 'jsmith')")
        print("  - Password : Your TAU Moodle/SSO password")
        print("  - Student ID: Your Israeli ID or Passport number (used by TAU SSO)")
        print("")
        print("These credentials are only saved locally in your .env file and")
        print("are used solely to log into Moodle and fetch Panopto folder links.")
        print("If you skip this, you can always manually paste Panopto links into .env later.")
        print("----------------------------------------------------")
        ans = input("Would you like to enter your university credentials now? (y/n) [y]: ").strip().lower()
        if ans in ['y', 'yes', '']:
            entered_user = input("  University Username: ").strip()
            import getpass
            entered_pass = getpass.getpass("  University Password: ").strip()
            entered_pid  = input("  Student ID (Israeli ID / Passport): ").strip()

            if entered_user:
                save_env_var("UNIVERSITY_USERNAME", entered_user)
                os.environ["UNIVERSITY_USERNAME"] = entered_user
                panopto_user = entered_user
            if entered_pass:
                save_env_var("UNIVERSITY_PASSWORD", entered_pass)
                os.environ["UNIVERSITY_PASSWORD"] = entered_pass
                panopto_pass = entered_pass
            if entered_pid:
                save_env_var("STUDENT_ID", entered_pid)
                os.environ["STUDENT_ID"] = entered_pid
                panopto_pid = entered_pid

            if panopto_user and panopto_pass and panopto_pid:
                print("[+] University credentials saved to .env!")
            else:
                print("[!] Some credentials were left empty. Panopto auto-discovery will be skipped.")

    resolved_links = {}

    # Only attempt Panopto auto-discovery when SCRAPE_PANOPTO=1
    scrape_enabled = os.getenv("SCRAPE_PANOPTO", "0") == "1"

    if to_resolve_cids and not scrape_enabled:
        print("\n----------------------------------------------------")
        print("Panopto scraping is currently disabled (SCRAPE_PANOPTO is not set to 1).")
        print("Enabling it allows TauTracker to automatically fetch your lecture")
        print("recordings from Panopto during each sync cycle.")
        print("----------------------------------------------------")
        ans = input("Enable Panopto lecture scraping? (y/n) [y]: ").strip().lower()
        if ans in ['y', 'yes', '']:
            save_env_var("SCRAPE_PANOPTO", "1")
            os.environ["SCRAPE_PANOPTO"] = "1"
            scrape_enabled = True
            print("[+] SCRAPE_PANOPTO=1 saved to .env.")

    if to_resolve_cids and scrape_enabled and panopto_user and panopto_pass and panopto_pid:
        print("\n----------------------------------------------------")
        print("TAU SSO credentials are configured.")
        print("Would you like to automatically discover and map the")
        print("Panopto folder links for the selected courses?")
        print("----------------------------------------------------")
        ans = input("Auto-discover Panopto links? (y/n) [y]: ").strip().lower()
        if ans in ['y', 'yes', '']:
            print("\nStarting auto-resolution. This might take a few moments...")
            try:
                from clients import resolve_course_panopto_folders
                resolved_links = resolve_course_panopto_folders(to_resolve_cids, panopto_user, panopto_pass, panopto_pid)
            except Exception as e:
                print(f"[Warning] Auto-resolution failed: {e}")
                print("Falling back to placeholder links.")

    new_panopto_added = False
    new_env_lines = list(env_lines)

    for cid, name, _, _, _ in selected_courses:
        panopto_key = f"PANOPTO_COURSE_{cid}"
        if panopto_key not in existing_panopto_keys:
            if not new_panopto_added:
                new_env_lines.append("\n# Panopto Config: Map your courses cleanly using PANOPTO_COURSE_{ID}\n")
                new_panopto_added = True
            
            resolved_url = resolved_links.get(cid)
            if resolved_url:
                new_env_lines.append(f"{panopto_key}={resolved_url}\n")
                print(f"[+] Automatically mapped Panopto link for: {name}")
            else:
                new_env_lines.append(f"{panopto_key}=https://tau.cloud.panopto.eu/Panopto/Pages/Sessions/List.aspx#view=0&folderID=\"PASTE_UUID_HERE\"\n")
                print(f"[+] Appended Panopto placeholder for: {name}")

    if new_panopto_added:
        with open('.env', 'w', encoding='utf-8') as f:
            f.writelines(new_env_lines)

    return True

def main():
    print("====================================================")
    print("     [TauTracker] Setup and Configuration Wizard     ")
    print("====================================================\n")
    print("This script will guide you through configuring your Moodle ")
    print("connection, selecting courses, and authenticating with Google.\n")

    # Step 1: Ensure .env exists
    print("--- Step 1: Checking Environment File ---")
    env_path = '.env'
    if not os.path.exists(env_path):
        if os.path.exists('.env.example'):
            shutil.copy('.env.example', env_path)
            print("Created a new .env file from .env.example template.")
        else:
            with open(env_path, 'w', encoding='utf-8') as f:
                f.write("")
            print("Created a blank .env file.")
    else:
        print("Environment file (.env) exists.")

    # Step 2: Configure Moodle Connection
    print("\n--- Step 2: Moodle API Connection ---")
    current_token = os.getenv("MOODLE_TOKEN", "").strip()
    if not current_token or current_token == "your_moodle_api_key_here":
        print("Please enter your Moodle Mobile Web Service token.")
        print("(Instructions: Preferences -> Security Keys -> Reset 'Moodle mobile web service' key)")
        token = input("Moodle Token: ").strip()
        if token:
            save_env_var("MOODLE_TOKEN", token)
            # Re-load env variables for this session
            os.environ["MOODLE_TOKEN"] = token
            print("Saved Moodle token to .env!")
        else:
            print("Moodle token left unconfigured.")
    else:
        print("Moodle token is already configured in your .env file.")

    # Step 3: Interactive Course Selection
    run_interactive_course_config()

    # Step 4: Check Google Client Credentials
    print("\n--- Step 4: Google Cloud Credentials ---")
    if not os.path.exists('credentials.json'):
        print("[Error] 'credentials.json' is missing from this directory.")
        print("You must configure Google Cloud Desktop Client credentials:")
        print(" 1. Go to Google Cloud Console (https://console.cloud.google.com/)")
        print(" 2. Create a desktop application OAuth Client ID credentials.")
        print(" 3. Download the credentials JSON and save it as 'credentials.json' in this folder.")
        print(" 4. Enable Google Sheets, Tasks, and Drive APIs in the Console.\n")
        
        while not os.path.exists('credentials.json'):
            ans = input("Please place 'credentials.json' in this folder and press Enter to retry, or type 'skip': ").strip()
            if ans.lower() == 'skip':
                print("Skipped Google credentials validation.")
                break
    else:
        print("Found Google credentials.json successfully!")

    # Step 5: Google Authentication (generate token.json)
    if os.path.exists('credentials.json'):
        print("\n--- Step 5: Google Authorization Flow ---")
        if os.path.exists('token.json'):
            print("Authorization token (token.json) already exists.")
            reauth = input("Do you want to re-authenticate with Google? (y/n): ").strip().lower()
        else:
            reauth = 'y'

        if reauth in ['y', 'yes']:
            print("Starting Google OAuth authorization flow...")
            print("👉 A browser window will open. Log in with your Google account to grant permissions.")
            try:
                # Add workspace path to sys.path to ensure local imports succeed
                sys.path.append(os.getcwd())
                from clients import get_google_services
                gc, tasks_service = get_google_services()
                print("[Success] Authorized successfully! token.json has been written.")
            except Exception as e:
                print(f"[Error] Google authorization failed: {e}")
                print("You can retry this step by re-running this configurator.")

    # Step 6: Playwright Verification
    print("\n--- Step 6: Headless Browsers for Panopto ---")
    if not check_playwright():
        print("[Warning] Playwright Python module is not installed.")
        print("Please install requirements by running: pip install -r requirements.txt")
    else:
        print("Playwright is installed. Checking headless browsers...")
        install_browsers = input("Do you want to download/install Playwright browsers now? (y/n): ").strip().lower()
        if install_browsers in ['y', 'yes']:
            print("Installing Playwright headless browsers. Please wait...")
            try:
                subprocess.run([sys.executable, "-m", "playwright", "install"], check=True)
                print("[Success] Playwright browsers installed successfully!")
            except Exception as e:
                print(f"[Error] Failed to install Playwright browsers: {e}")

    # Step 7: Manual Verification test run
    print("\n--- Step 7: Setup Complete! ---")
    print("Your local TauTracker system is now configured!")
    run_test = input("Do you want to run a test synchronization cycle right now? (y/n): ").strip().lower()
    if run_test in ['y', 'yes']:
        print("Running synchronization job...")
        try:
            # Run using the python execution path to ensure logging works
            subprocess.run([sys.executable, "main.py"], check=True)
            print("\n[Success] Sync completed! Check TauTracker.log and your Google Spreadsheet.")
        except Exception as e:
            print(f"\n[Warning] Sync cycle ran but encountered issues: {e}")
            print("Check TauTracker.log for detailed execution traces.")

    print("\nThank you for using TauTracker Setup Wizard! Exiting configurator...\n")

if __name__ == '__main__':
    main()
