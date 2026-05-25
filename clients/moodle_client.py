import logging
import requests
import datetime
import pytz
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

def get_enrolled_courses():
    """Fetches the list of enrolled courses for the current user from Moodle."""
    # First, fetch site info to retrieve the user's ID
    site_info_params = {
        "wstoken": MOODLE_TOKEN,
        "wsfunction": "core_webservice_get_site_info",
        "moodlewsrestformat": "json"
    }
    try:
        response = requests.get(MOODLE_URL, params=site_info_params)
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
            "wstoken": MOODLE_TOKEN,
            "wsfunction": "core_enrol_get_users_courses",
            "moodlewsrestformat": "json",
            "userid": userid
        }
        response = requests.get(MOODLE_URL, params=courses_params)
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

def get_pending_assignments():
    """Fetches assignments from Moodle and checks their submission status."""
    # 1. Fetch enrolled courses to build a complete course mapping
    enrolled_courses = get_enrolled_courses()
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
        "wstoken": MOODLE_TOKEN,
        "wsfunction": "mod_assign_get_assignments",
        "moodlewsrestformat": "json"
    }
    
    response = requests.get(MOODLE_URL, params=params)
    response.raise_for_status()
    data = response.json()
    
    if "exception" in data:
        logging.error(f"Moodle API Error: {data.get('message', data)}")
        return [], course_mapping
        
    if "errorcode" in data:
        logging.error(f"Moodle API Error: {data.get('errorcode')} - {data.get('message', '')}")
        return [], course_mapping

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
                s_resp = requests.get(MOODLE_URL, params={
                    "wstoken": MOODLE_TOKEN,
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
            deadline = datetime.datetime.fromtimestamp(final_deadline_ts, tz)
            
            # If the true deadline has passed and it's not submitted, it's overdue
            if status != 'Submitted' and deadline < now:
                status = 'Not submitted'
            
            link = f"https://moodle.tau.ac.il/mod/assign/view.php?id={assign.get('cmid', '')}"
            
            pending_assignments.append({
                "course_id": course['id'],
                "course_name": course_display_name,
                "assignment_name": title,
                "deadline": deadline.strftime('%Y-%m-%d %H:%M:%S'),
                "opened": opened_str,
                "timestamp": assign['duedate'],
                "link": link,
                "status": status
            })
                
    return pending_assignments, course_mapping, course_metadata