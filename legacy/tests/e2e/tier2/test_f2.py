import pytest
from playwright.sync_api import Page, expect

def test_t2_f2_1_exactly_0_courses(page: Page, base_url: str):
    # Mock API to return 0 courses
    page.route("**/api/courses*", lambda route: route.fulfill(status=200, json=[]))
    page.goto(f"{base_url}/#/dashboard")
    expect(page.locator(".empty-state-courses")).to_be_visible()

def test_t2_f2_2_exactly_1_course(page: Page, base_url: str):
    # Mock API to return 1 course
    page.route("**/api/courses*", lambda route: route.fulfill(status=200, json=[{"id": 1, "name": "Course 1"}]))
    page.goto(f"{base_url}/#/dashboard")
    expect(page.locator(".empty-state-courses")).to_be_hidden()
    expect(page.locator(".course-list-item").first).to_be_visible()

def test_t2_f2_3_exactly_0_tasks(page: Page, base_url: str):
    page.route("**/api/assignments*", lambda route: route.fulfill(status=200, json=[]))
    page.goto(f"{base_url}/#/assignments")
    expect(page.locator(".empty-state-tasks")).to_be_visible()

def test_t2_f2_4_exactly_1_task(page: Page, base_url: str):
    page.route("**/api/assignments*", lambda route: route.fulfill(status=200, json=[{"id": 1, "title": "Task 1"}]))
    page.goto(f"{base_url}/#/assignments")
    expect(page.locator(".empty-state-tasks")).to_be_hidden()
    expect(page.locator(".task-list-item").first).to_be_visible()

def test_t2_f2_5_deleting_last_task(page: Page, base_url: str):
    page.route("**/api/assignments*", lambda route: route.fulfill(status=200, json=[{"id": 1, "title": "Task 1"}]))
    page.route("**/api/assignments/1", lambda route: route.fulfill(status=200, json={"success": True}))
    page.goto(f"{base_url}/#/assignments")
    expect(page.locator(".task-list-item")).to_have_count(1)
    
    # Click delete
    page.click(".delete-task-btn")
    expect(page.locator(".task-list-item")).to_have_count(0)
    expect(page.locator(".empty-state-tasks")).to_be_visible()
