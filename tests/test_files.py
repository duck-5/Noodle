import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
from server.app import app
from server.db.stores import users_store
import time

client = TestClient(app)

@pytest.fixture(autouse=True)
def clean_users():
    with users_store._lock:
        users_store._write([])
    yield

def get_auth_token():
    client.post("/api/auth/register", json={
        "username": "testuser",
        "email": "test@example.com",
        "password": "password123"
    })
    token_resp = client.post("/api/auth/login", json={
        "username": "testuser",
        "password": "password123"
    })
    return token_resp.json()["access_token"]

@patch("server.services.moodle_service.get_course_files")
def test_get_course_files(mock_get_files):
    mock_get_files.return_value = [
        {"file_name": "syllabus.pdf", "file_url": "http://moodle/1", "time_modified": time.time()}
    ]
    
    token = get_auth_token()
    res = client.get("/api/files/course/123", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200, res.json()
    assert len(res.json()) == 1
    assert res.json()[0]["file_name"] == "syllabus.pdf"

@patch("server.services.moodle_service.get_enrolled_courses")
@patch("server.services.moodle_service.get_course_files")
def test_get_recent_files(mock_get_files, mock_get_courses):
    mock_get_courses.return_value = [{"id": 123, "shortname": "Math 101"}]
    
    now = time.time()
    mock_get_files.return_value = [
        {"file_name": "recent.pdf", "time_modified": now - 3600},
        {"file_name": "old.pdf", "time_modified": now - (10 * 24 * 3600)}
    ]
    
    token = get_auth_token()
    res = client.get("/api/files/recent", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200, res.json()
    data = res.json()
    assert len(data) == 1
    assert data[0]["file_name"] == "recent.pdf"
    assert data[0]["course_id"] == 123

@patch("server.services.moodle_service.download_file")
def test_download_file(mock_download):
    mock_resp = MagicMock()
    mock_resp.iter_content.return_value = [b"file ", b"content"]
    mock_resp.headers = {"Content-Type": "application/pdf", "Content-Length": "12"}
    mock_download.return_value = mock_resp
    
    token = get_auth_token()
    res = client.get("/api/files/download?url=http://moodle/1", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.content == b"file content"
    assert res.headers["content-type"] == "application/pdf"
