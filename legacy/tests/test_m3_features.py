import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
from server.app import app
from server.db.stores import users_store, assignments_store
import json
import base64
from server.auth.encryption import encrypt_token

client = TestClient(app)

@pytest.fixture(autouse=True)
def clean_stores():
    with users_store._lock:
        users_store._write([])
    with assignments_store._lock:
        assignments_store._write([])
    yield

def get_auth_token_and_user():
    resp = client.post("/api/auth/register", json={
        "username": "testuser",
        "email": "test@example.com",
        "password": "password123"
    })
    user_id = resp.json()["user_id"]
    token_resp = client.post("/api/auth/login", json={
        "username": "testuser",
        "password": "password123"
    })
    return token_resp.json()["access_token"], user_id

def test_patch_assignment():
    token, user_id = get_auth_token_and_user()
    
    # Setup assignment
    assignments_store.insert({
        "id": "test_assign_1",
        "user_id": user_id,
        "course_id": "c1",
        "assignment_name": "Test A1",
        "status": "Assigned"
    })
    
    # Update notes and marked_as_done
    res = client.patch("/api/assignments/test_assign_1", 
                       json={"notes": "My private notes", "marked_as_done": True},
                       headers={"Authorization": f"Bearer {token}"})
    
    assert res.status_code == 200
    
    # Check DB
    assignment = assignments_store.read_by_key("test_assign_1")
    assert assignment["notes"] == "My private notes"
    assert assignment["marked_as_done"] == "True"

    # Toggle off
    res2 = client.patch("/api/assignments/test_assign_1", 
                       json={"marked_as_done": False},
                       headers={"Authorization": f"Bearer {token}"})
    assert res2.status_code == 200
    
    assignment2 = assignments_store.read_by_key("test_assign_1")
    assert assignment2["marked_as_done"] == "False"


@patch("server.routes.sync.get_google_services")
@patch("server.routes.sync.get_or_create_tasklist")
@patch("server.routes.sync.sync_task")
def test_sync_google_tasks(mock_sync_task, mock_get_or_create, mock_get_services):
    token, user_id = get_auth_token_and_user()
    
    # Needs a google token encrypted
    fake_google_token = json.dumps({"access_token": "fake", "refresh_token": "fake"})
    encrypted = encrypt_token(fake_google_token)
    
    users_store.update(user_id, {"google_token_encrypted": encrypted})
    
    # Insert assignments
    assignments_store.insert({
        "id": "assign1",
        "user_id": user_id,
        "course_id": "c1",
        "course_name": "Math 101",
        "assignment_name": "HW1",
        "status": "Assigned",
        "marked_as_done": "False",
        "notes": "note 1"
    })
    assignments_store.insert({
        "id": "assign2",
        "user_id": user_id,
        "course_id": "c1",
        "course_name": "Math 101",
        "assignment_name": "HW2",
        "status": "Submitted", # Moodle status Submitted
        "marked_as_done": "False"
    })
    assignments_store.insert({
        "id": "assign3",
        "user_id": user_id,
        "course_id": "c1",
        "course_name": "Math 101",
        "assignment_name": "HW3",
        "status": "Assigned", 
        "marked_as_done": "True" # Manually marked
    })
    
    mock_tasks_service = MagicMock()
    mock_get_services.return_value = (None, mock_tasks_service)
    mock_get_or_create.return_value = "tasklist_id"
    mock_tasks_service.tasks().list().execute.return_value = {"items": []}
    
    res = client.post("/api/sync/google-tasks", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert "Successfully synced 3 tasks" in res.json()["message"]
    
    # Ensure sync_task called 3 times
    assert mock_sync_task.call_count == 3
    
    # Check effective status passed to sync_task
    # HW1 -> Assigned
    call1_args = mock_sync_task.call_args_list[0][1]
    assert call1_args["status_string"] == "Assigned"
    assert "note 1" in call1_args["description"]
    
    # HW2 -> Submitted
    call2_args = mock_sync_task.call_args_list[1][1]
    assert call2_args["status_string"] == "Submitted"
    
    # HW3 -> Submitted
    call3_args = mock_sync_task.call_args_list[2][1]
    assert call3_args["status_string"] == "Submitted"
