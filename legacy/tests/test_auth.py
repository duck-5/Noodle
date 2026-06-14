import pytest
from fastapi.testclient import TestClient
from server.app import app
from server.db.stores import users_store
import csv

client = TestClient(app)

@pytest.fixture(autouse=True)
def clean_users():
    # Clear the users store for tests
    with users_store._lock:
        users_store._write([])
    yield

def test_register():
    response = client.post("/api/auth/register", json={
        "username": "testuser",
        "email": "test@example.com",
        "password": "password123"
    })
    assert response.status_code == 201
    data = response.json()
    assert data["username"] == "testuser"
    assert "user_id" in data

def test_login():
    # Register first
    client.post("/api/auth/register", json={
        "username": "loginuser",
        "email": "login@example.com",
        "password": "password123"
    })
    
    # Try login
    response = client.post("/api/auth/login", json={
        "username": "loginuser",
        "password": "password123"
    })
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    
    # Try invalid login
    response = client.post("/api/auth/login", json={
        "username": "loginuser",
        "password": "wrong"
    })
    assert response.status_code == 401

def test_get_me():
    # Register
    client.post("/api/auth/register", json={
        "username": "meuser",
        "email": "me@example.com",
        "password": "password123"
    })
    
    # Login
    resp = client.post("/api/auth/login", json={
        "username": "meuser",
        "password": "password123"
    })
    token = resp.json()["access_token"]
    
    # Get Me
    me_resp = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me_resp.status_code == 200
    assert me_resp.json()["username"] == "meuser"
    assert me_resp.json()["email"] == "me@example.com"
