"""
Sync Service — background data synchronization from Moodle and Panopto.
"""

import threading
import logging
from datetime import datetime
import uuid
import json

from server.config import MOODLE_URL, PANOPTO_URL, SYNC_COOLDOWN_SECONDS
from server.auth.encryption import decrypt_token
from server.db.stores import (
    user_courses_store,
    assignments_store,
    files_store,
    meetings_store,
    recordings_store,
    sync_log_store,
    users_store
)
from clients.moodle_client import (
    get_enrolled_courses,
    get_pending_assignments,
    get_assignment_grades,
    get_course_files,
    get_course_meetings
)
from clients.panopto_client import get_new_lectures

# Global dict of active sync jobs: user_id -> job_dict
active_syncs = {}
sync_lock = threading.Lock()

def get_sync_status(user_id: str) -> dict | None:
    """Retrieve active sync status for a user."""
    with sync_lock:
        return active_syncs.get(user_id)

def trigger_sync(user_id: str, background_tasks) -> dict:
    """Trigger a sync job as a background task, returning the job metadata."""
    with sync_lock:
        # 1. Check if a sync is already running
        if user_id in active_syncs and active_syncs[user_id]["status"] in ["started", "syncing"]:
            return active_syncs[user_id]
            
        # 2. Check cooldown from sync log
        logs = sync_log_store.query({"user_id": user_id, "status": "completed"})
        if logs:
            logs.sort(key=lambda l: l.get("finished_at", ""), reverse=True)
            last_sync_str = logs[0].get("finished_at")
            if last_sync_str:
                try:
                    # Clean trailing offset or timezone characters
                    dt_clean = last_sync_str.split("+")[0].replace("Z", "")
                    last_sync = datetime.fromisoformat(dt_clean)
                    diff = (datetime.utcnow() - last_sync).total_seconds()
                    if diff < SYNC_COOLDOWN_SECONDS:
                        raise ValueError(f"Sync is on cooldown. Please wait {int(SYNC_COOLDOWN_SECONDS - diff)} seconds.")
                except ValueError as ve:
                    if "cooldown" in str(ve):
                        raise ve
                    pass

        # 3. Initialize job metadata
        job_id = str(uuid.uuid4())
        job_info = {
            "sync_id": job_id,
            "status": "started",
            "progress": "Initializing...",
            "started_at": datetime.utcnow().isoformat(),
            "items_synced": 0
        }
        active_syncs[user_id] = job_info
        
    # Launch in background
    background_tasks.add_task(run_sync_task, user_id, job_id)
    return job_info

def run_sync_task(user_id: str, job_id: str):
    """Background task performing the actual sync logic."""
    logging.info(f"Starting background sync job {job_id} for user {user_id}")
    
    def update_progress(status_text, progress_text):
        with sync_lock:
            if user_id in active_syncs and active_syncs[user_id]["sync_id"] == job_id:
                active_syncs[user_id]["status"] = status_text
                active_syncs[user_id]["progress"] = progress_text
                
    try:
        user = users_store.read_by_key(user_id)
        if not user:
            raise ValueError("User not found")
            
        moodle_token_enc = user.get("moodle_token_encrypted")
        if not moodle_token_enc:
            raise ValueError("Moodle token not configured")
            
        moodle_token = decrypt_token(moodle_token_enc)
        
        update_progress("syncing", "Fetching course list...")
        tracked_courses = user_courses_store.query({"user_id": user_id})
        if not tracked_courses:
            finalize_sync(user_id, job_id, "completed", "No courses tracked. Sync finished.", 0)
            return
            
        tracked_course_ids = {c["course_id"] for c in tracked_courses}
        tracked_course_names = {c["course_id"]: c["course_name"] for c in tracked_courses}
        
        course_mapping = {c["course_id"]: c["course_name"] for c in tracked_courses}
        
        update_progress("syncing", "Syncing assignments & grades...")
        moodle_assigns, _, _ = get_pending_assignments(moodle_url=MOODLE_URL, moodle_token=moodle_token)
        
        enrolled_moodle_courses = get_enrolled_courses(moodle_url=MOODLE_URL, moodle_token=moodle_token)
        moodle_grades = get_assignment_grades(enrolled_moodle_courses, moodle_url=MOODLE_URL, moodle_token=moodle_token)
        
        items_count = 0
        now_str = datetime.utcnow().isoformat()
        
        for ma in moodle_assigns:
            course_id_str = str(ma.get("course_id"))
            if course_id_str not in tracked_course_ids:
                continue
                
            cmid_val = ma.get("cmid")
            moodle_assign_id = ma.get("id")
            
            grade_val = "-"
            grade_max_val = "100"
            if cmid_val and int(cmid_val) in moodle_grades:
                grade_info = moodle_grades[int(cmid_val)]
                if not grade_info.get("gradeishidden"):
                    grade_val = str(grade_info.get("graderaw") if grade_info.get("graderaw") is not None else "-")
                    grade_max_val = str(grade_info.get("grademax") or "100")
            
            existing = assignments_store.query({
                "user_id": user_id,
                "course_id": course_id_str,
                "cmid": str(cmid_val)
            })
            
            course_name = tracked_course_names.get(course_id_str, ma.get("course_name", ""))
            
            record = {
                "user_id": user_id,
                "course_id": course_id_str,
                "course_name": course_name,
                "assignment_name": ma.get("assignment_name", ""),
                "moodle_assign_id": str(moodle_assign_id),
                "cmid": str(cmid_val),
                "deadline": ma.get("deadline", ""),
                "opened": ma.get("opened", ""),
                "status": ma.get("status", "Assigned"),
                "link": ma.get("link", ""),
                "grade": grade_val,
                "grade_max": grade_max_val,
                "last_synced": now_str
            }
            
            if existing:
                if existing[0]["status"] == "Submitted" and record["status"] == "Assigned":
                    record["status"] = "Submitted"
                assignments_store.update(existing[0]["id"], record)
            else:
                record["id"] = str(uuid.uuid4())
                assignments_store.insert(record)
                
            items_count += 1
            
        for course in tracked_courses:
            course_id_str = course["course_id"]
            course_name = course["course_name"]
            
            update_progress("syncing", f"Syncing files for {course_name}...")
            course_files = get_course_files(course_id_str, moodle_url=MOODLE_URL, moodle_token=moodle_token)
            for f in course_files:
                existing_file = files_store.query({
                    "user_id": user_id,
                    "course_id": course_id_str,
                    "file_url": f["file_url"]
                })
                
                record = {
                    "user_id": user_id,
                    "course_id": course_id_str,
                    "course_name": course_name,
                    "section_name": f["section_name"],
                    "file_name": f["file_name"],
                    "file_url": f["file_url"],
                    "file_size": str(f["file_size"]),
                    "mime_type": f["mime_type"],
                    "last_synced": now_str
                }
                
                if existing_file:
                    files_store.update(existing_file[0]["id"], record)
                else:
                    record["id"] = str(uuid.uuid4())
                    files_store.insert(record)
                    
                items_count += 1
                
            update_progress("syncing", f"Syncing Zoom meetings for {course_name}...")
            course_meetings = get_course_meetings(course_id_str, moodle_url=MOODLE_URL, moodle_token=moodle_token)
            for m in course_meetings:
                existing_meeting = meetings_store.query({
                    "user_id": user_id,
                    "course_id": course_id_str,
                    "meeting_url": m["meeting_url"]
                })
                
                record = {
                    "user_id": user_id,
                    "course_id": course_id_str,
                    "course_name": course_name,
                    "title": m["title"],
                    "meeting_url": m["meeting_url"],
                    "start_time": "",
                    "end_time": "",
                    "type": m["type"],
                    "last_synced": now_str
                }
                
                if existing_meeting:
                    meetings_store.update(existing_meeting[0]["id"], record)
                else:
                    record["id"] = str(uuid.uuid4())
                    meetings_store.insert(record)
                    
                items_count += 1
                
        sso_username_enc = user.get("sso_username_encrypted")
        sso_password_enc = user.get("sso_password_encrypted")
        sso_student_id_enc = user.get("sso_student_id_encrypted")
        
        if sso_username_enc and sso_password_enc and sso_student_id_enc:
            update_progress("syncing", "SSO authenticating & scraping Panopto recordings...")
            try:
                sso_user = decrypt_token(sso_username_enc)
                sso_pass = decrypt_token(sso_password_enc)
                sso_sid = decrypt_token(sso_student_id_enc)
                
                settings_str = user.get("settings_json", "{}")
                settings = json.loads(settings_str) if settings_str else {}
                panopto_courses = settings.get("panopto_course_mappings", {})
                
                if panopto_courses:
                    panopto_lecs = get_new_lectures(
                        course_mapping=course_mapping,
                        panopto_url=PANOPTO_URL,
                        username=sso_user,
                        password=sso_pass,
                        pid=sso_sid,
                        panopto_courses=panopto_courses
                    )
                    
                    for pl in panopto_lecs:
                        target_course_id = "0"
                        for cid in panopto_courses.keys():
                            if pl["course_name"] == course_mapping.get(cid):
                                target_course_id = cid
                                break
                                
                        existing_recording = recordings_store.query({
                            "user_id": user_id,
                            "recording_link": pl["recording_link"]
                        })
                        
                        record = {
                            "user_id": user_id,
                            "course_id": target_course_id,
                            "course_name": pl["course_name"],
                            "title": pl["lecture_title"],
                            "recording_link": pl["recording_link"],
                            "published_date": pl["published_date"],
                            "type": "Lecture" if "tirgul" not in pl["lecture_title"].lower() and "תרגול" not in pl["lecture_title"] else "Recitation",
                            "status": "Unwatched",
                            "last_synced": now_str
                        }
                        
                        if existing_recording:
                            record["status"] = existing_recording[0]["status"]
                            recordings_store.update(existing_recording[0]["id"], record)
                        else:
                            record["id"] = str(uuid.uuid4())
                            recordings_store.insert(record)
                            
                        items_count += 1
            except Exception as pe:
                logging.error(f"Panopto sync error: {pe}")
                
        finalize_sync(user_id, job_id, "completed", "Sync completed successfully.", items_count)
        
    except Exception as e:
        logging.error(f"Sync task failed: {e}", exc_info=True)
        finalize_sync(user_id, job_id, "failed", str(e), 0)

def finalize_sync(user_id: str, job_id: str, status: str, progress: str, items_synced: int):
    """Save sync history to CSV and update global active_syncs status."""
    now_str = datetime.utcnow().isoformat()
    
    with sync_lock:
        job_info = active_syncs.get(user_id)
        if job_info and job_info["sync_id"] == job_id:
            job_info["status"] = status
            job_info["progress"] = progress
            job_info["finished_at"] = now_str
            job_info["items_synced"] = items_synced
            
    sync_log_store.insert({
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "sync_type": "full_refresh",
        "started_at": job_info.get("started_at") if job_info else now_str,
        "finished_at": now_str,
        "status": status,
        "items_synced": str(items_synced),
        "error_message": progress if status == "failed" else ""
    })
