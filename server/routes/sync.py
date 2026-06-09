"""
Sync routes — manual refresh, job status, and history.
"""

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from server.auth.dependencies import get_current_user
from server.services.sync_service import trigger_sync, get_sync_status
from server.db.stores import sync_log_store

router = APIRouter()

@router.post("/refresh")
async def trigger_data_refresh(
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user)
):
    """Trigger a background data synchronization from Moodle/Panopto."""
    try:
        job_info = trigger_sync(current_user["user_id"], background_tasks)
        return job_info
    except ValueError as e:
        raise HTTPException(status_code=429, detail=str(e))

@router.get("/status")
async def get_current_sync_status(current_user: dict = Depends(get_current_user)):
    """Get the current active sync status (if any)."""
    status_info = get_sync_status(current_user["user_id"])
    if not status_info:
        return {"status": "idle", "progress": "Ready to sync."}
    return status_info

@router.get("/status/{sync_id}")
async def get_sync_status_by_id(sync_id: str, current_user: dict = Depends(get_current_user)):
    """Get sync progress by specific job ID."""
    status_info = get_sync_status(current_user["user_id"])
    if not status_info or status_info.get("sync_id") != sync_id:
        logs = sync_log_store.query({"id": sync_id, "user_id": current_user["user_id"]})
        if logs:
            l = logs[0]
            return {
                "sync_id": l["id"],
                "status": l["status"],
                "progress": "Completed" if l["status"] == "completed" else f"Failed: {l.get('error_message')}",
                "started_at": l["started_at"],
                "finished_at": l["finished_at"],
                "items_synced": int(l["items_synced"] or 0)
            }
        raise HTTPException(status_code=404, detail="Sync job not found")
    return status_info

@router.get("/history")
async def get_sync_history(current_user: dict = Depends(get_current_user)):
    """Get the last 10 sync runs for the current user."""
    logs = sync_log_store.query({"user_id": current_user["user_id"]})
    logs.sort(key=lambda l: l.get("finished_at", ""), reverse=True)
    return logs[:10]
