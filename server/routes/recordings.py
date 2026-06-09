"""
Recordings routes — viewing cached Panopto recordings.
"""

from fastapi import APIRouter, Depends, HTTPException
from server.auth.dependencies import get_current_user
from server.db.stores import recordings_store

router = APIRouter()

@router.get("/")
async def get_recordings(
    course_id: str | None = None,
    type: str | None = None,
    current_user: dict = Depends(get_current_user)
):
    """Retrieve all cached recordings for the user's tracked courses."""
    filters = {"user_id": current_user["user_id"]}
    if course_id:
        filters["course_id"] = course_id
        
    recordings = recordings_store.query(filters)
    
    # Filter by type (Lecture or Recitation)
    if type:
        recordings = [r for r in recordings if r["type"].lower() == type.lower()]
        
    # Sort by published date desc (newest first)
    recordings.sort(key=lambda r: r.get("published_date") or "", reverse=True)
    return recordings

@router.get("/course/{course_id}")
async def get_course_recordings(course_id: str, current_user: dict = Depends(get_current_user)):
    """Retrieve recordings for a specific course."""
    return await get_recordings(course_id=course_id, current_user=current_user)
