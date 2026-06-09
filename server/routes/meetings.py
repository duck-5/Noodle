"""
Meetings routes — Zoom meeting links extracted from Moodle.
"""

from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timedelta
import pytz

from server.auth.dependencies import get_current_user
from server.db.stores import meetings_store
from server.config import TIMEZONE

router = APIRouter()

@router.get("/")
async def get_meetings(
    course_id: str | None = None,
    current_user: dict = Depends(get_current_user)
):
    """Retrieve all cached Zoom meetings for the user's tracked courses."""
    filters = {"user_id": current_user["user_id"]}
    if course_id:
        filters["course_id"] = course_id
        
    meetings = meetings_store.query(filters)
    return meetings

@router.get("/course/{course_id}")
async def get_course_meetings(course_id: str, current_user: dict = Depends(get_current_user)):
    """Retrieve meetings for a specific course."""
    return await get_meetings(course_id=course_id, current_user=current_user)

@router.get("/upcoming")
async def get_upcoming_meetings(current_user: dict = Depends(get_current_user)):
    """Retrieve meetings scheduled for today or this week."""
    meetings = meetings_store.query({"user_id": current_user["user_id"]})
    
    tz = pytz.timezone(TIMEZONE)
    now = datetime.now(tz)
    end_of_week = now + timedelta(days=7)
    
    upcoming = []
    for m in meetings:
        start_str = m.get("start_time", "")
        if not start_str:
            # Recurring meetings or generic links are always shown
            upcoming.append(m)
            continue
            
        try:
            # Strip offset if present in isoformat parsing
            dt_str = start_str.split("+")[0].replace("Z", "")
            start_time = datetime.fromisoformat(dt_str)
            start_time = tz.localize(start_time)
            
            if now <= start_time <= end_of_week:
                upcoming.append(m)
        except ValueError:
            upcoming.append(m)
            
    return upcoming
