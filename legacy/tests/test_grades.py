import pytest
from fastapi.testclient import TestClient
from server.app import app
from server.db.stores import assignments_store, users_store

client = TestClient(app)

@pytest.fixture(autouse=True)
def clean_stores():
    with users_store._lock:
        users_store._write([])
    with assignments_store._lock:
        assignments_store._write([])
    yield

def test_grades_api():
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
    
    # Setup assignments
    assignments_store.insert({
        "id": "1", "user_id": user_id, "course_id": "c1", "course_name": "Course 1",
        "assignment_name": "A1", "grade": "85", "grade_max": "100"
    })
    assignments_store.insert({
        "id": "2", "user_id": user_id, "course_id": "c1", "course_name": "Course 1",
        "assignment_name": "A2", "grade": "90", "grade_max": "100"
    })
    assignments_store.insert({
        "id": "3", "user_id": user_id, "course_id": "c2", "course_name": "Course 2",
        "assignment_name": "A3", "grade": "-", "grade_max": "100"
    })
    
    # Test GET /api/grades/
    res = client.get("/api/grades/", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200, res.json()
    data = res.json()
    assert len(data) == 2  # Only graded
    
    # Test GET /api/grades/course/{course_id}
    res_c1 = client.get("/api/grades/course/c1", headers={"Authorization": f"Bearer {token}"})
    assert res_c1.status_code == 200
    data_c1 = res_c1.json()
    assert len(data_c1) == 2
    assert data_c1[0]["percentage"] == 85.0
    
    res_c2 = client.get("/api/grades/course/c2", headers={"Authorization": f"Bearer {token}"})
    assert res_c2.status_code == 200
    assert len(res_c2.json()) == 0
    
    # Test GET /api/grades/summary
    res_sum = client.get("/api/grades/summary", headers={"Authorization": f"Bearer {token}"})
    assert res_sum.status_code == 200
    summary = res_sum.json()
    assert len(summary) == 2
    
    # Check c1 average
    c1_sum = next(s for s in summary if s["course_id"] == "c1")
    assert c1_sum["average_percentage"] == 87.5
    assert c1_sum["total_assignments"] == 2
    assert c1_sum["graded_assignments"] == 2
    
    # Check c2 average
    c2_sum = next(s for s in summary if s["course_id"] == "c2")
    assert c2_sum["average_percentage"] is None
    assert c2_sum["total_assignments"] == 1
    assert c2_sum["graded_assignments"] == 0
