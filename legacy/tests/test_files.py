import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
from server.app import app
from server.db.stores import users_store, files_store
from server.auth.encryption import encrypt_token
import uuid
from datetime import datetime

client = TestClient(app)

@pytest.fixture(autouse=True)
def clean_db():
    with users_store._lock:
        users_store._write([])
    with files_store._lock:
        files_store._write([])
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

def test_get_course_files():
    token = get_auth_token()
    users = users_store.query({"username": "testuser"})
    user_id = users[0]["user_id"]
    
    files_store.insert({
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "course_id": "123",
        "course_name": "Test Course",
        "section_name": "General",
        "file_name": "syllabus.pdf",
        "file_url": "http://moodle/1",
        "file_size": "100",
        "mime_type": "application/pdf",
        "last_synced": "2026-06-09T12:00:00"
    })
    
    res = client.get("/api/files/course/123", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    assert "General" in data["sections"]
    assert data["sections"]["General"][0]["file_name"] == "syllabus.pdf"

def test_get_recent_files():
    token = get_auth_token()
    users = users_store.query({"username": "testuser"})
    user_id = users[0]["user_id"]
    
    now_iso = datetime.utcnow().isoformat()
    files_store.insert({
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "course_id": "123",
        "course_name": "Test Course",
        "section_name": "General",
        "file_name": "recent.pdf",
        "file_url": "http://moodle/recent",
        "file_size": "100",
        "mime_type": "application/pdf",
        "last_synced": now_iso
    })
    
    res = client.get("/api/files/recent", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    assert len(data) == 1
    assert data[0]["file_name"] == "recent.pdf"

@patch("server.routes.files.download_file")
def test_download_file(mock_download):
    mock_resp = MagicMock()
    mock_resp.iter_content.return_value = [b"file ", b"content"]
    mock_resp.headers = {"Content-Type": "application/pdf", "Content-Length": "12"}
    mock_download.return_value = mock_resp
    
    token = get_auth_token()
    users = users_store.query({"username": "testuser"})
    user_id = users[0]["user_id"]
    
    users_store.update(user_id, {"moodle_token_encrypted": encrypt_token("mock-token")})
    
    res = client.get("/api/files/download?url=http://moodle/1", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.content == b"file content"
    assert res.headers["content-type"] == "application/pdf"
