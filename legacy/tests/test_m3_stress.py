import pytest
from fastapi.testclient import TestClient
from server.app import app
from server.db.stores import users_store, assignments_store
import uuid
import datetime
import time
import uuid

client = TestClient(app)

@pytest.fixture(autouse=True)
def clean_stores():
    with users_store._lock:
        users_store._write([])
    with assignments_store._lock:
        assignments_store._write([])
    yield

def get_auth_token_and_user():
    user_id = str(uuid.uuid4())
    username = f"stress_user_{user_id}"
    resp = client.post("/api/auth/register", json={
        "username": username,
        "email": f"{username}@example.com",
        "password": "password123"
    })
    token_resp = client.post("/api/auth/login", json={
        "username": username,
        "password": "password123"
    })
    return token_resp.json()["access_token"], resp.json()["user_id"]

def test_assignments_performance():
    token, user_id = get_auth_token_and_user()
    
    # Generate 2000 assignments
    assignments = []
    base_time = datetime.datetime.now()
    
    for i in range(2000):
        assignments.append({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "course_id": "c1",
            "assignment_name": f"Stress HW {i}",
            "status": "Assigned",
            "deadline": (base_time + datetime.timedelta(days=i)).strftime("%Y-%m-%d %H:%M:%S"),
            "marked_as_done": "False"
        })
        
    with assignments_store._lock:
        # bulk insert directly
        current = assignments_store._read()
        current.extend(assignments)
        assignments_store._write(current)
        
    start_time = time.time()
    resp = client.get("/api/assignments/?sort=deadline", headers={"Authorization": f"Bearer {token}"})
    duration = time.time() - start_time
    
    assert resp.status_code == 200
    assert len(resp.json()) == 2000
    print(f"Time to fetch and sort 2000 assignments: {duration:.3f} seconds")
    
    # If duration > 1.0s, consider it a performance issue (for 2k rows).
    assert duration < 1.0, f"Performance issue: fetching assignments took {duration}s"
