from fastapi import APIRouter, Depends, Query
from typing import List, Optional
from server.auth.dependencies import get_current_user
from server.db.stores import meetings_store

router = APIRouter()

@router.get("/")
def get_meetings(
    course_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    user_id = current_user["user_id"]
    filters = {"user_id": user_id}
    if course_id:
        filters["course_id"] = course_id
        
    meetings = meetings_store.query(filters)
    
    # Sort by title or course name since they don't have explicit times in the scraped data
    meetings.sort(key=lambda x: (x.get("course_name", ""), x.get("title", "")))
    return meetings

@router.get("/course/{course_id}")
def get_course_meetings(course_id: str, current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    meetings = meetings_store.query({"user_id": user_id, "course_id": course_id})
    meetings.sort(key=lambda x: x.get("title", ""))
    return meetings
