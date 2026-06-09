from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
import time

from server.auth.dependencies import get_current_user
from server.services import moodle_service

router = APIRouter()

@router.get("/course/{course_id}")
def get_course_files(course_id: int, current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    try:
        files = moodle_service.get_course_files(user_id, course_id)
        return files
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/recent")
def get_recent_files(current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    try:
        # Get all enrolled courses
        courses = moodle_service.get_enrolled_courses(user_id)
        recent_files = []
        
        seven_days_ago_ts = time.time() - (7 * 24 * 60 * 60)
        
        for course in courses:
            course_id = course.get("id")
            if not course_id:
                continue
                
            files = moodle_service.get_course_files(user_id, course_id)
            for f in files:
                if f.get("time_modified", 0) >= seven_days_ago_ts:
                    f["course_id"] = course_id
                    f["course_name"] = course.get("shortname", "")
                    recent_files.append(f)
                    
        # sort by recent first
        recent_files.sort(key=lambda x: x.get("time_modified", 0), reverse=True)
        return recent_files
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/download")
def download_file(url: str = Query(...), current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    try:
        # download_file returns a requests.Response stream
        response = moodle_service.download_file(user_id, url)
        
        # Generator to stream content
        def iterfile():
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    yield chunk
                    
        headers = {}
        if "Content-Disposition" in response.headers:
            headers["Content-Disposition"] = response.headers["Content-Disposition"]
        if "Content-Length" in response.headers:
            headers["Content-Length"] = response.headers["Content-Length"]
            
        return StreamingResponse(
            iterfile(),
            headers=headers,
            media_type=response.headers.get("Content-Type", "application/octet-stream")
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to download file: {str(e)}")
