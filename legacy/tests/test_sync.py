import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
from server.app import app
from server.db.stores import users_store

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

@patch("server.services.sync_service.trigger_sync")
def test_trigger_sync(mock_trigger):
    mock_trigger.return_value = {"status": "started", "sync_id": "123"}
    token = get_auth_token()
    
    res = client.post("/api/sync/", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json()["status"] == "started"
    assert res.json()["sync_id"] == "123"

@patch("server.services.sync_service.get_sync_status")
def test_get_sync_status(mock_status):
    mock_status.return_value = {"status": "syncing", "progress": "Fetching..."}
    token = get_auth_token()
    
    res = client.get("/api/sync/status", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json()["status"] == "syncing"
    assert res.json()["progress"] == "Fetching..."
