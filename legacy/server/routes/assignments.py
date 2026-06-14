from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from typing import List, Optional
from datetime import datetime, timedelta
import base64

from server.auth.dependencies import get_current_user
from server.db.stores import assignments_store
from server.services.moodle_service import get_user_moodle_token
from clients.moodle_client import upload_submission, submit_assignment

router = APIRouter()

@router.get("/")
def get_assignments(
    course_id: Optional[str] = None,
    status: Optional[str] = None,
    sort: Optional[str] = "deadline",
    current_user: dict = Depends(get_current_user)
):
    user_id = current_user["user_id"]
    filters = {"user_id": user_id}
    if course_id:
        filters["course_id"] = course_id
    if status:
        filters["status"] = status
        
    assignments = assignments_store.query(filters)
    
    if sort == "deadline":
        assignments.sort(key=lambda x: x.get("deadline", "") or "9999-12-31")
    elif sort == "course":
        assignments.sort(key=lambda x: x.get("course_name", ""))
        
    return assignments

@router.get("/upcoming")
def get_upcoming_assignments(current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    assignments = assignments_store.query({"user_id": user_id})
    
    upcoming = []
    now = datetime.now()
    seven_days = now + timedelta(days=7)
    
    for a in assignments:
        deadline_str = a.get("deadline")
        if not deadline_str:
            continue
        try:
            deadline = datetime.strptime(deadline_str, '%Y-%m-%d %H:%M:%S')
            if now < deadline <= seven_days and a.get("status") != "Submitted":
                upcoming.append(a)
        except ValueError:
            pass
            
    upcoming.sort(key=lambda x: x.get("deadline", ""))
    return upcoming

@router.get("/{assignment_id}")
def get_assignment_details(assignment_id: str, current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    assignment = assignments_store.read_by_key(assignment_id)
    if not assignment or assignment.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Assignment not found")
    return assignment

@router.post("/{assignment_id}/submit")
async def submit_assignment_file(
    assignment_id: str, 
    file: UploadFile = File(...), 
    current_user: dict = Depends(get_current_user)
):
    user_id = current_user["user_id"]
    assignment = assignments_store.read_by_key(assignment_id)
    if not assignment or assignment.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Assignment not found")
        
    token = get_user_moodle_token(user_id)
    
    file_content = await file.read()
    b64_content = base64.b64encode(file_content).decode('utf-8')
    
    # Try to find the Moodle ID. Usually it is stored in moodle_assign_id or just id.
    moodle_id = assignment.get("moodle_assign_id") or assignment.get("id")
    
    upload_res = upload_submission(
        assign_id=moodle_id, 
        file_content_b64=b64_content, 
        filename=file.filename, 
        user_id=user_id, 
        moodle_token=token
    )
    
    if not upload_res.get("success"):
        raise HTTPException(status_code=400, detail=upload_res.get("message"))
        
    submit_res = submit_assignment(
        assign_id=moodle_id,
        moodle_token=token
    )
    
    if not submit_res.get("success"):
        raise HTTPException(status_code=400, detail=submit_res.get("message"))
        
    updated = assignments_store.update(assignment_id, {"status": "Submitted"})
    return {"message": "Assignment submitted successfully", "assignment": updated}
