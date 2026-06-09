from fastapi import APIRouter, Depends, BackgroundTasks
from server.auth.dependencies import get_current_user
from server.services import sync_service

router = APIRouter()

@router.post("/")
def trigger_sync(background_tasks: BackgroundTasks, current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    try:
        job_info = sync_service.trigger_sync(user_id, background_tasks)
        return job_info
    except Exception as e:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/status")
def get_sync_status(current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    status = sync_service.get_sync_status(user_id)
    if status:
        return status
    return {"status": "none"}
