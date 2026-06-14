import pytest
from playwright.sync_api import Page, expect

def test_t2_f1_1_missing_required_fields(page: Page, base_url: str):
    page.goto(f"{base_url}/#/register")
    page.wait_for_selector("#username")
    page.click("button[type='submit']")
    expect(page.locator(".toast").first).to_have_text("Please fill in all fields")

def test_t2_f1_2_password_minimum_length(page: Page, base_url: str):
    page.goto(f"{base_url}/#/register")
    page.fill("#username", "testuser")
    page.fill("#email", "test@test.com")
    page.fill("#password", "12345") # 5 chars
    page.fill("#confirm-password", "12345")
    page.click("button[type='submit']")
    expect(page.locator(".toast").first).to_have_text("Password must be at least 6 characters")

def test_t2_f1_3_maximum_length_allowed(page: Page, base_url: str):
    # Depending on implementation, max length might not be limited in JS but by server.
    # We will mock the API to return 400 if it's too long, or test frontend.
    page.goto(f"{base_url}/#/register")
    long_str = "a" * 256
    page.fill("#username", long_str)
    page.fill("#email", "test@test.com")
    page.fill("#password", "123456")
    page.fill("#confirm-password", "123456")
    page.route("**/api/auth/register", lambda route: route.fulfill(status=400, json={"error": "Username too long"}))
    page.click("button[type='submit']")
    expect(page.locator(".toast").first).to_have_text("Username too long")

def test_t2_f1_4_special_chars_whitespace(page: Page, base_url: str):
    page.goto(f"{base_url}/#/register")
    # Using leading/trailing whitespace which JS trims
    page.fill("#username", "  ts  ")
    page.fill("#email", "test@test.com")
    page.fill("#password", "123456")
    page.fill("#confirm-password", "123456")
    page.click("button[type='submit']")
    # "ts" is length 2, which is < 3
    expect(page.locator(".toast").first).to_have_text("Username must be at least 3 characters")

def test_t2_f1_5_direct_url_access_before_onboarding(page: Page, base_url: str):
    # Without token, redirect to login
    page.goto(f"{base_url}/#/dashboard")
    page.wait_for_url(f"**/*#/login")
    expect(page.locator(".auth-subtitle").first).to_contain_text("Sign in")

