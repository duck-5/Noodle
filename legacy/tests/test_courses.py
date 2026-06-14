import pytest
from fastapi.testclient import TestClient
from server.app import app
from server.db.stores import users_store, user_courses_store
from server.auth.encryption import encrypt_token

client = TestClient(app)

@pytest.fixture(autouse=True)
def clean_stores():
    with users_store._lock:
        users_store._write([])
    with user_courses_store._lock:
        user_courses_store._write([])
    yield

def get_auth_headers():
    client.post("/api/auth/register", json={
        "username": "tuser",
        "email": "tuser@example.com",
        "password": "password"
    })
    resp = client.post("/api/auth/login", json={
        "username": "tuser",
        "password": "password"
    })
    token = resp.json()["access_token"]
    
    users = users_store.query({"username": "tuser"})
    if users:
        users_store.update(users[0]["user_id"], {
            "moodle_token_encrypted": encrypt_token("dummy_token")
        })
        
    return {"Authorization": f"Bearer {token}"}

def test_get_available_courses(monkeypatch):
    headers = get_auth_headers()
    
    def mock_enrolled(*args, **kwargs):
        return [
            {"id": 100, "shortname": "03681118-01-2025-1 - Discrete Math", "fullname": "Discrete Math"},
            {"id": 101, "shortname": "Garbage Name", "fullname": "Garbage Course"}
        ]
    monkeypatch.setattr("server.routes.courses.get_enrolled_courses", mock_enrolled)
    
    res = client.get("/api/courses/available", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert "semesters" in data
    assert any("Discrete Math" in str(courses) for semester, courses in data["semesters"].items())

def test_post_tracked_courses(monkeypatch):
    headers = get_auth_headers()
    
    def mock_enrolled(*args, **kwargs):
        return [
            {"id": 100, "shortname": "03681118-01-2025-1 - Discrete Math", "fullname": "Discrete Math"}
        ]
    monkeypatch.setattr("server.routes.courses.get_enrolled_courses", mock_enrolled)
    
    post_res = client.post("/api/courses/", json={"course_ids": ["100"]}, headers=headers)
    assert post_res.status_code == 200
    
    get_res = client.get("/api/courses/", headers=headers)
    assert get_res.status_code == 200
    assert len(get_res.json()) == 1
    assert get_res.json()[0]["course_id"] == "100"
    
    del_res = client.delete("/api/courses/100", headers=headers)
    assert del_res.status_code == 200
    
    get_res2 = client.get("/api/courses/", headers=headers)
    assert len(get_res2.json()) == 0
