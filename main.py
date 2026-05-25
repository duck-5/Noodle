import logging
import time
import schedule
from moodle_client import get_pending_assignments
from panopto_client import get_new_lectures
from google_client import get_google_services, sync_data

from config import VERSION

logging.basicConfig(
    level=logging.INFO, 
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("TauTracker.log"),
        logging.StreamHandler()
    ]
)

def job():
    logging.info(f"--- Starting TauTracker v{VERSION} Sync ---")
    try:
        # Fetch data
        logging.info("Fetching Moodle assignments...")
        assignments, course_mapping, course_metadata = get_pending_assignments()
        
        logging.info("Fetching Panopto lectures...")
        lectures = get_new_lectures(course_mapping)
        
        # Sync data
        logging.info("Authenticating with Google Workspace...")
        gc, tasks_service = get_google_services()
        
        logging.info("Syncing to Google Sheets and Calendar...")
        sync_data(gc, tasks_service, assignments, lectures, course_metadata)
        
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
        
    # Otherwise, assume local daemon and schedule to run every 12 hours automatically
    schedule.every(12).hours.do(job)
    
    logging.info("TauTracker Daemon is now running in the background. Waiting for next scheduled run...")
    while True:
        schedule.run_pending()
        time.sleep(60)

if __name__ == "__main__":
    main()