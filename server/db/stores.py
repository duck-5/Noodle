import os
from server.config import DB_DIR
from server.db.csv_store import CSVStore

os.makedirs(DB_DIR, exist_ok=True)

users_store = CSVStore(
    csv_path=os.path.join(DB_DIR, "users.csv"),
    columns=["user_id", "username", "email", "password_hash", "moodle_token_encrypted", "sso_username_encrypted", "sso_password_encrypted", "sso_student_id_encrypted", "created_at", "last_login", "settings_json"],
    key_column="user_id"
)

user_courses_store = CSVStore(
    csv_path=os.path.join(DB_DIR, "user_courses.csv"),
    columns=["id", "user_id", "course_id", "course_name", "semester", "year", "is_active", "added_at"],
    key_column="id"  # uuid per row; filter by user_id+course_id at query time
)

assignments_store = CSVStore(
    csv_path=os.path.join(DB_DIR, "assignments.csv"),
    columns=["id", "user_id", "course_id", "course_name", "assignment_name", "moodle_assign_id", "cmid", "deadline", "opened", "status", "link", "grade", "grade_max", "last_synced"],
    key_column="id"
)

recordings_store = CSVStore(
    csv_path=os.path.join(DB_DIR, "recordings.csv"),
    columns=["id", "user_id", "course_id", "course_name", "title", "recording_link", "published_date", "type", "status", "last_synced"],
    key_column="id"
)

files_store = CSVStore(
    csv_path=os.path.join(DB_DIR, "files.csv"),
    columns=["id", "user_id", "course_id", "course_name", "section_name", "file_name", "file_url", "file_size", "mime_type", "last_synced"],
    key_column="id"
)

meetings_store = CSVStore(
    csv_path=os.path.join(DB_DIR, "meetings.csv"),
    columns=["id", "user_id", "course_id", "course_name", "title", "meeting_url", "start_time", "end_time", "type", "last_synced"],
    key_column="id"
)

sync_log_store = CSVStore(
    csv_path=os.path.join(DB_DIR, "sync_log.csv"),
    columns=["id", "user_id", "sync_type", "started_at", "finished_at", "status", "items_synced", "error_message"],
    key_column="id"
)
