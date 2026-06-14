import pytest
from fastapi.testclient import TestClient
from server.app import app
from server.db.stores import recordings_store, users_store

client = TestClient(app)

@pytest.fixture(autouse=True)
def clean_stores():
    with users_store._lock:
        users_store._write([])
    with recordings_store._lock:
        recordings_store._write([])
    yield

def test_recordings_api():
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
    
    # Setup recordings
    recordings_store.insert({
        "id": "1", "user_id": user_id, "course_id": "c1", "course_name": "Course 1",
        "title": "Lecture 1", "published_date": "2025-01-01 10:00:00"
    })
    recordings_store.insert({
        "id": "2", "user_id": user_id, "course_id": "c1", "course_name": "Course 1",
        "title": "תרגול 1", "published_date": "2025-01-02 10:00:00"
    })
    recordings_store.insert({
        "id": "3", "user_id": user_id, "course_id": "c2", "course_name": "Course 2",
        "title": "Lecture 2", "published_date": "2025-01-03 10:00:00"
    })
    
    # Test GET /api/recordings/
    res = client.get("/api/recordings/", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    assert len(data) == 3
    # Check sorting
    assert data[0]["id"] == "3"
    assert data[1]["id"] == "2"
    assert data[2]["id"] == "1"
    
    # Test GET /api/recordings/?type=Recitation
    res_type = client.get("/api/recordings/?type=Recitation", headers={"Authorization": f"Bearer {token}"})
    assert res_type.status_code == 200
    assert len(res_type.json()) == 1
    assert res_type.json()[0]["id"] == "2"
    
    # Test GET /api/recordings/course/{course_id}
    res_c1 = client.get("/api/recordings/course/c1", headers={"Authorization": f"Bearer {token}"})
    assert res_c1.status_code == 200
    data_c1 = res_c1.json()
    assert len(data_c1) == 2
    
    res_c2 = client.get("/api/recordings/course/c2", headers={"Authorization": f"Bearer {token}"})
    assert res_c2.status_code == 200
    assert len(res_c2.json()) == 1
