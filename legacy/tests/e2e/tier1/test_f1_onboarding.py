import pytest
from playwright.sync_api import Page, expect

def test_new_user_walkthrough_appears(page: Page):
    page.goto("/")
    page.get_by_text("Create Account").click()
    page.get_by_label("Username").fill("newuser")
    page.get_by_label("Email Address").fill("new@example.com")
    page.get_by_label("Password", exact=True).fill("password")
    page.get_by_label("Confirm Password").fill("password")
    page.get_by_role("button", name="Register Account").click()
    
    page.wait_for_selector("button:has-text('Sign In')")
    page.get_by_label("Username").fill("newuser")
    page.get_by_label("Password", exact=True).fill("password")
    page.get_by_role("button", name="Sign In").click()

    walkthrough = page.locator(".driver-popover")
    expect(walkthrough).to_be_visible(timeout=10000)

def test_walkthrough_skip(page: Page):
    page.goto("/")
    page.get_by_text("Create Account").click()
    page.get_by_label("Username").fill("newuser_skip")
    page.get_by_label("Email Address").fill("skip@example.com")
    page.get_by_label("Password", exact=True).fill("password")
    page.get_by_label("Confirm Password").fill("password")
    page.get_by_role("button", name="Register Account").click()
    
    page.wait_for_selector("button:has-text('Sign In')")
    page.get_by_label("Username").fill("newuser_skip")
    page.get_by_label("Password", exact=True).fill("password")
    page.get_by_role("button", name="Sign In").click()

    walkthrough = page.locator(".driver-popover")
    expect(walkthrough).to_be_visible(timeout=10000)
    
    # Auto-accept the skip confirmation dialog
    page.on("dialog", lambda dialog: dialog.accept())
    
    # Close button is provided by driver.js
    page.locator(".driver-popover-close-btn").click()
    expect(walkthrough).not_to_be_visible()
    
    page.reload()
    expect(page.locator(".driver-popover")).not_to_be_visible()

def test_walkthrough_next_steps(page: Page):
    page.goto("/")
    page.get_by_text("Create Account").click()
    page.get_by_label("Username").fill("newuser_next")
    page.get_by_label("Email Address").fill("next@example.com")
    page.get_by_label("Password", exact=True).fill("password")
    page.get_by_label("Confirm Password").fill("password")
    page.get_by_role("button", name="Register Account").click()
    
    page.wait_for_selector("button:has-text('Sign In')")
    page.get_by_label("Username").fill("newuser_next")
    page.get_by_label("Password", exact=True).fill("password")
    page.get_by_role("button", name="Sign In").click()

    walkthrough = page.locator(".driver-popover")
    expect(walkthrough).to_be_visible(timeout=10000)
    
    import re
    # Next, Next, Done/Finish
    walkthrough.get_by_role("button", name=re.compile("Next", re.IGNORECASE)).click()
    walkthrough.get_by_role("button", name=re.compile("Next", re.IGNORECASE)).click()
    walkthrough.get_by_role("button", name=re.compile("Next", re.IGNORECASE)).click()
    
    # After final step it should be hidden
    expect(walkthrough).not_to_be_visible()

def test_existing_user_no_walkthrough(page: Page):
    page.goto("/")
    page.get_by_label("Username").fill("existinguser")
    page.get_by_label("Password", exact=True).fill("password")
    page.get_by_role("button", name="Sign In").click()
    
    expect(page.locator(".driver-popover")).not_to_be_visible()

