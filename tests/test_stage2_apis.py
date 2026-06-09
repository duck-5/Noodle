import pytest
from fastapi.testclient import TestClient
import requests
import json
import uuid

from server.app import app
from server.db.stores import (
    users_store,
    user_courses_store,
    assignments_store,
    files_store,
    meetings_store,
    recordings_store,
    sync_log_store
)
from server.auth.encryption import encrypt_token

client = TestClient(app)

@pytest.fixture(autouse=True)
def clean_stores():
    stores = [
        users_store,
        user_courses_store,
        assignments_store,
        files_store,
        meetings_store,
        recordings_store,
        sync_log_store
    ]
    for store in stores:
        with store._lock:
            store._write([])
    yield

def get_auth_headers():
    client.post("/api/auth/register", json={
        "username": "apiuser",
        "email": "api@example.com",
        "password": "password123"
    })
    resp = client.post("/api/auth/login", json={
        "username": "apiuser",
        "password": "password123"
    })
    token = resp.json()["access_token"]
    
    users = users_store.query({"username": "apiuser"})
    if users:
        users_store.update(users[0]["user_id"], {
            "moodle_token_encrypted": encrypt_token("valid_moodle_token")
        })
        
    return {"Authorization": f"Bearer {token}"}, users[0]["user_id"]

def test_courses_api(monkeypatch):
    headers, user_id = get_auth_headers()
    
    def mock_get_courses(*args, **kwargs):
        return [
            {
                "id": 1001,
                "fullname": "Discrete Math",
                "shortname": "0368111801-Math",
                "idnumber": "03681118-01-2025-1"
            }
        ]
        
    monkeypatch.setattr("server.routes.courses.get_enrolled_courses", mock_get_courses)
    
    resp = client.get("/api/courses/available", headers=headers)
    assert resp.status_code == 200
    assert "2025-SemesterA" in resp.json()["semesters"]
    
    post_resp = client.post("/api/courses/", json={"course_ids": ["1001"]}, headers=headers)
    assert post_resp.status_code == 200
    assert len(post_resp.json()["added"]) == 1
    assert post_resp.json()["added"][0]["course_id"] == "1001"
    
    get_resp = client.get("/api/courses/", headers=headers)
    assert get_resp.status_code == 200
    assert len(get_resp.json()) == 1
    assert get_resp.json()[0]["course_id"] == "1001"
    
    def mock_get_contents(*args, **kwargs):
        return [{"id": 1, "name": "General", "modules": []}]
    monkeypatch.setattr("server.routes.courses.get_course_contents", mock_get_contents)
    
    detail_resp = client.get("/api/courses/1001", headers=headers)
    assert detail_resp.status_code == 200
    assert len(detail_resp.json()) == 1
    assert detail_resp.json()[0]["name"] == "General"

    del_resp = client.delete("/api/courses/1001", headers=headers)
    assert del_resp.status_code == 200
    
    get_resp_empty = client.get("/api/courses/", headers=headers)
    assert len(get_resp_empty.json()) == 0

def test_assignments_and_grades_api():
    headers, user_id = get_auth_headers()
    
    assignments_store.insert({
        "id": "assign1",
        "user_id": user_id,
        "course_id": "1001",
        "course_name": "Discrete Math",
        "assignment_name": "Homework 1",
        "moodle_assign_id": "555",
        "cmid": "201",
        "deadline": "2026-06-12 23:59:59",
        "status": "Assigned",
        "grade": "85.0",
        "grade_max": "100.0"
    })
    
    resp = client.get("/api/assignments/", headers=headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["assignment_name"] == "Homework 1"
    
    upcoming_resp = client.get("/api/assignments/upcoming", headers=headers)
    assert upcoming_resp.status_code == 200
    assert len(upcoming_resp.json()) == 1
    
    grades_resp = client.get("/api/grades/", headers=headers)
    assert grades_resp.status_code == 200
    assert len(grades_resp.json()) == 1
    assert grades_resp.json()[0]["grade"] == 85.0
    assert grades_resp.json()[0]["percentage"] == 85.0
    
    summary_resp = client.get("/api/grades/summary", headers=headers)
    assert len(summary_resp.json()) == 1
    assert summary_resp.json()[0]["average_percentage"] == 85.0

def test_files_meetings_recordings_api():
    headers, user_id = get_auth_headers()
    
    files_store.insert({
        "id": "file1",
        "user_id": user_id,
        "course_id": "1001",
        "course_name": "Discrete Math",
        "section_name": "Week 1",
        "file_name": "syllabus.pdf",
        "file_url": "http://moodle/syllabus.pdf",
        "file_size": "2048",
        "mime_type": "application/pdf",
        "last_synced": "2026-06-09T09:00:00"
    })
    
    meetings_store.insert({
        "id": "meet1",
        "user_id": user_id,
        "course_id": "1001",
        "course_name": "Discrete Math",
        "title": "Zoom Lecture",
        "meeting_url": "https://tau.zoom.us/j/123",
        "type": "zoom"
    })
    
    recordings_store.insert({
        "id": "rec1",
        "user_id": user_id,
        "course_id": "1001",
        "course_name": "Discrete Math",
        "title": "Lecture 1 Recording",
        "recording_link": "https://panopto/rec1",
        "published_date": "06/08/2026 10:00:00",
        "type": "Lecture",
        "status": "Unwatched"
    })
    
    files_resp = client.get("/api/files/course/1001", headers=headers)
    assert "Week 1" in files_resp.json()["sections"]
    assert files_resp.json()["sections"]["Week 1"][0]["file_name"] == "syllabus.pdf"
    
    meetings_resp = client.get("/api/meetings/", headers=headers)
    assert len(meetings_resp.json()) == 1
    assert meetings_resp.json()[0]["title"] == "Zoom Lecture"
    
    recordings_resp = client.get("/api/recordings/", headers=headers)
    assert len(recordings_resp.json()) == 1
    assert recordings_resp.json()[0]["title"] == "Lecture 1 Recording"

def test_sync_refresh_api(monkeypatch):
    headers, user_id = get_auth_headers()
    
    user_courses_store.insert({
        "id": "track1",
        "user_id": user_id,
        "course_id": "1001",
        "course_name": "Discrete Math",
        "semester": "Semester A",
        "year": "2025"
    })
    
    def mock_get_enrolled(*args, **kwargs):
        return [{"id": 1001, "fullname": "Discrete Math", "shortname": "0368111801-Math"}]
        
    def mock_get_pending(*args, **kwargs):
        return [
            {
                "course_id": 1001,
                "course_name": "Discrete Math",
                "assignment_name": "Homework 1",
                "deadline": "2026-06-15 23:59:59",
                "opened": "",
                "timestamp": 1800000000,
                "link": "http://moodle/homework1",
                "status": "Assigned",
                "id": 555,
                "cmid": 201
            }
        ], {}, {}
        
    def mock_get_grades(*args, **kwargs):
        return {
            201: {
                "gradeformatted": "90.00",
                "graderaw": 90.0,
                "grademax": 100,
                "gradeishidden": False
            }
        }
        
    def mock_get_files(*args, **kwargs):
        return [
            {
                "file_name": "lecture1.pdf",
                "file_url": "http://moodle/lecture1.pdf",
                "file_size": 4096,
                "mime_type": "application/pdf",
                "section_name": "Week 1",
                "time_modified": 0
            }
        ]
        
    def mock_get_meetings(*args, **kwargs):
        return [
            {
                "title": "Zoom Link Week 1",
                "meeting_url": "https://tau.zoom.us/j/999",
                "section_name": "Week 1",
                "type": "zoom"
            }
        ]
        
    monkeypatch.setattr("server.services.sync_service.get_enrolled_courses", mock_get_enrolled)
    monkeypatch.setattr("server.services.sync_service.get_pending_assignments", mock_get_pending)
    monkeypatch.setattr("server.services.sync_service.get_assignment_grades", mock_get_grades)
    monkeypatch.setattr("server.services.sync_service.get_course_files", mock_get_files)
    monkeypatch.setattr("server.services.sync_service.get_course_meetings", mock_get_meetings)
    
    resp = client.post("/api/sync/", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["status"] in ["started", "syncing"]
    
    status_resp = client.get("/api/sync/status", headers=headers)
    assert status_resp.status_code == 200
    assert status_resp.json()["status"] in ["started", "syncing"]
