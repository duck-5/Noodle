import logging
import requests
import datetime
import pytz
from config import MOODLE_URL, MOODLE_TOKEN, TIMEZONE, MOODLE_COURSES_LIST, PANOPTO_COURSES

def get_pending_assignments():
    """Fetches assignments from Moodle and checks their submission status."""
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
        return []
        
    if "errorcode" in data:
        logging.error(f"Moodle API Error: {data.get('errorcode')} - {data.get('message', '')}")
        return []

    courses = data.get('courses', [])
    logging.info(f"Moodle returned {len(courses)} courses with assignments data.")
    
    tz = pytz.timezone(TIMEZONE)
    now = datetime.datetime.now(tz)
    pending_assignments = []
    course_mapping = {}
    
    for course in courses:
        shortname = course.get('shortname', 'Unknown')
        
        if MOODLE_COURSES_LIST:
            if not any(c in shortname for c in MOODLE_COURSES_LIST):
                continue
        
        # Cleanly extract course ID and English Name from messy Moodle string
        # e.g., "0368111801 - מתמטיקה בדידה 10368111801 - Discrete Mathematics 1"
        parts = shortname.split('-')
        if len(parts) >= 2:
            course_id_extracted = parts[0].strip()
            course_english = parts[-1].strip()
            course_display_name = f"{course_id_extracted} - {course_english}"
        else:
            course_id_extracted = str(course.get('id', ''))
            course_display_name = shortname
            
        course_mapping[course_id_extracted] = course_display_name
                
        assignments = course.get('assignments', [])
        logging.info(f"Course '{course_display_name}' has {len(assignments)} assignments.")
        
        for assign in assignments:
            title = assign['name']
            
            # Avoid garbage data
            if len(title) < 5 or not any(c.isalpha() for c in title):
                continue
                
            deadline = datetime.datetime.fromtimestamp(assign['duedate'], tz)
            
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
                elif deadline < now:
                    status = 'Not submitted'
                else:
                    status = 'Assigned'
            except Exception as e:
                logging.warning(f"Could not fetch status for {title}: {e}")
                if deadline < now:
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
                
    return pending_assignments, course_mapping