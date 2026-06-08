import os
import logging
import gspread
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
import json
from config import CREDENTIALS_FILE, SPREADSHEET_NAME, WORKSHEET_NAME, COURSE_NAMES, GOOGLE_TASKS_LIST
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

def get_or_create_tasklist(tasks_service, list_name):
    """Return the tasklist ID for `list_name`, creating the list if it doesn't exist."""
    try:
        result = tasks_service.tasklists().list(maxResults=100).execute()
        for tl in result.get('items', []):
            if tl.get('title', '').strip().lower() == list_name.strip().lower():
                logging.info(f"Using existing Google Tasks list: '{tl['title']}' (id={tl['id']})")
                return tl['id']
        # List not found — create it
        new_list = tasks_service.tasklists().insert(body={'title': list_name}).execute()
        logging.info(f"Created new Google Tasks list: '{list_name}' (id={new_list['id']})")
        return new_list['id']
    except Exception as e:
        logging.warning(f"Could not resolve tasklist '{list_name}': {e}. Falling back to @default.")
        return '@default'

def sync_task(tasks_service, all_tasks, task_title, task_date, description, status_string="Assigned", current_sheet_status="", tasklist_id='@default'):
    """Creates or dynamically updates the completion status of a Google Task."""
    try:
        is_moodle_completed = (status_string == 'Submitted')
        is_manually_completed = (current_sheet_status == 'Submitted')
        target_status = 'completed' if (is_moodle_completed or is_manually_completed) else 'needsAction'
        
        for t in all_tasks:
            if t.get('title') == task_title:
                patch_body = {}
                
                # If the user has manually completed the task in Google Tasks, don't revert it!
                if t.get('status') == 'completed' and target_status == 'needsAction':
                    logging.info(f"Task '{task_title}' is manually completed in Google Tasks. Preserving 'completed' status.")
                elif t.get('status') != target_status:
                    patch_body['status'] = target_status
                    
                # Check if the deadline changed
                if task_date:
                    current_due = t.get('due', '')
                    # Compare only the Date portion YYYY-MM-DD because Google Tasks truncates the Time
                    if current_due[:10] != task_date[:10]:
                        patch_body['due'] = task_date
                        
                if patch_body:
                    tasks_service.tasks().patch(tasklist=tasklist_id, task=t['id'], body=patch_body).execute()
                    if 'status' in patch_body:
                        t['status'] = target_status
                    if 'due' in patch_body:
                        t['due'] = task_date
                    logging.info(f"Updated Google Task '{task_title}' with: {patch_body}")
                return "https://calendar.google.com/calendar/u/0/r/tasks"
                
        # If task does not exist, create it
        task_body = {
            'title': task_title,
            'notes': description,
            'status': target_status
        }
        
        if task_date:
            task_body['due'] = task_date
            
        created_task = tasks_service.tasks().insert(tasklist=tasklist_id, body=task_body).execute()
        all_tasks.append(created_task) # append to local cache
        logging.info(f"Created Google Task for '{task_title}' (Status: {target_status})")
        
        return "https://calendar.google.com/calendar/u/0/r/tasks"
    except Exception as e:
        logging.error(f"Failed to sync task '{task_title}': {e}")
        return ''

def sync_data(gc, tasks_service, assignments, lectures, course_metadata=None, grades_by_cmid=None):
    import re
    from datetime import datetime

    def resolve_course_name(course_id_or_name):
        """Return the user-defined COURSE_{id} name if set, otherwise the raw value."""
        ref = str(course_id_or_name).strip()
        # Try direct key lookup first
        if ref in COURSE_NAMES:
            return COURSE_NAMES[ref]
        # Try substring match (e.g. course_id is embedded in a longer name)
        for cid, cname in COURSE_NAMES.items():
            if cid in ref or ref in cid:
                return cname
        return ref

    def cmid_from_link(link):
        """Extract the cmid integer from a Moodle assignment URL, or return None."""
        import re
        m = re.search(r'[?&]id=(\d+)', str(link))
        return int(m.group(1)) if m else None

    def format_grade(grade_info):
        """Return a human-readable grade string, or '' if not yet graded / hidden."""
        if not grade_info:
            return ''
        if grade_info.get('gradeishidden'):
            return ''
        raw = grade_info.get('graderaw')
        if raw is None:
            return ''
        formatted = grade_info.get('gradeformatted', str(raw))
        grademax = grade_info.get('grademax', 100)
        return f"{formatted} / {int(grademax)}"

    if grades_by_cmid is None:
        grades_by_cmid = {}
    
    def parse_date(date_str):
        if not date_str:
            return datetime.min
        # Clean up day-of-week and weird spacing
        d_str = re.sub(r'^[a-zA-Z]{3},\s*', '', str(date_str).strip())
        d_str = d_str.replace('\xa0', ' ')
        d_str = re.sub(r'\s+', ' ', d_str).strip()
        
        # Supported formats (Moodle vs Panopto vs standalone date)
        formats = [
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%d",
            "%d/%m/%y %H:%M", 
            "%m/%d/%Y %H:%M:%S", 
            "%m/%d/%Y 00:00:00", 
            "%d/%m/%Y %H:%M", 
            "%d/%m/%y", 
            "%m/%d/%Y", 
            "%d/%m/%Y"
        ]
        for fmt in formats:
            try:
                return datetime.strptime(d_str, fmt)
            except ValueError:
                continue
        return datetime.min

    def get_worksheet_name(course_id_or_name, metadata, fallback_name):
        if not metadata:
            return fallback_name
        ref_str = str(course_id_or_name).strip()
        if ref_str in metadata:
            return metadata[ref_str].get("worksheet_name", fallback_name)
        # Search for key substring match
        for key, meta in metadata.items():
            if key in ref_str or ref_str in key:
                return meta.get("worksheet_name", fallback_name)
        return fallback_name

    try:
        sh = gc.open(SPREADSHEET_NAME)
    except gspread.exceptions.SpreadsheetNotFound:
        logging.error(f"Spreadsheet '{SPREADSHEET_NAME}' not found.")
        return

    if course_metadata is None:
        course_metadata = {}

    # Group assignments and lectures by target worksheet
    assignments_by_sheet = {}
    lectures_by_sheet = {}

    for assign in assignments:
        course_ref = assign.get('course_id') or assign.get('course_name', '')
        sheet_name = get_worksheet_name(course_ref, course_metadata, WORKSHEET_NAME)
        assignments_by_sheet.setdefault(sheet_name, []).append(assign)

    for lec in lectures:
        course_ref = lec.get('course_name', '')
        sheet_name = get_worksheet_name(course_ref, course_metadata, WORKSHEET_NAME)
        lectures_by_sheet.setdefault(sheet_name, []).append(lec)

    all_sheets = set(list(assignments_by_sheet.keys()) + list(lectures_by_sheet.keys()))

    # If no data is found, ensure at least the default worksheet is handled
    if not all_sheets:
        all_sheets = {WORKSHEET_NAME}

    # Resolve the target Google Tasks list once (find by name, or create it)
    tasklist_id = get_or_create_tasklist(tasks_service, GOOGLE_TASKS_LIST)

    # Pre-fetch all Google Tasks to drastically reduce API calls
    try:
        tasks_result = tasks_service.tasks().list(tasklist=tasklist_id, maxResults=100, showHidden=True).execute()
        all_tasks = tasks_result.get('items', [])
    except Exception as e:
        logging.error(f"Failed to fetch existing Google Tasks: {e}")
        all_tasks = []

    for sheet_name in sorted(all_sheets):
        logging.info(f"--- Synchronizing Worksheet: '{sheet_name}' ---")
        
        try:
            ws = sh.worksheet(sheet_name)
        except gspread.exceptions.WorksheetNotFound:
            logging.info(f"Worksheet '{sheet_name}' not found. Creating and formatting a new one...")
            try:
                ws = sh.add_worksheet(title=sheet_name, rows="1000", cols="10")
                ws.append_row(['Course', 'Type', 'Title', 'Date', 'Link', 'Status', 'Tasks Link', 'Grade'])
                ws.format("A1:H1", {
                    "textFormat": {"bold": True}
                })
            except Exception as e:
                logging.error(f"Failed to create worksheet '{sheet_name}': {e}. Skipping sync for this sheet.")
                continue

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
        existing_deadlines = ws.col_values(4) # Column D
        existing_links = ws.col_values(5) # Column E
        existing_statuses = ws.col_values(6) # Column F
        existing_grades = ws.col_values(8)   # Column H
        
        rows_to_insert = []
        sheet_assignments = assignments_by_sheet.get(sheet_name, [])
        sheet_lectures = lectures_by_sheet.get(sheet_name, [])

        for assign in sheet_assignments:
            title = assign.get('assignment_name', '')
            if not title:
                continue

            raw_course = assign.get('course_name') or assign.get('course_id', '')
            friendly_course = resolve_course_name(raw_course)
            task_title = f"[{friendly_course}] {title}"

            new_status = assign.get('status', 'Assigned')
            deadline_iso = assign.get('deadline', '').replace(" ", "T")
            if deadline_iso:
                deadline_iso += "Z"

            task_desc = f"Course: {friendly_course}\nLink: {assign.get('link', '')}\nSource: Moodle (TauTracker)"

            # Check for the new prefixed title OR the legacy bare title (migration compat)
            in_sheet_as_new = task_title in existing_titles
            in_sheet_as_legacy = (not in_sheet_as_new) and (title in existing_titles)
            already_in_sheet = in_sheet_as_new or in_sheet_as_legacy

            if not already_in_sheet:
                opened_dt = parse_date(assign.get('opened', ''))

                # If it's old (opened before last sync), don't resurrect it if the user deleted it.
                if opened_dt != datetime.min and opened_dt <= last_sync_dt:
                    continue

                event_link = sync_task(tasks_service, all_tasks, task_title, deadline_iso, task_desc, new_status, tasklist_id=tasklist_id)

                cmid = cmid_from_link(assign.get('link', ''))
                grade_str = format_grade(grades_by_cmid.get(cmid)) if cmid else ''

                rows_to_insert.append([
                    friendly_course,
                    "Assignment",
                    task_title,
                    assign.get('deadline', ''),
                    assign.get('link', ''),
                    new_status,
                    event_link,
                    grade_str
                ])
                existing_titles.append(task_title)
                logging.info(f"[{sheet_name}] Queued Assignment: {task_title}")

            else:
                # Resolve the row index from whichever title format is in the sheet
                row_idx = existing_titles.index(task_title) if in_sheet_as_new else existing_titles.index(title)
                current_sheet_status = existing_statuses[row_idx] if row_idx < len(existing_statuses) else ""

                # Sync the Google Task status regardless
                sync_task(tasks_service, all_tasks, task_title, deadline_iso, task_desc, new_status, current_sheet_status, tasklist_id=tasklist_id)

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
                    logging.info(f"[{sheet_name}] Updated spreadsheet status for '{title}' to: {new_status}")

                # Also update the title cell if it was using the legacy bare format
                if in_sheet_as_legacy and row_idx < len(existing_titles):
                    ws.update_acell(f"C{row_idx + 1}", task_title)
                    ws.update_acell(f"A{row_idx + 1}", friendly_course)
                    existing_titles[row_idx] = task_title  # keep local cache consistent
                    logging.info(f"[{sheet_name}] Migrated row title to prefixed format: {task_title}")

                # Check if the deadline changed (e.g. postponed)
                current_sheet_deadline = existing_deadlines[row_idx] if row_idx < len(existing_deadlines) else ""
                new_deadline_dt = parse_date(assign.get('deadline', ''))
                curr_deadline_dt = parse_date(current_sheet_deadline)

                EPOCH = datetime(1970, 1, 1)
                # Clear an existing 1970 epoch date if the new data has no deadline
                if curr_deadline_dt == EPOCH and new_deadline_dt == datetime.min:
                    ws.update_acell(f"D{row_idx + 1}", "")
                    logging.info(f"[{sheet_name}] Cleared epoch (1970) deadline for '{title}'")
                elif new_deadline_dt != datetime.min and new_deadline_dt != EPOCH and curr_deadline_dt != datetime.min and new_deadline_dt != curr_deadline_dt:
                    new_sheet_deadline = new_deadline_dt.strftime("%m/%d/%Y %H:%M:%S").lstrip("0").replace("/0", "/")
                    ws.update_acell(f"D{row_idx + 1}", new_sheet_deadline)
                    logging.info(f"[{sheet_name}] Updated spreadsheet deadline for '{title}' to: {new_sheet_deadline}")

                # Update grade column (H) if Moodle now has a grade that differs from what's in the sheet
                cmid = cmid_from_link(assign.get('link', ''))
                if cmid:
                    new_grade_str = format_grade(grades_by_cmid.get(cmid))
                    current_grade_str = existing_grades[row_idx] if row_idx < len(existing_grades) else ''
                    if new_grade_str and new_grade_str != current_grade_str:
                        ws.update_acell(f"H{row_idx + 1}", new_grade_str)
                        logging.info(f"[{sheet_name}] Updated grade for '{title}' to: {new_grade_str}")

        for lec in sheet_lectures:
            title = lec.get('lecture_title', '')
            link = lec.get('recording_link', '')
            pub_date = lec.get('published_date', '')

            # Only push if it was published after our last sync
            lec_dt = parse_date(pub_date)
            is_new = (lec_dt > last_sync_dt) or (lec_dt == datetime.min)

            if title and link and link not in existing_links and is_new:
                is_tirgul = 'tirgul' in title.lower() or 'תרגול' in title
                resource_type = "Recitation" if is_tirgul else "Lecture"

                raw_course = lec.get('course_name', '')
                friendly_course = resolve_course_name(raw_course)

                rows_to_insert.append([
                    friendly_course,
                    resource_type,
                    title,
                    pub_date,
                    link,
                    "Unattended",
                    ""  # NO TASKS FOR LECTURES
                ])
                existing_links.append(link)
                logging.info(f"[{sheet_name}] Queued Lecture/Recitation: {title}")
                
        if rows_to_insert:
            ws.insert_rows(rows_to_insert, row=2)
            logging.info(f"[{sheet_name}] Inserted {len(rows_to_insert)} new rows safely at the top of the table.")
        else:
            logging.info(f"[{sheet_name}] No new rows to insert. Sheet is up to date.")

        # Sort the entire spreadsheet (Course -> Type -> Date Descending)
        try:
            all_data = ws.get_all_values()
            if len(all_data) > 1:
                data_rows = all_data[1:]
                
                # Compute max column count to preserve any custom notes the user added
                max_col_count = max((len(r) for r in data_rows), default=8)
                max_col_count = max(max_col_count, 8)
                
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
                logging.info(f"[{sheet_name}] Sorted spreadsheet in-place by Course, Type, and Date.")
                
                # Update the last sync date in I1 so we know exactly when we last successfully ran
                ws.update_acell('I1', f"Last Sync: {datetime.now().strftime('%m/%d/%Y %H:%M:%S')}")
        except Exception as e:
            logging.error(f"[{sheet_name}] Failed to sort spreadsheet and save sync state: {e}")
