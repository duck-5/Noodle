from playwright.sync_api import sync_playwright
import os
import re
from dotenv import load_dotenv

load_dotenv()

USER = os.getenv("PANOPTO_USER")
PASS = os.getenv("PANOPTO_PASS")
PID = os.getenv("PANOPTO_PID")

def test_moodle_panopto():
    if not USER or not PASS or not PID:
        print("Credentials missing in .env")
        return

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        page = context.new_page()

        try:
            print("Going to Moodle login page...")
            page.goto("https://moodle.tau.ac.il/login/index.php")
            
            # Click login button to trigger TAU SSO redirect
            login_btn = page.query_selector("a:has-text('התחברות'), a:has-text('Login'), .login-btn")
            if login_btn:
                login_btn.click()
            else:
                # If already redirected or direct SSO
                pass

            # Wait for TAU SSO login fields
            page.wait_for_selector("#Ecom_User_ID", timeout=15000)
            page.fill("#Ecom_User_ID", USER)
            page.fill("#Ecom_User_Pid", PID)
            page.fill("#Ecom_Password", PASS)
            page.press("#Ecom_Password", "Enter")

            # Wait to land back on Moodle dashboard
            page.wait_for_url("**/course/**", timeout=20000)
            print("Successfully logged into Moodle!")

            # Go to specific course view page (Thermodynamics: 321110401)
            course_url = "https://moodle.tau.ac.il/course/view.php?id=321110401"
            print(f"Navigating to course page: {course_url}")
            page.goto(course_url)
            page.wait_for_load_state('networkidle', timeout=15000)
            page.wait_for_timeout(5000) # Give extra time for async blocks to load

            # Inspect the page for links containing "panopto"
            links = page.evaluate(r'''() => {
                const results = [];
                document.querySelectorAll('a').forEach(el => {
                    results.push({
                        text: el.innerText.strip ? el.innerText.strip() : el.innerText,
                        href: el.href
                    });
                });
                return results;
            }''')

            print("\nFound links containing 'panopto':")
            panopto_links = [l for l in links if "panopto" in l["href"].lower()]
            for l in panopto_links:
                print(f"- Text: {l['text']}, Href: {l['href']}")

            # Inspect the block_panopto content specifically
            block_content = page.evaluate(r'''() => {
                const el = document.getElementById("block_panopto_content");
                return el ? el.innerHTML : "Block element not found";
            }''')

            print("\nBlock Content HTML:")
            print(block_content)

        except Exception as e:
            print("Error occurred:", e)
        finally:
            browser.close()

if __name__ == "__main__":
    test_moodle_panopto()
