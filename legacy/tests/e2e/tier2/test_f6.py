import pytest
from playwright.sync_api import Page, expect

def test_t2_f6_1_last_pending_task(page: Page, base_url: str):
    page.route("**/api/assignments*", lambda route: route.fulfill(status=200, json=[{"id": 1, "title": "Task 1", "status": "pending"}]))
    page.route("**/api/assignments/1/status", lambda route: route.fulfill(status=200, json={"success": True}))
    page.goto(f"{base_url}/#/assignments")
    expect(page.locator(".pending-count")).to_have_text("1")
    page.click(".task-checkbox")
    expect(page.locator(".pending-count")).to_have_text("0")

def test_t2_f6_2_done_to_pending(page: Page, base_url: str):
    page.route("**/api/assignments*", lambda route: route.fulfill(status=200, json=[{"id": 1, "title": "Task 1", "status": "done"}]))
    page.route("**/api/assignments/1/status", lambda route: route.fulfill(status=200, json={"success": True}))
    page.goto(f"{base_url}/#/assignments")
    expect(page.locator(".pending-count")).to_have_text("0")
    page.click(".task-checkbox")
    expect(page.locator(".pending-count")).to_have_text("1")

def test_t2_f6_3_rapid_successive_clicks(page: Page, base_url: str):
    page.route("**/api/assignments*", lambda route: route.fulfill(status=200, json=[{"id": 1, "title": "Task 1", "status": "pending"}]))
    # Delay API response to simulate race condition
    def handle_route(route):
        import time
        time.sleep(0.5)
        route.fulfill(status=200, json={"success": True})
    page.route("**/api/assignments/1/status", handle_route)
    page.goto(f"{base_url}/#/assignments")
    for _ in range(5):
        page.click(".task-checkbox")
    # Wait for requests to settle
    page.wait_for_timeout(3000)
    # The final state depends on whether it's odd or even clicks, 5 clicks -> done
    expect(page.locator(".task-checkbox")).to_be_checked()

def test_t2_f6_4_very_old_tasks(page: Page, base_url: str):
    # Old task boundary, like epoch 0
    page.route("**/api/assignments*", lambda route: route.fulfill(status=200, json=[{"id": 1, "title": "Old Task", "status": "pending", "due_date": "1970-01-01T00:00:00Z"}]))
    page.route("**/api/assignments/1/status", lambda route: route.fulfill(status=200, json={"success": True}))
    page.goto(f"{base_url}/#/assignments")
    page.click(".task-checkbox")
    expect(page.locator(".task-checkbox")).to_be_checked()

def test_t2_f6_5_offline_timeout_rollback(page: Page, base_url: str):
    page.route("**/api/assignments*", lambda route: route.fulfill(status=200, json=[{"id": 1, "title": "Task 1", "status": "pending"}]))
    page.route("**/api/assignments/1/status", lambda route: route.abort("internetdisconnected"))
    page.goto(f"{base_url}/#/assignments")
    expect(page.locator(".task-checkbox")).not_to_be_checked()
    page.click(".task-checkbox")
    # Should check optimistically, then uncheck on failure
    expect(page.locator(".toast").first).to_contain_text("Failed to update status")
    expect(page.locator(".task-checkbox")).not_to_be_checked()
