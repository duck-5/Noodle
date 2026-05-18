import os
import logging
import gspread
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
import json
from config import CREDENTIALS_FILE, SPREADSHEET_NAME, WORKSHEET_NAME
from datetime import datetime

SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/tasks'
]

def get_google_services():
    creds = None
    
    # Check for token in environment variables (for GitHub Actions)
    env_token = os.environ.get('GOOGLE_TOKEN_JSON')
    if env_token:
        try:
            token_info = json.loads(env_token)
            creds = Credentials.from_authorized_user_info(token_info, SCOPES)
        except Exception as e:
            logging.error(f"Failed to parse GOOGLE_TOKEN_JSON from environment: {e}")
            
    # Fallback to local file
    if not creds and os.path.exists('token.json'):
        creds = Credentials.from_authorized_user_file('token.json', SCOPES)
        
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not os.path.exists(CREDENTIALS_FILE):
                logging.error(f"Credentials file {CREDENTIALS_FILE} not found. Please provide it.")
                raise FileNotFoundError(f"Missing {CREDENTIALS_FILE}")
            
            flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_FILE, SCOPES)
            creds = flow.run_local_server(port=0)
            
        # Only try to save the token if we are running locally (not in CI)
        if not os.environ.get("GITHUB_ACTIONS"):
            with open('token.json', 'w') as token:
                token.write(creds.to_json())

    gc = gspread.authorize(creds)
    tasks_service = build('tasks', 'v1', credentials=creds)
    
    return gc, tasks_service

def sync_task(tasks_service, all_tasks, task_title, task_date, description, status_string="Assigned", current_sheet_status=""):
    """Creates or dynamically updates the completion status of a Google Task."""
    try:
        is_moodle_completed = (status_string == 'Submitted')
        is_manually_completed = (current_sheet_status == 'Submitted')
        target_status = 'completed' if (is_moodle_completed or is_manually_completed) else 'needsAction'
        
        for t in all_tasks:
            if t.get('title') == task_title:
                # If the user has manually completed the task in Google Tasks, don't revert it!
                if t.get('status') == 'completed' and target_status == 'needsAction':
                    logging.info(f"Task '{task_title}' is manually completed in Google Tasks. Preserving 'completed' status.")
                    return "https://calendar.google.com/calendar/u/0/r/tasks"
                
                # If the task exists, ensure its completion status perfectly mirrors Moodle/Sheet
                if t.get('status') != target_status:
                    tasks_service.tasks().patch(tasklist='@default', task=t['id'], body={'status': target_status}).execute()
                    t['status'] = target_status # update local cache
                    logging.info(f"Updated Google Task '{task_title}' status to: {target_status}")
                return "https://calendar.google.com/calendar/u/0/r/tasks"
                
        # If task does not exist, create it
        task_body = {
            'title': task_title,
            'notes': description,
            'status': target_status
        }
        
        if task_date:
            task_body['due'] = task_date
            
        created_task = tasks_service.tasks().insert(tasklist='@default', body=task_body).execute()
        all_tasks.append(created_task) # append to local cache
        logging.info(f"Created Google Task for '{task_title}' (Status: {target_status})")
        
        return "https://calendar.google.com/calendar/u/0/r/tasks"
    except Exception as e:
        logging.error(f"Failed to sync task '{task_title}': {e}")
        return ''

def sync_data(gc, tasks_service, assignments, lectures):
    import re
    from datetime import datetime
    def parse_date(date_str):
        if not date_str:
            return datetime.min
        # Clean up day-of-week and weird spacing
        d_str = re.sub(r'^[a-zA-Z]{3},\s*', '', str(date_str).strip())
        d_str = d_str.replace('\xa0', ' ')
        d_str = re.sub(r'\s+', ' ', d_str).strip()
        
        # Supported formats (Moodle vs Panopto vs standalone date)
        formats = ["%d/%m/%y %H:%M", "%m/%d/%Y %H:%M:%S", "%m/%d/%Y 00:00:00", "%d/%m/%Y %H:%M", "%d/%m/%y", "%m/%d/%Y", "%d/%m/%Y"]
        for fmt in formats:
            try:
                return datetime.strptime(d_str, fmt)
            except ValueError:
                continue
        return datetime.min

    try:
        sh = gc.open(SPREADSHEET_NAME)
    except gspread.exceptions.SpreadsheetNotFound:
        logging.error(f"Spreadsheet '{SPREADSHEET_NAME}' not found.")
        return

    try:
        ws = sh.worksheet(WORKSHEET_NAME)
    except gspread.exceptions.WorksheetNotFound:
        logging.error(f"Worksheet '{WORKSHEET_NAME}' not found in '{SPREADSHEET_NAME}'.")
        return

    # Read Last Sync Date from I1
    try:
        last_sync_str = ws.acell('I1').value
        if last_sync_str and "Last Sync: " in last_sync_str:
            last_sync_dt = datetime.strptime(last_sync_str.replace("Last Sync: ", ""), "%m/%d/%Y %H:%M:%S")
        else:
            last_sync_dt = datetime.min
    except Exception:
        last_sync_dt = datetime.min

    existing_titles = ws.col_values(3) # Column C
    existing_links = ws.col_values(5) # Column E
    existing_statuses = ws.col_values(6) # Column F
    
    # Pre-fetch all Google Tasks to drastically reduce API calls
    try:
        tasks_result = tasks_service.tasks().list(tasklist='@default', maxResults=100, showHidden=True).execute()
        all_tasks = tasks_result.get('items', [])
    except Exception as e:
        logging.error(f"Failed to fetch existing Google Tasks: {e}")
        all_tasks = []
        
    rows_to_insert = []

    for assign in assignments:
        title = assign.get('assignment_name', '')
        if not title:
            continue
            
        new_status = assign.get('status', 'Assigned')
        deadline_iso = assign.get('deadline', '').replace(" ", "T")
        if deadline_iso:
            deadline_iso += "Z"
            
        task_desc = f"Course: {assign.get('course_name', '')}\nLink: {assign.get('link', '')}\nSource: Moodle (TauTracker)"
            
        if title not in existing_titles:
            # Re-use our robust date parser logic
            opened_dt = parse_date(assign.get('opened', ''))
            
            # If it's old (opened before last sync), don't resurrect it if the user deleted it.
            # If we can't parse opened date, we default to adding it just in case.
            if opened_dt != datetime.min and opened_dt <= last_sync_dt:
                continue
                
            event_link = sync_task(tasks_service, all_tasks, title, deadline_iso, task_desc, new_status)
            
            rows_to_insert.append([
                assign.get('course_name', ''),
                "Assignment",
                title,
                assign.get('deadline', ''),
                assign.get('link', ''),
                new_status, 
                event_link
            ])
            existing_titles.append(title)
            logging.info(f"Queued Assignment: {title}")
            
        elif title in existing_titles:
            # Assignment exists in spreadsheet!
            row_idx = existing_titles.index(title)
            current_sheet_status = existing_statuses[row_idx] if row_idx < len(existing_statuses) else ""
            
            # Sync the Google Task status regardless (in case it was checked off manually or updated)
            sync_task(tasks_service, all_tasks, title, deadline_iso, task_desc, new_status, current_sheet_status)
            
            # Check if we should update the spreadsheet status
            should_update = False
            if new_status == 'Submitted' and current_sheet_status != 'Submitted':
                should_update = True
            elif new_status == 'Not submitted' and current_sheet_status not in ['Submitted', 'Not submitted']:
                should_update = True
            elif new_status == 'Assigned' and current_sheet_status not in ['Submitted', 'Not submitted', 'Assigned']:
                should_update = True

            # Update the spreadsheet status cell if logic dictates
            if should_update and row_idx < len(existing_statuses):
                ws.update_acell(f"F{row_idx + 1}", new_status)
                logging.info(f"Updated spreadsheet status for '{title}' to: {new_status}")

    for lec in lectures:
        title = lec.get('lecture_title', '')
        link = lec.get('recording_link', '')
        pub_date = lec.get('published_date', '')
        
        # Only push if it was published after our last sync
        lec_dt = parse_date(pub_date)
        is_new = (lec_dt > last_sync_dt) or (lec_dt == datetime.min)
        
        # For lectures, use the Panopto link as the unique identifier because titles can be identical
        if title and link and link not in existing_links and is_new:
            is_tirgul = 'tirgul' in title.lower() or 'תרגול' in title
            resource_type = "Recitation" if is_tirgul else "Lecture"
            
            rows_to_insert.append([
                lec.get('course_name', ''),
                resource_type,
                title,
                pub_date,
                link,
                "Unattended", 
                "" # NO TASKS FOR LECTURES
            ])
            existing_links.append(link)
            logging.info(f"Queued Lecture/Recitation: {title}")
            
    if rows_to_insert:
        ws.insert_rows(rows_to_insert, row=2)
        logging.info(f"Inserted {len(rows_to_insert)} new rows safely at the top of the table.")
    else:
        logging.info("No new rows to insert. Sheet is up to date.")

    # Sort the entire spreadsheet (Course -> Type -> Date Descending)
    try:
        all_data = ws.get_all_values()
        if len(all_data) > 1:
            data_rows = all_data[1:]
            
            # Compute max column count to preserve any custom notes the user added
            max_col_count = max((len(r) for r in data_rows), default=7)
            max_col_count = max(max_col_count, 7)
            
            # Ensure uniform row length
            for row in data_rows:
                while len(row) < max_col_count:
                    row.append("")

            # Reformat dates and sort
            for row in data_rows:
                dt = parse_date(row[3])
                if dt != datetime.min:
                    row[3] = dt.strftime("%m/%d/%Y %H:%M:%S").lstrip("0").replace("/0", "/")

            # Sort by Course (0), Type (1), then Date Descending (3)
            data_rows.sort(key=lambda x: (x[0], x[1], -parse_date(x[3]).timestamp()))
            
            # Convert numeric column index to letter (e.g. 7 -> G, 9 -> I)
            def col_letter(n):
                res = ""
                while n > 0:
                    n, rem = divmod(n - 1, 26)
                    res = chr(65 + rem) + res
                return res
            
            end_col = col_letter(max_col_count)
            
            # Write the sorted data back to the sheet
            ws.update(f'A2:{end_col}{len(data_rows)+1}', data_rows)
            logging.info("Sorted spreadsheet in-place by Course, Type, and Date.")
            
            # Update the last sync date in I1 so we know exactly when we last successfully ran
            ws.update_acell('I1', f"Last Sync: {datetime.now().strftime('%m/%d/%Y %H:%M:%S')}")
    except Exception as e:
        logging.error(f"Failed to sort spreadsheet and save sync state: {e}")
