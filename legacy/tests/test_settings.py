import pytest
from fastapi.testclient import TestClient
from server.app import app
from server.db.stores import users_store
from server.auth.encryption import encrypt_token, decrypt_token
import requests

client = TestClient(app)

@pytest.fixture(autouse=True)
def clean_users():
    with users_store._lock:
        users_store._write([])
    yield

def test_encryption_roundtrip():
    token = "abcdef1234567890"
    enc = encrypt_token(token)
    assert enc != token
    dec = decrypt_token(enc)
    assert dec == token

def test_moodle_token_api(monkeypatch):
    # Mock requests.get to Moodle API
    class MockResponse:
        def __init__(self, json_data, status_code):
            self.json_data = json_data
            self.status_code = status_code
            
        def json(self):
            return self.json_data
            
        def raise_for_status(self):
            if self.status_code >= 400:
                raise requests.RequestException("Error")
                
    def mock_get(*args, **kwargs):
        params = kwargs.get("params", {})
        if params.get("wstoken") == "valid_token":
            return MockResponse({"username": "testuser", "userid": 123}, 200)
        return MockResponse({"errorcode": "invalidtoken"}, 200)

    monkeypatch.setattr(requests, "get", mock_get)
    
    # Register and login
    client.post("/api/auth/register", json={
        "username": "tuser", "email": "t@example.com", "password": "password"
    })
    resp = client.post("/api/auth/login", json={
        "username": "tuser", "password": "password"
    })
    token = resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    
    # Check status initially
    status_resp = client.get("/api/settings/moodle-token/status", headers=headers)
    assert status_resp.status_code == 200
    assert status_resp.json() == {"configured": False, "valid": False}
    
    # Set invalid token
    inv_resp = client.post("/api/settings/moodle-token", json={"moodle_token": "invalid"}, headers=headers)
    assert inv_resp.status_code == 400
    
    # Set valid token
    valid_resp = client.post("/api/settings/moodle-token", json={"moodle_token": "valid_token"}, headers=headers)
    assert valid_resp.status_code == 200
    assert valid_resp.json()["valid"] is True
    
    # Check status again
    status_resp2 = client.get("/api/settings/moodle-token/status", headers=headers)
    assert status_resp2.json() == {"configured": True, "valid": True}
    
    # Delete token
    del_resp = client.delete("/api/settings/moodle-token", headers=headers)
    assert del_resp.status_code == 200
    
    # Check status finally
    status_resp3 = client.get("/api/settings/moodle-token/status", headers=headers)
    assert status_resp3.json() == {"configured": False, "valid": False}
