import logging
import re
from playwright.sync_api import sync_playwright
from config import PANOPTO_URL, PANOPTO_USER, PANOPTO_PASS, PANOPTO_PID, PANOPTO_COURSES, SCRAPE_PANOPTO, COURSE_NAMES
from datetime import datetime

def get_new_lectures(course_mapping=None):
    if course_mapping is None:
        course_mapping = {}

    if not SCRAPE_PANOPTO:
        logging.info("Panopto scraping is disabled (SCRAPE_PANOPTO != 1). Skipping lecture fetch.")
        return []

    if not PANOPTO_URL or not PANOPTO_USER or not PANOPTO_PASS or not PANOPTO_PID:
        logging.error("Panopto credentials not fully configured in .env.")
        return []

    if not PANOPTO_COURSES:
        logging.warning("No PANOPTO_COURSE_ variables found in .env.")
        return []

    lectures = []
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        page = context.new_page()

        try:
            page.goto(PANOPTO_URL)
            page.wait_for_selector("#PageContentPlaceholder_loginControl_externalLoginButton", timeout=15000)
            page.click("#PageContentPlaceholder_loginControl_externalLoginButton")
            
            page.wait_for_selector("#Ecom_User_ID", timeout=15000)
            page.fill("#Ecom_User_ID", PANOPTO_USER)
            page.fill("#Ecom_User_Pid", PANOPTO_PID)
            page.fill("#Ecom_Password", PANOPTO_PASS)
            page.press("#Ecom_Password", "Enter")
            
            page.wait_for_url("**/Panopto/Pages/**", timeout=20000)
            
            for course_key, course_url in PANOPTO_COURSES.items():
                raw_key = course_key.replace("PANOPTO_COURSE_", "")

                # Priority: 1) COURSE_{id} env variable, 2) course_mapping from Moodle, 3) raw key
                course_name = COURSE_NAMES.get(raw_key)
                if not course_name:
                    for mapped_id, mapped_name in course_mapping.items():
                        if raw_key in mapped_id or mapped_id in raw_key:
                            course_name = mapped_name
                            break
                if not course_name:
                    course_name = raw_key.replace("_", " ")
                    
                logging.info(f"Scraping Panopto course: {course_name}")
                
                try:
                    page.goto(course_url)
                    page.wait_for_load_state('networkidle', timeout=15000)
                    page.wait_for_timeout(3000)
                    
                    extracted = page.evaluate(r'''() => {
                        const results = [];
                        document.querySelectorAll('.detail-title, .list-title').forEach(el => {
                            if (el.tagName !== 'A') return;
                            
                            const parent = el.closest('tr') || el.closest('div.item') || el.closest('li') || el.parentElement.parentElement;
                            let dateStr = "";
                            if (parent) {
                                const dateContainer = parent.querySelector('.date-time-container');
                                if (dateContainer) {
                                    dateStr = dateContainer.innerText.replace(/\n/g, ' ').trim();
                                } else {
                                    const dateEl = parent.querySelector('[class*="date"], [class*="Date"]');
                                    if (dateEl) {
                                        dateStr = dateEl.innerText.replace(/\n/g, ' ').trim();
                                    } else {
                                        const text = parent.innerText.replace(/\n/g, ' ');
                                        const match = text.match(/\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4}(?:\s+\d{1,2}:\d{2}(?:\s*(?:AM|PM|am|pm))?)?/);
                                        if (match) dateStr = match[0];
                                    }
                                }
                            }
                            
                            if (dateStr) {
                                dateStr = dateStr.replace(/^date:/i, '').trim();
                            }
                            
                            results.push({
                                title: el.innerText.trim(),
                                link: el.href || '',
                                date: dateStr
                            });
                        });
                        return results;
                    }''')
                    
                    for item in extracted:
                        title = item['title']
                        link = item['link']
                        date_str = item['date']
                        
                        # Prevent garbage titles
                        if not title or len(title) < 5 or not any(c.isalpha() for c in title):
                            continue
                            
                        formatted_date = ""
                        if date_str:
                            try:
                                dt = datetime.strptime(date_str, "%m/%d/%Y %I:%M %p")
                                formatted_date = dt.strftime("%m/%d/%Y %H:%M:%S")
                            except:
                                try:
                                    dt = datetime.strptime(date_str, "%m/%d/%Y")
                                    formatted_date = dt.strftime("%m/%d/%Y 00:00:00")
                                except:
                                    formatted_date = date_str
                        else:
                            formatted_date = datetime.now().strftime("%m/%d/%Y %H:%M:%S")
                            
                        if link and not link.startswith("http"):
                            link = f"{PANOPTO_URL}{link}" if link.startswith("/") else f"{PANOPTO_URL}/{link}"
                        
                        lectures.append({
                            "course_name": course_name,
                            "lecture_title": title,
                            "recording_link": link,
                            "published_date": formatted_date
                        })
                except Exception as e:
                    logging.error(f"Error scraping course {course_name}: {e}")
                    
        except Exception as e:
            logging.error(f"Playwright Panopto error during SSO: {e}")
        finally:
            browser.close()

    # --- Filtering Logic for Duplicates ---
    def parse_dt(dt_str):
        try:
            return datetime.strptime(dt_str, "%m/%d/%Y %H:%M:%S")
        except:
            return datetime.min

    filtered_lectures = []
    courses_dict = {}
    for lec in lectures:
        courses_dict.setdefault(lec['course_name'], []).append(lec)

    for c_name, lecs in courses_dict.items():
        series_groups = {}
        standalone = []

        for lec in lecs:
            title = lec['lecture_title']
            
            # Check if it's a recitation
            is_recitation = 'tirgul' in title.lower() or 'תרגול' in title
            
            if is_recitation:
                # Identify the series base like "תרגול 3"
                series_match = re.search(r'(תרגול|תרגיל|Recitation|Tirgul)\s*[-:]?\s*(\d+)', title, re.IGNORECASE)
                
                if series_match:
                    series_key = f"{series_match.group(1).capitalize()} {series_match.group(2)}"
                    
                    # Identify the "group" by stripping any "part" suffix (e.g. חלק 1, part 2, a, b)
                    part_regex = r'(?i)(\s*[-:]?\s*\(?(?:חלק\s*\d+|part\s*\d+|[a-c])\)?\s*)$'
                    group_id = re.sub(part_regex, '', title).strip()
                    
                    series_groups.setdefault(series_key, {}).setdefault(group_id, []).append(lec)
                else:
                    standalone.append(lec)
            else:
                standalone.append(lec)
                
        # Resolve the winner for each series
        for series_key, groups in series_groups.items():
            best_group = None
            max_dt = datetime.min
            
            for g_id, g_lecs in groups.items():
                g_max_dt = max([parse_dt(l['published_date']) for l in g_lecs])
                if best_group is None or g_max_dt >= max_dt:
                    max_dt = g_max_dt
                    best_group = g_id
                    
            if best_group:
                filtered_lectures.extend(groups[best_group])
                
        filtered_lectures.extend(standalone)

    return filtered_lectures

def resolve_course_panopto_folders(course_ids, username, password, pid):
    """
    Automates logging into Moodle via SSO, navigating to each course's main view page,
    finding the block_panopto session viewer link, clicking/navigating to it to LTI authenticate,
    intercepting the DeliveryInfo response, and returning a mapping of course_id -> panopto_folder_link.
    """
    resolved = {}
    if not course_ids or not username or not password or not pid:
        return resolved

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        page = context.new_page()

        try:
            print("Logging into Moodle via SSO...")
            page.goto("https://moodle.tau.ac.il/login/index.php")
            
            login_btn = page.query_selector("a:has-text('התחברות'), a:has-text('Login'), .login-btn")
            if login_btn:
                login_btn.click()

            page.wait_for_selector("#Ecom_User_ID", timeout=15000)
            page.fill("#Ecom_User_ID", username)
            page.fill("#Ecom_User_Pid", pid)
            page.fill("#Ecom_Password", password)
            page.press("#Ecom_Password", "Enter")

            page.wait_for_url(lambda url: "mycourses" in url or "course" in url, timeout=20000)
            print("[Success] Successfully logged into Moodle!")

            for cid in course_ids:
                print(f"Resolving Panopto link for Moodle Course ID: {cid}...")
                course_url = f"https://moodle.tau.ac.il/course/view.php?id={cid}"
                try:
                    page.goto(course_url)
                    page.wait_for_load_state('networkidle', timeout=15000)
                    page.wait_for_timeout(3000)

                    # Find any viewer link inside block_panopto_content or general page
                    viewer_link_element = page.query_selector("a[href*='panopto.eu/Panopto/Pages/Viewer.aspx']")
                    if not viewer_link_element:
                        print(f"[-] No Panopto viewer link found for Course {cid}. Skipping.")
                        continue

                    # Set up network intercepting on the new page/tab that will open
                    delivery_info_content = None
                    
                    def handle_response(response):
                        nonlocal delivery_info_content
                        if "deliveryinfo.aspx" in response.url.lower():
                            try:
                                delivery_info_content = response.text()
                            except:
                                pass

                    # When clicking, we expect a new page to open
                    with context.expect_page(timeout=10000) as new_page_info:
                        viewer_link_element.click()
                    
                    panopto_page = new_page_info.value
                    panopto_page.on("response", handle_response)
                    
                    panopto_page.wait_for_load_state('networkidle', timeout=20000)
                    
                    # Wait up to 10 seconds for the DeliveryInfo AJAX response
                    for _ in range(20):
                        if delivery_info_content:
                            break
                        panopto_page.wait_for_timeout(500)

                    if delivery_info_content:
                        import json
                        data = json.loads(delivery_info_content)
                        delivery = data.get("Delivery", {})
                        folder_id = delivery.get("SessionGroupPublicID") or delivery.get("FolderId")
                        if folder_id:
                            folder_link = f"https://tau.cloud.panopto.eu/Panopto/Pages/Sessions/List.aspx#folderID=\"{folder_id}\""
                            resolved[cid] = folder_link
                            print(f"[+] Successfully resolved Panopto link for Course {cid}!")
                        else:
                            print(f"[-] Found DeliveryInfo but no Folder ID for Course {cid}.")
                    else:
                        print(f"[-] Failed to capture DeliveryInfo network request for Course {cid}.")
                    
                    try:
                        panopto_page.close()
                    except:
                        pass
                except Exception as ex:
                    print(f"[-] Error during auto-resolution of Course {cid}: {ex}")

        except Exception as e:
            print(f"[-] Error during Moodle/Panopto login flow: {e}")
        finally:
            browser.close()

    return resolved