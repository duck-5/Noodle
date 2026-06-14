import sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

import logging
import time
import schedule
from clients import get_pending_assignments, get_enrolled_courses, get_new_lectures, get_google_services, sync_data, get_assignment_grades
from config import VERSION

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("TauTracker.log", encoding='utf-8'),
        logging.StreamHandler(sys.stdout)
    ]
)

def job():
    logging.info(f"--- Starting TauTracker v{VERSION} Sync ---")
    try:
        # Fetch data
        logging.info("Fetching Moodle assignments...")
        assignments, course_mapping, course_metadata = get_pending_assignments()
        enrolled_courses = list(course_metadata.values())  # reuse already-fetched course list

        logging.info("Fetching Panopto lectures...")
        lectures = get_new_lectures(course_mapping)

        logging.info("Fetching Moodle grades...")
        # enrolled_courses values may be duplicated (keyed by both id and name) — dedupe by course id
        seen_ids = set()
        unique_courses = []
        for meta in course_metadata.values():
            cid = meta.get("course_id")
            if cid and cid not in seen_ids:
                seen_ids.add(cid)
                unique_courses.append({"id": int(cid)})
        grades_by_cmid = get_assignment_grades(unique_courses)

        # Sync data
        logging.info("Authenticating with Google Workspace...")
        gc, tasks_service = get_google_services()

        logging.info("Syncing to Google Sheets and Calendar...")
        sync_data(gc, tasks_service, assignments, lectures, course_metadata, grades_by_cmid)
        
        logging.info("Sync complete!")
        logging.info("-------------------------------------------\n\n")
    except Exception as e:
        logging.error(f"Critical error during sync: {e}")

def main():
    import os
    # Run once immediately
    job()
    
    # If running in a cloud CI/CD environment like GitHub Actions, exit after one run
    if os.environ.get("GITHUB_ACTIONS") == "true":
        logging.info("GitHub Actions environment detected. Exiting after single sync cycle.")
        return
        
    # Otherwise, assume local daemon and schedule to run every 5 hours automatically
    schedule.every(5).hours.do(job)
    
    logging.info("TauTracker Daemon is now running in the background. Waiting for next scheduled run...")
    while True:
        schedule.run_pending()
        time.sleep(60)

if __name__ == "__main__":
    main()