import pytest
from fastapi.testclient import TestClient
from server.app import app
from server.db.stores import assignments_store, users_store
import csv
from datetime import datetime, timedelta

client = TestClient(app)

@pytest.fixture(autouse=True)
def clean_stores():
    with users_store._lock:
        users_store._write([])
    with assignments_store._lock:
        assignments_store._write([])
    yield

def test_get_assignments():
    # Setup user
    resp = client.post("/api/auth/register", json={
        "username": "testuser",
        "email": "test@example.com",
        "password": "password123"
    })
    token_resp = client.post("/api/auth/login", json={
        "username": "testuser",
        "password": "password123"
    })
    token = token_resp.json()["access_token"]
    user_id = resp.json()["user_id"]
    
    # Setup assignment
    assignments_store.insert({
        "id": "1",
        "user_id": user_id,
        "course_id": "c1",
        "assignment_name": "Test A1",
        "status": "Assigned"
    })
    
    res = client.get("/api/assignments/", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert len(res.json()) == 1
    assert res.json()[0]["assignment_name"] == "Test A1"

def test_get_upcoming_assignments():
    # Setup user
    resp = client.post("/api/auth/register", json={
        "username": "testuser",
        "email": "test@example.com",
        "password": "password123"
    })
    token_resp = client.post("/api/auth/login", json={
        "username": "testuser",
        "password": "password123"
    })
    token = token_resp.json()["access_token"]
    user_id = resp.json()["user_id"]
    
    now = datetime.now()
    due_tomorrow = (now + timedelta(days=1)).strftime('%Y-%m-%d %H:%M:%S')
    due_past = (now - timedelta(days=1)).strftime('%Y-%m-%d %H:%M:%S')
    due_far = (now + timedelta(days=10)).strftime('%Y-%m-%d %H:%M:%S')
    
    assignments_store.insert({"id": "1", "user_id": user_id, "deadline": due_tomorrow, "status": "Assigned"})
    assignments_store.insert({"id": "2", "user_id": user_id, "deadline": due_past, "status": "Assigned"})
    assignments_store.insert({"id": "3", "user_id": user_id, "deadline": due_far, "status": "Assigned"})
    assignments_store.insert({"id": "4", "user_id": user_id, "deadline": due_tomorrow, "status": "Submitted"})
    
    res = client.get("/api/assignments/upcoming", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    assert len(data) == 1
    assert data[0]["id"] == "1"
