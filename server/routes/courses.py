"""
Courses routes — enrolled, tracked, configuration.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from datetime import datetime
import uuid

from server.auth.dependencies import get_current_user
from server.auth.encryption import decrypt_token
from server.db.stores import user_courses_store
from clients.moodle_client import get_enrolled_courses, parse_course_metadata, get_course_contents
from server.config import MOODLE_URL

router = APIRouter()

class TrackCoursesRequest(BaseModel):
    course_ids: list[str]

@router.get("/available")
async def get_available_courses(current_user: dict = Depends(get_current_user)):
    """Fetch all available courses from Moodle for the user, grouped by semester."""
    moodle_token_enc = current_user.get("moodle_token_encrypted", "")
    if not moodle_token_enc:
        raise HTTPException(status_code=400, detail="Moodle token not configured")
        
    try:
        moodle_token = decrypt_token(moodle_token_enc)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to decrypt Moodle token")
        
    courses = get_enrolled_courses(moodle_url=MOODLE_URL, moodle_token=moodle_token)
    if not courses:
        return {"semesters": {}}
        
    semesters = {}
    for course in courses:
        metadata = parse_course_metadata(course)
        if not metadata:
            semester_name = "Other"
            worksheet_name = "Other"
            course_id = str(course.get("id"))
            year = ""
        else:
            semester_name = metadata["semester_name"]
            worksheet_name = metadata["worksheet_name"]
            course_id = metadata["course_id"]
            year = metadata["year"]
            
        course_info = {
            "moodle_id": course.get("id"),
            "course_id": course_id,
            "fullname": course.get("fullname"),
            "shortname": course.get("shortname"),
            "semester": semester_name,
            "year": year
        }
        
        semesters.setdefault(worksheet_name, []).append(course_info)
        
    return {"semesters": semesters}

@router.get("/")
async def get_tracked_courses(current_user: dict = Depends(get_current_user)):
    """Get the list of courses the user is currently tracking."""
    tracked = user_courses_store.query({"user_id": current_user["user_id"]})
    return tracked

@router.post("/")
async def track_courses(req: TrackCoursesRequest, current_user: dict = Depends(get_current_user)):
    """Track a new set of courses. Resolves metadata from Moodle and saves it."""
    moodle_token_enc = current_user.get("moodle_token_encrypted", "")
    if not moodle_token_enc:
        raise HTTPException(status_code=400, detail="Moodle token not configured")
        
    try:
        moodle_token = decrypt_token(moodle_token_enc)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to decrypt Moodle token")
        
    moodle_courses = get_enrolled_courses(moodle_url=MOODLE_URL, moodle_token=moodle_token)
    
    # Get currently tracked courses to avoid duplicate rows
    existing = user_courses_store.query({"user_id": current_user["user_id"]})
    existing_moodle_ids = {str(item["course_id"]) for item in existing}
    
    added = []
    now = datetime.utcnow().isoformat()
    
    for course_id_str in req.course_ids:
        # Check if already tracked
        if course_id_str in existing_moodle_ids:
            continue
            
        # Find course in enrolled courses
        target = None
        for c in moodle_courses:
            if str(c.get("id")) == course_id_str:
                target = c
                break
                
        if not target:
            continue
            
        shortname = target.get("shortname", "")
        parts = shortname.split('-')
        if len(parts) >= 2:
            course_id_extracted = parts[0].strip()
        else:
            course_id_extracted = str(target.get("id"))
            
        from config import COURSE_NAMES
        resolved_name = COURSE_NAMES.get(course_id_extracted)
        if resolved_name:
            course_name = resolved_name
        elif len(parts) >= 2:
            course_english = parts[-1].strip()
            course_name = f"{course_id_extracted} - {course_english}"
        else:
            course_name = target.get("fullname", shortname)

        metadata = parse_course_metadata(target)
        if metadata:
            semester = metadata["semester_name"]
            year = metadata["year"]
        else:
            semester = "Other"
            year = ""
            
        row_id = str(uuid.uuid4())
        record = {
            "id": row_id,
            "user_id": current_user["user_id"],
            "course_id": str(target.get("id")),
            "course_name": course_name,
            "semester": semester,
            "year": year,
            "is_active": "true",
            "added_at": now
        }
        user_courses_store.insert(record)
        added.append(record)
        
    return {"status": "ok", "added": added}

@router.delete("/{course_id}")
async def untrack_course(course_id: str, current_user: dict = Depends(get_current_user)):
    """Stop tracking a course."""
    existing = user_courses_store.query({
        "user_id": current_user["user_id"],
        "course_id": course_id
    })
    if not existing:
        raise HTTPException(status_code=404, detail="Course not tracked")
        
    for item in existing:
        user_courses_store.delete(item["id"])
        
    return {"status": "ok"}

@router.get("/{course_id}")
async def get_course_details(course_id: str, current_user: dict = Depends(get_current_user)):
    """Get sections and modules of a course from Moodle."""
    moodle_token_enc = current_user.get("moodle_token_encrypted", "")
    if not moodle_token_enc:
        raise HTTPException(status_code=400, detail="Moodle token not configured")
        
    try:
        moodle_token = decrypt_token(moodle_token_enc)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to decrypt Moodle token")
        
    contents = get_course_contents(course_id, moodle_url=MOODLE_URL, moodle_token=moodle_token)
    return contents
