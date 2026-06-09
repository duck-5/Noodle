"""
Service wrapper for Moodle API calls.
Handles retrieving and decrypting the user's token.
"""

from server.db.stores import users_store
from server.auth.encryption import decrypt_token
import clients.moodle_client as moodle_client
from fastapi import HTTPException

def get_user_moodle_token(user_id: str) -> str:
    user = users_store.read_by_key(user_id)
    if not user or not user.get("moodle_token_encrypted"):
        raise HTTPException(status_code=400, detail="Moodle token not configured for user")
    
    try:
        return decrypt_token(user["moodle_token_encrypted"])
    except Exception:
        raise HTTPException(status_code=400, detail="Failed to decrypt Moodle token. Please re-configure it.")

def get_enrolled_courses(user_id: str):
    token = get_user_moodle_token(user_id)
    return moodle_client.get_enrolled_courses(moodle_token=token)

def get_pending_assignments(user_id: str):
    token = get_user_moodle_token(user_id)
    return moodle_client.get_pending_assignments(moodle_token=token)

def get_assignment_grades(user_id: str, enrolled_courses):
    token = get_user_moodle_token(user_id)
    return moodle_client.get_assignment_grades(enrolled_courses, moodle_token=token)

def get_course_contents(user_id: str, course_id: int):
    token = get_user_moodle_token(user_id)
    return moodle_client.get_course_contents(course_id, moodle_token=token)
