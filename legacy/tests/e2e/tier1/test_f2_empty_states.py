import pytest
import re
from playwright.sync_api import Page, expect

def test_dashboard_zero_courses_empty_state(auth_page: Page):
    auth_page.goto("/#/")
    empty_state = auth_page.get_by_text("You haven't configured any courses yet.")
    expect(empty_state).to_be_visible()
    cta = auth_page.get_by_role("button", name="Configure Courses")
    expect(cta).to_be_visible()

def test_course_no_materials_empty_state(auth_page: Page):
    auth_page.goto("/#/courses/1") # mock course with no materials
    expect(auth_page.get_by_text("Moodle token not configured")).to_be_visible()

def test_add_data_replaces_empty_state(auth_page: Page):
    auth_page.goto("/#/")
    expect(auth_page.get_by_text("You haven't configured any courses yet.")).to_be_visible()
    
    auth_page.get_by_role("button", name="Configure Courses").click()
    expect(auth_page).to_have_url(re.compile(r".*#/courses"))

def test_clear_data_reverts_to_empty_state(auth_page: Page):
    auth_page.goto("/#/")
    expect(auth_page.get_by_text("You haven't configured any courses yet.")).to_be_visible()
