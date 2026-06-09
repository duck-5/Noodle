import logging
import requests
import datetime
import pytz
import base64
from config import MOODLE_URL, MOODLE_TOKEN, TIMEZONE, MOODLE_COURSES_LIST, PANOPTO_COURSES, COURSE_NAMES

def parse_course_metadata(course):
    """Parses academic year and semester from Moodle's idnumber or shortname.
    TAU idnumber structure: [8-digit Course Code]-[2-digit Group]-[4-digit Year]-[1-digit Semester]
    e.g. 03211100-01-2025-1 -> Year 2025, Semester A (1)
    """
    idnumber = course.get("idnumber", "")
    import re
    match = re.match(r'^(\d{8})-(\d{2})-(\d{4})-(\d)$', idnumber)
    if match:
        course_code, group_id, year, semester = match.groups()
        semester_map = {"1": "SemesterA", "2": "SemesterB", "0": "Yearly"}
        worksheet_name = f"{year}-{semester_map.get(semester, 'SemesterA')}"
        return {
            "course_id": f"{course_code}{group_id}",
            "year": year,
            "semester_code": semester,
            "semester_name": "Semester A" if semester == "1" else "Semester B" if semester == "2" else "Yearly",
            "worksheet_name": worksheet_name
        }
    return None

def get_enrolled_courses(moodle_url=None, moodle_token=None):
    """Fetches the list of enrolled courses for the current user from Moodle."""
    url = moodle_url or MOODLE_URL
    token = moodle_token or MOODLE_TOKEN
    # First, fetch site info to retrieve the user's ID
    site_info_params = {
        "wstoken": token,
        "wsfunction": "core_webservice_get_site_info",
        "moodlewsrestformat": "json"
    }
    try:
        response = requests.get(url, params=site_info_params)
        response.raise_for_status()
        site_info = response.json()
        
        if "exception" in site_info:
            logging.error(f"Moodle API Error fetching site info: {site_info.get('message', site_info)}")
            return []
            
        if "errorcode" in site_info:
            logging.error(f"Moodle API Error fetching site info: {site_info.get('errorcode')} - {site_info.get('message', '')}")
            return []
            
        userid = site_info.get("userid")
        if not userid:
            logging.error("Could not retrieve user ID from Moodle.")
            return []
            
        # Second, fetch the courses enrolled by this user
        courses_params = {
            "wstoken": token,
            "wsfunction": "core_enrol_get_users_courses",
            "moodlewsrestformat": "json",
            "userid": userid
        }
        response = requests.get(url, params=courses_params)
        response.raise_for_status()
        courses = response.json()
        
        if isinstance(courses, dict) and "exception" in courses:
            logging.error(f"Moodle API Error fetching enrolled courses: {courses.get('message', courses)}")
            return []
            
        if isinstance(courses, dict) and "errorcode" in courses:
            logging.error(f"Moodle API Error fetching enrolled courses: {courses.get('errorcode')} - {courses.get('message', '')}")
            return []
            
        return courses
    except Exception as e:
        logging.error(f"Failed to fetch enrolled courses from Moodle: {e}")
        return []

def get_pending_assignments(moodle_url=None, moodle_token=None):
    """Fetches assignments from Moodle and checks their submission status."""
    url = moodle_url or MOODLE_URL
    token = moodle_token or MOODLE_TOKEN
    
    # 1. Fetch enrolled courses to build a complete course mapping
    enrolled_courses = get_enrolled_courses(moodle_url=url, moodle_token=token)
    course_mapping = {}
    course_metadata = {}
    
    for course in enrolled_courses:
        shortname = course.get('shortname', '')
        if not shortname:
            continue
            
        # Cleanly extract course ID and English Name from messy Moodle string
        # e.g., "0368111801 - מתמטיקה בדידה 10368111801 - Discrete Mathematics 1"
        parts = shortname.split('-')
        if len(parts) >= 2:
            course_id_extracted = parts[0].strip()
        else:
            course_id_extracted = str(course.get('id', ''))

        # Use user-defined COURSE_{id} name if available, else derive from shortname
        resolved_name = COURSE_NAMES.get(course_id_extracted)
        if resolved_name:
            course_display_name = resolved_name
        elif len(parts) >= 2:
            course_english = parts[-1].strip()
            course_display_name = f"{course_id_extracted} - {course_english}"
        else:
            course_display_name = shortname
        course_mapping[course_id_extracted] = course_display_name
        
        parsed = parse_course_metadata(course)
        if parsed:
            metadata_info = {
                **parsed,
                "display_name": course_display_name
            }
            course_metadata[course_id_extracted] = metadata_info
            course_metadata[course_display_name] = metadata_info

    # 2. Fetch assignments
    params = {
        "wstoken": token,
        "wsfunction": "mod_assign_get_assignments",
        "moodlewsrestformat": "json"
    }
    
    response = requests.get(url, params=params)
    response.raise_for_status()
    data = response.json()
    
    if "exception" in data:
        logging.error(f"Moodle API Error: {data.get('message', data)}")
        return [], course_mapping, {}
        
    if "errorcode" in data:
        logging.error(f"Moodle API Error: {data.get('errorcode')} - {data.get('message', '')}")
        return [], course_mapping, {}

    courses = data.get('courses', [])
    logging.info(f"Moodle returned {len(courses)} courses with assignments data.")
    
    tz = pytz.timezone(TIMEZONE)
    now = datetime.datetime.now(tz)
    pending_assignments = []
    
    for course in courses:
        shortname = course.get('shortname', 'Unknown')
        
        if MOODLE_COURSES_LIST:
            if not any(c in shortname for c in MOODLE_COURSES_LIST):
                continue
        
        # Cleanly extract course ID and display name
        parts = shortname.split('-')
        if len(parts) >= 2:
            course_id_extracted = parts[0].strip()
        else:
            course_id_extracted = str(course.get('id', ''))
            
        course_display_name = course_mapping.get(course_id_extracted)
        if not course_display_name:
            resolved_name = COURSE_NAMES.get(course_id_extracted)
            if resolved_name:
                course_display_name = resolved_name
            elif len(parts) >= 2:
                course_english = parts[-1].strip()
                course_display_name = f"{course_id_extracted} - {course_english}"
            else:
                course_display_name = shortname
            course_mapping[course_id_extracted] = course_display_name
                
        assignments = course.get('assignments', [])
        logging.info(f"Course '{course_display_name}' has {len(assignments)} assignments.")
        
        for assign in assignments:
            title = assign['name']
            
            # Avoid garbage data
            if len(title) < 5 or not any(c.isalpha() for c in title):
                continue
                
            opened_str = ""
            if 'allowsubmissionsfromdate' in assign and assign['allowsubmissionsfromdate'] > 0:
                opened = datetime.datetime.fromtimestamp(assign['allowsubmissionsfromdate'], tz)
                opened_str = opened.strftime('%Y-%m-%d %H:%M:%S')
            
            # Fetch specific submission status for the assignment
            status = "Assigned"
            try:
                s_resp = requests.get(url, params={
                    "wstoken": token,
                    "wsfunction": "mod_assign_get_submission_status",
                    "moodlewsrestformat": "json",
                    "assignid": assign['id']
                }).json()
                
                sub_status = s_resp.get('lastattempt', {}).get('submission', {}).get('status', 'new')
                
                if sub_status == 'submitted':
                    status = 'Submitted'
                else:
                    status = 'Assigned'
                    
                # Attempt to extract personal extension date
                extension_ts = s_resp.get('lastattempt', {}).get('extensionduedate', 0)
            except Exception as e:
                logging.warning(f"Could not fetch status for {title}: {e}")
                extension_ts = 0
                
            # The true deadline is the latest of the nominal due date, the strict cutoff date, or a personal extension
            due_ts = assign.get('duedate', 0)
            cutoff_ts = assign.get('cutoffdate', 0)
            
            # Ensure they are numbers
            due_ts = due_ts if isinstance(due_ts, int) else 0
            cutoff_ts = cutoff_ts if isinstance(cutoff_ts, int) else 0
            extension_ts = extension_ts if isinstance(extension_ts, int) else 0
            
            final_deadline_ts = max(due_ts, cutoff_ts, extension_ts)
            
            # If the true deadline has passed and it's not submitted, it's overdue
            if final_deadline_ts > 0:
                deadline = datetime.datetime.fromtimestamp(final_deadline_ts, tz)
                deadline_str = deadline.strftime('%Y-%m-%d %H:%M:%S')
                if status != 'Submitted' and deadline < now:
                    status = 'Not submitted'
            else:
                # No due date set — avoid Jan 1 1970 epoch artifact
                deadline_str = ''
            
            link = f"https://moodle.tau.ac.il/mod/assign/view.php?id={assign.get('cmid', '')}"
            
            pending_assignments.append({
                "course_id": course['id'],
                "course_name": course_display_name,
                "assignment_name": title,
                "deadline": deadline_str,
                "opened": opened_str,
                "timestamp": assign['duedate'],
                "link": link,
                "status": status,
                "id": assign.get("id"),
                "cmid": assign.get("cmid")
            })
                
    return pending_assignments, course_mapping, course_metadata

def get_assignment_grades(enrolled_courses, moodle_url=None, moodle_token=None):
    """Fetches per-assignment grades from Moodle for the current user.

    Uses gradereport_user_get_grade_items (one call per course) and returns a
    dict keyed by cmid (int) so google_client can look up a grade by the same
    cmid already embedded in each assignment's Moodle link URL.

    Return structure:
        {
            <cmid>: {
                "gradeformatted": "85.00",   # "-" when not yet graded
                "graderaw":       85.0,       # None when not yet graded
                "grademax":       100,
                "gradeishidden":  False,
            },
            ...
        }
    """
    url = moodle_url or MOODLE_URL
    token = moodle_token or MOODLE_TOKEN
    
    # We need the logged-in user's ID
    try:
        site_info = requests.get(url, params={
            "wstoken": token,
            "wsfunction": "core_webservice_get_site_info",
            "moodlewsrestformat": "json"
        }).json()
        userid = site_info.get("userid")
        if not userid:
            logging.error("get_assignment_grades: could not retrieve user ID.")
            return {}
    except Exception as e:
        logging.error(f"get_assignment_grades: failed to fetch site info: {e}")
        return {}

    grades_by_cmid = {}

    for course in enrolled_courses:
        course_id = course.get("id")
        if not course_id:
            continue
        try:
            resp = requests.get(url, params={
                "wstoken": token,
                "wsfunction": "gradereport_user_get_grade_items",
                "moodlewsrestformat": "json",
                "courseid": course_id,
                "userid": userid
            })
            resp.raise_for_status()
            data = resp.json()

            if "exception" in data or "errorcode" in data:
                # Some courses may not have gradebook access — silently skip
                continue

            for usergrade in data.get("usergrades", []):
                for item in usergrade.get("gradeitems", []):
                    # Only care about assignment-type grade items with a cmid
                    if item.get("itemtype") != "mod" or item.get("itemmodule") != "assign":
                        continue
                    cmid = item.get("cmid")
                    if not cmid:
                        continue
                    grades_by_cmid[int(cmid)] = {
                        "gradeformatted": item.get("gradeformatted", "-"),
                        "graderaw":       item.get("graderaw"),       # None = not yet graded
                        "grademax":       item.get("grademax", 100),
                        "gradeishidden":  item.get("gradeishidden", False),
                    }
        except Exception as e:
            logging.warning(f"get_assignment_grades: error fetching grades for course {course_id}: {e}")
            continue

    logging.info(f"Fetched grades for {len(grades_by_cmid)} assignments across all courses.")
    return grades_by_cmid


def get_course_contents(course_id, moodle_url=None, moodle_token=None):
    """Fetches the contents of a specific course."""
    url = moodle_url or MOODLE_URL
    token = moodle_token or MOODLE_TOKEN
    try:
        resp = requests.get(url, params={
            "wstoken": token,
            "wsfunction": "core_course_get_contents",
            "moodlewsrestformat": "json",
            "courseid": course_id
        })
        resp.raise_for_status()
        data = resp.json()
        if "exception" in data or "errorcode" in data:
            logging.error(f"Error fetching course contents: {data}")
            return []
        return data
    except Exception as e:
        logging.error(f"Error fetching course contents for {course_id}: {e}")
        return []

def get_course_contents(course_id, moodle_url=None, moodle_token=None):
    """Calls core_course_get_contents for a specific course."""
    url = moodle_url or MOODLE_URL
    token = moodle_token or MOODLE_TOKEN
    params = {
        "wstoken": token,
        "wsfunction": "core_course_get_contents",
        "moodlewsrestformat": "json",
        "courseid": course_id
    }
    try:
        response = requests.get(url, params=params)
        response.raise_for_status()
        data = response.json()
        if isinstance(data, dict) and ("exception" in data or "errorcode" in data):
            logging.error(f"Error fetching course contents: {data}")
            return []
        return data
    except Exception as e:
        logging.error(f"Failed to fetch course contents for {course_id}: {e}")
        return []

def get_course_files(course_id, moodle_url=None, moodle_token=None):
    """Extracts downloadable files from course contents."""
    contents = get_course_contents(course_id, moodle_url=moodle_url, moodle_token=moodle_token)
    files = []
    for section in contents:
        section_name = section.get("name", "")
        for module in section.get("modules", []):
            if module.get("modname") == "resource" and "contents" in module:
                for content in module["contents"]:
                    if content.get("type") == "file":
                        files.append({
                            "file_name": content.get("filename", ""),
                            "file_url": content.get("fileurl", ""),
                            "file_size": content.get("filesize", 0),
                            "mime_type": content.get("mimetype", "application/octet-stream"),
                            "section_name": section_name,
                            "time_modified": content.get("timemodified", 0)
                        })
    return files

def get_course_meetings(course_id, moodle_url=None, moodle_token=None):
    """Extracts Zoom meetings from course contents."""
    contents = get_course_contents(course_id, moodle_url=moodle_url, moodle_token=moodle_token)
    meetings = []
    for section in contents:
        section_name = section.get("name", "")
        for module in section.get("modules", []):
            modname = module.get("modname")
            name = module.get("name", "").lower()
            
            # Zoom LTI or URL checking
            is_zoom = False
            meeting_url = ""
            
            if modname == "lti":
                if "zoom" in name:
                    is_zoom = True
                    meeting_url = module.get("url", "")
            elif modname == "url":
                contents_list = module.get("contents", [])
                for content in contents_list:
                    if content.get("type") == "url":
                        m_url = content.get("fileurl", "")
                        if "zoom.us" in m_url or "zoom." in m_url or any(kw in name for kw in ["zoom", "meeting", "שיעור", "הרצאה"]):
                            is_zoom = True
                            meeting_url = m_url
                            break
            
            if is_zoom and meeting_url:
                meetings.append({
                    "title": module.get("name", ""),
                    "meeting_url": meeting_url,
                    "section_name": section_name,
                    "type": "zoom"
                })
    return meetings

def download_file(file_url, moodle_token):
    """Downloads a file from Moodle's pluginfile.php by appending the token."""
    separator = "&" if "?" in file_url else "?"
    url = f"{file_url}{separator}token={moodle_token}"
    response = requests.get(url, stream=True)
    response.raise_for_status()
    return response

def upload_submission(assign_id, file_content_b64, filename, user_id, moodle_url=None, moodle_token=None):
    """Uploads a file to the Moodle draft area and links it to assignment."""
    url = moodle_url or MOODLE_URL
    token = moodle_token or MOODLE_TOKEN
    
    try:
        params = {
            "wstoken": token,
            "wsfunction": "core_files_upload",
            "moodlewsrestformat": "json",
            "component": "user",
            "filearea": "draft",
            "itemid": 0,
            "filepath": "/",
            "filename": filename,
            "filecontent": file_content_b64
        }
        
        response = requests.post(url, data=params)
        response.raise_for_status()
        data = response.json()
        
        if isinstance(data, dict) and ("exception" in data or "errorcode" in data):
            return {"success": False, "message": data.get("message", "Moodle upload error")}
            
        itemid = data.get("itemid")
        if not itemid:
            return {"success": False, "message": "Failed to get itemid from Moodle"}
            
        save_params = {
            "wstoken": token,
            "wsfunction": "mod_assign_save_submission",
            "moodlewsrestformat": "json",
            "assignmentid": assign_id,
            "plugindata[files_filemanager]": itemid
        }
        response = requests.post(url, data=save_params)
        response.raise_for_status()
        save_data = response.json()
        
        if isinstance(save_data, dict) and ("exception" in save_data or "errorcode" in save_data):
            return {"success": False, "message": save_data.get("message", "Moodle save submission error")}
            
        return {"success": True, "message": "File uploaded and linked successfully", "itemid": itemid}
    except Exception as e:
        return {"success": False, "message": f"Upload failed: {e}"}

def submit_assignment(assign_id, moodle_url=None, moodle_token=None):
    """Submits the assignment for grading (locking it)."""
    url = moodle_url or MOODLE_URL
    token = moodle_token or MOODLE_TOKEN
    
    params = {
        "wstoken": token,
        "wsfunction": "mod_assign_submit_for_grading",
        "moodlewsrestformat": "json",
        "assignmentid": assign_id,
        "acceptsubmissionstatement": 1
    }
    try:
        response = requests.post(url, data=params)
        response.raise_for_status()
        data = response.json()
        
        if isinstance(data, dict) and ("exception" in data or "errorcode" in data):
            return {"success": False, "message": data.get("message", "Moodle submission error")}
            
        return {"success": True, "message": "Assignment submitted for grading"}
    except Exception as e:
        return {"success": False, "message": f"Submission failed: {e}"}