"""
Settings routes — Moodle token, SSO credentials, Panopto mappings.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
import requests
import json

from server.auth.dependencies import get_current_user
from server.auth.encryption import encrypt_token, decrypt_token
from server.db.stores import users_store
from server.config import MOODLE_URL

router = APIRouter()

class MoodleTokenRequest(BaseModel):
    moodle_token: str

class SSOCredentialsRequest(BaseModel):
    sso_username: str
    sso_password: str
    sso_student_id: str

class PanoptoCoursesRequest(BaseModel):
    course_mappings: dict[str, str]  # course_id -> panopto_folder_url or ID

@router.post("/moodle-token")
async def update_moodle_token(req: MoodleTokenRequest, current_user: dict = Depends(get_current_user)):
    """Validate and store the Moodle token."""
    try:
        response = requests.get(MOODLE_URL, params={
            "wstoken": req.moodle_token,
            "wsfunction": "core_webservice_get_site_info",
            "moodlewsrestformat": "json"
        })
        response.raise_for_status()
        data = response.json()
        
        if "exception" in data or "errorcode" in data:
            raise HTTPException(status_code=400, detail="Invalid Moodle token")
            
        moodle_username = data.get("username")
        moodle_userid = data.get("userid")
        
        encrypted = encrypt_token(req.moodle_token)
        users_store.update(current_user["user_id"], {"moodle_token_encrypted": encrypted})
        
        return {
            "valid": True,
            "moodle_username": moodle_username,
            "moodle_userid": moodle_userid
        }
    except requests.RequestException:
        raise HTTPException(status_code=500, detail="Failed to contact Moodle server")

@router.get("/moodle-token/status")
async def get_moodle_token_status(current_user: dict = Depends(get_current_user)):
    """Check if the Moodle token is configured and valid."""
    encrypted = current_user.get("moodle_token_encrypted", "")
    if not encrypted:
        return {"configured": False, "valid": False}
        
    try:
        token = decrypt_token(encrypted)
        response = requests.get(MOODLE_URL, params={
            "wstoken": token,
            "wsfunction": "core_webservice_get_site_info",
            "moodlewsrestformat": "json"
        })
        response.raise_for_status()
        data = response.json()
        
        if "exception" in data or "errorcode" in data:
            return {"configured": True, "valid": False}
            
        return {"configured": True, "valid": True}
    except Exception:
        return {"configured": True, "valid": False}

@router.delete("/moodle-token")
async def delete_moodle_token(current_user: dict = Depends(get_current_user)):
    """Remove the Moodle token."""
    users_store.update(current_user["user_id"], {"moodle_token_encrypted": ""})
    return {"status": "deleted"}

@router.post("/sso-credentials")
async def save_sso_credentials(req: SSOCredentialsRequest, current_user: dict = Depends(get_current_user)):
    """Encrypt and save SSO credentials for Panopto scraping."""
    try:
        enc_username = encrypt_token(req.sso_username)
        enc_password = encrypt_token(req.sso_password)
        enc_student_id = encrypt_token(req.sso_student_id)
        
        users_store.update(current_user["user_id"], {
            "sso_username_encrypted": enc_username,
            "sso_password_encrypted": enc_password,
            "sso_student_id_encrypted": enc_student_id
        })
        return {"status": "ok", "message": "SSO credentials stored successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to encrypt and store credentials: {e}")

@router.get("/sso-credentials/status")
async def get_sso_credentials_status(current_user: dict = Depends(get_current_user)):
    """Check if SSO credentials are configured."""
    has_username = bool(current_user.get("sso_username_encrypted"))
    has_password = bool(current_user.get("sso_password_encrypted"))
    has_student_id = bool(current_user.get("sso_student_id_encrypted"))
    
    return {
        "configured": has_username and has_password and has_student_id
    }

@router.delete("/sso-credentials")
async def delete_sso_credentials(current_user: dict = Depends(get_current_user)):
    """Remove stored SSO credentials."""
    users_store.update(current_user["user_id"], {
        "sso_username_encrypted": "",
        "sso_password_encrypted": "",
        "sso_student_id_encrypted": ""
    })
    return {"status": "deleted"}

@router.post("/panopto-courses")
async def save_panopto_course_mappings(req: PanoptoCoursesRequest, current_user: dict = Depends(get_current_user)):
    """Save user-defined mappings from course ID to Panopto folder URL."""
    try:
        settings_str = current_user.get("settings_json", "{}")
        settings = json.loads(settings_str) if settings_str else {}
        
        settings["panopto_course_mappings"] = req.course_mappings
        
        users_store.update(current_user["user_id"], {
            "settings_json": json.dumps(settings)
        })
        return {"status": "ok", "mappings": req.course_mappings}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save mappings: {e}")

@router.get("/panopto-courses")
async def get_panopto_course_mappings(current_user: dict = Depends(get_current_user)):
    """Retrieve user-defined Panopto folder mappings."""
    settings_str = current_user.get("settings_json", "{}")
    settings = json.loads(settings_str) if settings_str else {}
    return settings.get("panopto_course_mappings", {})
