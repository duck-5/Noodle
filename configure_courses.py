import os
import re
import sys
from clients import get_enrolled_courses
from config import MOODLE_TOKEN, MOODLE_URL

def main():
    print("====================================================")
    print("    [TauTracker] Moodle Course Configurator [TauTracker]     ")
    print("====================================================\n")

    if not MOODLE_TOKEN or not MOODLE_URL:
        print("[Error] MOODLE_TOKEN or MOODLE_URL is not configured in your .env file.")
        print("Please configure your Moodle credentials first, then re-run this script.")
        sys.exit(1)

    print("Fetching your enrolled courses from Moodle...")
    enrolled_courses = get_enrolled_courses()

    if not enrolled_courses:
        print("[Error] No courses retrieved. Please check your network connection and MOODLE_TOKEN.")
        sys.exit(1)

    # Parse and sort courses
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
    print("- Press Enter to exit without making changes")
    print("----------------------------------------------------")

    user_input = input("Selection: ").strip()

    if not user_input:
        print("\nNo changes made. Exiting...")
        sys.exit(0)

    selected_indices = []
    if user_input.lower() == 'all':
        selected_indices = list(range(len(filtered_courses)))
    else:
        # Parse comma-separated numbers
        try:
            parts = [p.strip() for p in user_input.split(',')]
            for part in parts:
                if not part:
                    continue
                idx = int(part) - 1
                if 0 <= idx < len(filtered_courses):
                    selected_indices.append(idx)
                else:
                    print(f"[Warning] Index '{part}' is out of range. Skipping.")
        except ValueError:
            print("[Error] Invalid input format. Please enter numbers separated by commas.")
            sys.exit(1)

    if not selected_indices:
        print("[Error] No valid courses selected.")
        sys.exit(1)

    # Deduplicate selections
    selected_indices = sorted(list(set(selected_indices)))

    print("\nYou have selected the following courses:")
    for idx in selected_indices:
        cid, name, _, _, _ = filtered_courses[idx]
        print(f" * {name} (ID: {cid})")

    confirm = input("\nDo you want to save this configuration to your .env file? (y/n): ").strip().lower()
    if confirm not in ['y', 'yes']:
        print("Configuration cancelled. No changes were made.")
        sys.exit(0)

    selected_courses = [filtered_courses[idx] for idx in selected_indices]
    selected_ids = [cid for cid, _, _, _, _ in selected_courses]
    moodle_courses_str = ", ".join(selected_ids)

    # Read and update .env file
    env_path = '.env'
    if not os.path.exists(env_path):
        print(f"[Warning] {env_path} not found. Creating a new one.")
        env_lines = []
    else:
        with open(env_path, 'r', encoding='utf-8') as f:
            env_lines = f.readlines()

    # Update MOODLE_COURSES
    moodle_updated = False
    new_env_lines = []
    for line in env_lines:
        if line.strip().startswith('MOODLE_COURSES='):
            new_env_lines.append(f"MOODLE_COURSES={moodle_courses_str}\n")
            moodle_updated = True
        else:
            new_env_lines.append(line)

    if not moodle_updated:
        # Append to the end if not found
        new_env_lines.append("\n# Moodle Config: Comma-separated list of Course IDs you want to sync this semester\n")
        new_env_lines.append(f"MOODLE_COURSES={moodle_courses_str}\n")

    # Check for existing PANOPTO_COURSE_ variables in .env
    existing_panopto_keys = set()
    for line in env_lines:
        match = re.match(r'^\s*(PANOPTO_COURSE_\w+)\s*=', line)
        if match:
            existing_panopto_keys.add(match.group(1))

    # Append placeholder keys for new Panopto courses
    new_panopto_added = False
    for cid, name, _, _, _ in selected_courses:
        panopto_key = f"PANOPTO_COURSE_{cid}"
        if panopto_key not in existing_panopto_keys:
            if not new_panopto_added:
                new_env_lines.append("\n# Panopto Config: Map your courses cleanly using PANOPTO_COURSE_{ID}\n")
                new_panopto_added = True
            new_env_lines.append(f"{panopto_key}=https://tau.cloud.panopto.eu/Panopto/Pages/Sessions/List.aspx#view=0&folderID=\"PASTE_UUID_HERE\"\n")
            print(f"[+] Added Panopto placeholder for: {name}")

    with open(env_path, 'w', encoding='utf-8') as f:
        f.writelines(new_env_lines)

    print("\n[Success] Your .env file has been updated.")
    if new_panopto_added:
        print("-> Please open your '.env' file and replace \"PASTE_UUID_HERE\" with your actual course folder UUIDs from Panopto.")
    print("You are now ready to run 'python main.py' to synchronize your selected courses!\n")

if __name__ == '__main__':
    main()
