import pytest
from fastapi.testclient import TestClient
from server.app import app
from server.db.stores import meetings_store, users_store

client = TestClient(app)

@pytest.fixture(autouse=True)
def clean_stores():
    with users_store._lock:
        users_store._write([])
    with meetings_store._lock:
        meetings_store._write([])
    yield

def test_meetings_api():
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
    
    # Setup meetings
    meetings_store.insert({
        "id": "1", "user_id": user_id, "course_id": "c1", "course_name": "Course 1",
        "title": "Zoom 1", "meeting_url": "http://zoom.us/1", "section_name": "General"
    })
    meetings_store.insert({
        "id": "2", "user_id": user_id, "course_id": "c1", "course_name": "Course 1",
        "title": "Zoom 2", "meeting_url": "http://zoom.us/2", "section_name": "Week 1"
    })
    meetings_store.insert({
        "id": "3", "user_id": user_id, "course_id": "c2", "course_name": "Course 2",
        "title": "Zoom 3", "meeting_url": "http://zoom.us/3", "section_name": "General"
    })
    
    # Test GET /api/meetings/
    res = client.get("/api/meetings/", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    assert len(data) == 3
    
    # Test GET /api/meetings/?course_id=c1
    res_c1 = client.get("/api/meetings/?course_id=c1", headers={"Authorization": f"Bearer {token}"})
    assert res_c1.status_code == 200
    assert len(res_c1.json()) == 2
    
    # Test GET /api/meetings/course/{course_id}
    res_c2 = client.get("/api/meetings/course/c2", headers={"Authorization": f"Bearer {token}"})
    assert res_c2.status_code == 200
    assert len(res_c2.json()) == 1
