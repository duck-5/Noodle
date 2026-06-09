"""
Files routes — listing, download proxy, and recent files.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
import urllib.parse
from datetime import datetime, timedelta

from server.auth.dependencies import get_current_user
from server.auth.encryption import decrypt_token
from server.db.stores import files_store
from clients.moodle_client import download_file

router = APIRouter()

@router.get("/course/{course_id}")
async def get_course_files_api(course_id: str, current_user: dict = Depends(get_current_user)):
    """Retrieve cached files for a specific course, grouped by section name."""
    files = files_store.query({
        "user_id": current_user["user_id"],
        "course_id": course_id
    })
    
    sections = {}
    for f in files:
        sec = f.get("section_name") or "General"
        sections.setdefault(sec, []).append(f)
        
    return {"sections": sections}

@router.get("/recent")
async def get_recent_files(current_user: dict = Depends(get_current_user)):
    """Retrieve recently synced files across all tracked courses (last 7 days)."""
    files = files_store.query({"user_id": current_user["user_id"]})
    
    recent = []
    # Avoid naive/aware comparison by keeping everything naive UTC
    now = datetime.utcnow()
    seven_days_ago = now - timedelta(days=7)
    
    for f in files:
        synced_str = f.get("last_synced", "")
        if not synced_str:
            continue
        try:
            # Parse ISO timestamp, handling potential Z suffix or offset
            # replace("Z", "") works for UTC values written as isoformat()
            dt_str = synced_str.split("+")[0].replace("Z", "")
            synced_time = datetime.fromisoformat(dt_str)
            if synced_time >= seven_days_ago:
                recent.append(f)
        except ValueError:
            continue
            
    recent.sort(key=lambda f: f.get("last_synced", ""), reverse=True)
    return recent

@router.get("/download")
async def proxy_download(url: str, current_user: dict = Depends(get_current_user)):
    """Proxy file downloading from Moodle, injecting the user's Moodle token."""
    moodle_token_enc = current_user.get("moodle_token_encrypted", "")
    if not moodle_token_enc:
        raise HTTPException(status_code=400, detail="Moodle token not configured")
        
    try:
        moodle_token = decrypt_token(moodle_token_enc)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to decrypt Moodle token")
        
    try:
        response = download_file(url, moodle_token)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch file from Moodle: {e}")
        
    content_type = response.headers.get("Content-Type", "application/octet-stream")
    content_length = response.headers.get("Content-Length")
    content_disposition = response.headers.get("Content-Disposition")
    
    if not content_disposition:
        parsed_url = urllib.parse.urlparse(url)
        filename = parsed_url.path.split("/")[-1] or "downloaded_file"
        content_disposition = f'attachment; filename="{filename}"'
        
    headers = {
        "Content-Disposition": content_disposition
    }
    if content_length:
        headers["Content-Length"] = content_length
        
    def file_streamer():
        for chunk in response.iter_content(chunk_size=8192):
            if chunk:
                yield chunk
                
    return StreamingResponse(
        file_streamer(),
        media_type=content_type,
        headers=headers
    )
