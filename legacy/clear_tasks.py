import os
import logging
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s')

def clear_panopto_tasks():
    if not os.path.exists('token.json'):
        logging.error("token.json not found. Run main.py first to authenticate.")
        return

    creds = Credentials.from_authorized_user_file('token.json')
    tasks_service = build('tasks', 'v1', credentials=creds)

    logging.info("Fetching tasks from your Google Tasks list...")
    tasks_result = tasks_service.tasks().list(tasklist='@default', maxResults=100).execute()
    tasks = tasks_result.get('items', [])

    deleted_count = 0
    for task in tasks:
        notes = task.get('notes', '')
        if "Source: Moodle" in notes:
            tasks_service.tasks().delete(tasklist='@default', task=task['id']).execute()
            logging.info(f"Deleted accidental task: {task.get('title')}")
            deleted_count += 1

    logging.info(f"Cleanup complete! Deleted {deleted_count} accidental tasks.")

if __name__ == "__main__":
    clear_panopto_tasks()
