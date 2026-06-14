import pytest
import subprocess
import time
import requests
import socket

def get_free_port():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("", 0))
    port = s.getsockname()[1]
    s.close()
    return port

@pytest.fixture(scope="session", autouse=True)
def start_server():
    port = get_free_port()
    # Start the server
    proc = subprocess.Popen(["python", "-m", "uvicorn", "server.app:app", "--port", str(port)])
    
    # Wait for server to start
    for _ in range(30):
        try:
            resp = requests.get(f"http://localhost:{port}/api/health")
            if resp.status_code == 200:
                break
        except requests.exceptions.ConnectionError:
            pass
        time.sleep(0.5)
        
    yield port
    
    # Teardown
    proc.terminate()
    proc.wait()

@pytest.fixture
def page(context, request):
    page = context.new_page()
    script = "window.localStorage.setItem('lang', 'en');"
    if "test_f1" not in request.node.nodeid:
        script += "window.localStorage.setItem('jwt_token', 'dummy_token'); window.localStorage.setItem('user_info', JSON.stringify({'username': 'test', 'user_id': 1}));"
    page.add_init_script(script)
    return page

@pytest.fixture(scope="session")
def base_url(start_server):
    return f"http://localhost:{start_server}"
