import pytest
from fastapi.testclient import TestClient
from server.app import app
from server.db.stores import users_store, assignments_store
import uuid
import datetime

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
        "username": "testuser_oracle",
        "email": "test@example.com",
        "password": "password123"
    })
    user_id = resp.json()["user_id"]
    token_resp = client.post("/api/auth/login", json={
        "username": "testuser_oracle",
        "password": "password123"
    })
    return token_resp.json()["access_token"], user_id

def test_upcoming_ignores_marked_done():
    token, user_id = get_auth_token_and_user()
    
    # Create an assignment due in 3 days, not submitted but marked as done
    future = datetime.datetime.now() + datetime.timedelta(days=3)
    deadline_str = future.strftime("%Y-%m-%d %H:%M:%S")
    
    assignment_id = str(uuid.uuid4())
    assignments_store.insert({
        "id": assignment_id,
        "user_id": user_id,
        "course_id": "c1",
        "assignment_name": "HW marked done",
        "status": "Assigned",
        "deadline": deadline_str,
        "marked_as_done": "True"
    })
    
    # Fetch upcoming
    resp = client.get("/api/assignments/upcoming", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    upcoming = resp.json()
    
    # It SHOULD not be in upcoming because it's marked as done
    is_in_upcoming = any(a["id"] == assignment_id for a in upcoming)
    
    # This assertion verifies if the bug exists.
    # If the bug exists, is_in_upcoming will be True, and the test will fail!
    # A correct implementation would filter out marked_as_done == 'True'
    assert not is_in_upcoming, "BUG FOUND: 'marked_as_done' assignment is still showing in upcoming!"
