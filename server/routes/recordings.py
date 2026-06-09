from fastapi import APIRouter, Depends, Query, HTTPException
from typing import List, Optional
from server.auth.dependencies import get_current_user
from server.db.stores import recordings_store

router = APIRouter()

def _enrich_recording(r: dict):
    title = r.get("lecture_title", "") or r.get("title", "")
    is_recitation = 'tirgul' in title.lower() or 'תרגול' in title
    if not r.get("type"):
        r["type"] = "Recitation" if is_recitation else "Lecture"
    return r

@router.get("/")
def get_recordings(
    course_id: Optional[str] = None,
    type: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    user_id = current_user["user_id"]
    filters = {"user_id": user_id}
    if course_id:
        filters["course_id"] = course_id
        
    recordings = recordings_store.query(filters)
    enriched = [_enrich_recording(dict(r)) for r in recordings]
    
    if type:
        enriched = [r for r in enriched if r.get("type", "").lower() == type.lower()]
        
    enriched.sort(key=lambda x: x.get("published_date", ""), reverse=True)
    return enriched

@router.get("/course/{course_id}")
def get_course_recordings(course_id: str, current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    recordings = recordings_store.query({"user_id": user_id, "course_id": course_id})
    enriched = [_enrich_recording(dict(r)) for r in recordings]
    enriched.sort(key=lambda x: x.get("published_date", ""), reverse=True)
    return enriched

@router.put("/{recording_id}/status")
def update_recording_status(recording_id: str, status: str = Query(...), current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    recording = recordings_store.read_by_key(recording_id)
    if not recording or recording.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Recording not found")
        
    updated = recordings_store.update(recording_id, {"status": status})
    return _enrich_recording(updated)

