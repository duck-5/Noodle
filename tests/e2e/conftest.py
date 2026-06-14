import pytest
import subprocess
import time
import requests
import socket

import tempfile
import os

def get_free_port():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("", 0))
    port = s.getsockname()[1]
    s.close()
    return port

@pytest.fixture(scope="session", autouse=True)
def start_server():
    port = get_free_port()
    temp_db = tempfile.TemporaryDirectory()
    env = os.environ.copy()
    env["DB_DIR"] = temp_db.name
    
    # Start the server
    proc = subprocess.Popen(["python", "-m", "uvicorn", "server.app:app", "--port", str(port)], env=env)
    
    # Wait for server to start
    for _ in range(30):
        try:
            resp = requests.get(f"http://localhost:{port}/api/health")
            if resp.status_code == 200:
                break
        except requests.exceptions.ConnectionError:
            pass
        time.sleep(0.5)
        
    # Register the existinguser for tests
    requests.post(f"http://localhost:{port}/api/auth/register", json={
        "username": "existinguser",
        "email": "existinguser@example.com",
        "password": "password"
    })

    yield port
    
    # Teardown
    proc.terminate()
    proc.wait()
    temp_db.cleanup()

@pytest.fixture
def page(context):
    page = context.new_page()
    page.add_init_script("window.localStorage.setItem('lang', 'en');")
    return page

@pytest.fixture(scope="session")
def base_url(start_server):
    return f"http://localhost:{start_server}"

@pytest.fixture
def auth_page(page, base_url):
    page.goto("/")
    page.get_by_label("Username").fill("existinguser")
    page.get_by_label("Password", exact=True).fill("password")
    page.get_by_role("button", name="Sign In").click()
    page.wait_for_timeout(500) # Give it a moment to navigate
    return page
