import pytest
from playwright.sync_api import Page, expect

def test_sync_missing_token_error(auth_page: Page):
    auth_page.goto("/settings")
    auth_page.get_by_role("button", name="Sync Moodle").click()
    
    error_banner = auth_page.get_by_role("alert")
    expect(error_banner).to_contain_text("Moodle token is missing")

def test_sync_invalid_token_error(auth_page: Page):
    auth_page.goto("/settings")
    auth_page.get_by_label("Moodle Token").fill("invalid_token")
    auth_page.get_by_role("button", name="Save").click()
    auth_page.get_by_role("button", name="Sync Moodle").click()
    
    error_banner = auth_page.get_by_role("alert")
    expect(error_banner).to_contain_text("Invalid Credentials")

def test_token_error_action_link(auth_page: Page):
    auth_page.goto("/")
    auth_page.get_by_role("button", name="Sync Moodle").click()
    
    error_banner = auth_page.get_by_role("alert")
    action_link = error_banner.get_by_role("link", name="Go to Settings")
    expect(action_link).to_be_visible()

def test_error_toast_dismissible(auth_page: Page):
    auth_page.goto("/settings")
    auth_page.get_by_role("button", name="Sync Moodle").click()
    
    error_banner = auth_page.get_by_role("alert")
    expect(error_banner).to_be_visible()
    
    error_banner.get_by_role("button", name="Dismiss").click()
    expect(error_banner).not_to_be_visible()

def test_valid_token_clears_errors(auth_page: Page):
    auth_page.goto("/settings")
    auth_page.get_by_role("button", name="Sync Moodle").click()
    
    error_banner = auth_page.get_by_role("alert")
    expect(error_banner).to_be_visible()
    
    auth_page.get_by_label("Moodle Token").fill("valid_token_123")
    auth_page.get_by_role("button", name="Save").click()
    auth_page.get_by_role("button", name="Sync Moodle").click()
    
    expect(auth_page.get_by_role("alert")).not_to_be_visible()
    expect(auth_page.get_by_text("Sync successful")).to_be_visible()
