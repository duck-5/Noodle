import pytest
from playwright.sync_api import Page, expect

def test_t2_f3_1_invalid_token(page: Page, base_url: str):
    page.goto(f"{base_url}/#/settings")
    page.fill("#moodle-token", "invalid_@#$")
    page.click("#validate-btn")
    expect(page.locator(".toast").first).to_contain_text("Validation failed")

def test_t2_f3_2_empty_token(page: Page, base_url: str):
    page.goto(f"{base_url}/#/settings")
    page.fill("#moodle-token", "")
    page.click("#validate-btn")
    expect(page.locator(".toast").first).to_contain_text("Validation failed")

def test_t2_f3_3_expired_token_simulation(page: Page, base_url: str):
    page.route("**/api/sync*", lambda route: route.fulfill(status=401, json={"error": "Token expired"}))
    page.goto(f"{base_url}/#/dashboard")
    page.click("#sync-now-btn")
    expect(page.locator(".toast").first).to_contain_text("Token expired")

def test_t2_f3_4_maximum_retries_timeout(page: Page, base_url: str):
    def handle_route(route):
        route.abort("timedout")
    page.route("**/api/sync*", handle_route)
    page.goto(f"{base_url}/#/dashboard")
    page.click("#sync-now-btn")
    # In api.js fetch throws 'Request failed' if no error response JSON
    expect(page.locator(".toast").first).to_contain_text("Request failed")

def test_t2_f3_5_very_long_string_token(page: Page, base_url: str):
    page.goto(f"{base_url}/#/settings")
    long_token = "a" * 1024
    page.fill("#moodle-token", long_token)
    page.route("**/api/settings/validate", lambda route: route.fulfill(status=400, json={"error": "Token too long"}))
    page.click("#validate-btn")
    expect(page.locator(".toast").first).to_contain_text("Token too long")
