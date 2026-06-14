import pytest
from playwright.sync_api import Page, expect

def test_auth_and_dashboard_empty_state(auth_page: Page):
    auth_page.goto("/#/dashboard")
    auth_page.wait_for_timeout(1000)
    expect(auth_page.locator(".empty-state").first).to_be_visible()

def test_sync_and_notifications(auth_page: Page):
    auth_page.goto("/#/dashboard")
    auth_page.wait_for_timeout(1000)
    
    sync_btn = auth_page.locator("#sync-now-btn")
    expect(sync_btn).to_be_visible()
    sync_btn.click()
    
    expect(auth_page.locator("#toast-container")).to_be_visible()
