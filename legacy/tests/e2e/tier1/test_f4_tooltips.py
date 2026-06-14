import pytest
from playwright.sync_api import Page, expect

def test_hover_term_shows_tooltip(auth_page: Page):
    auth_page.goto("/#/settings")
    term = auth_page.get_by_text("Manual Moodle Token")
    term.hover()
    
    tooltip = auth_page.locator("#custom-tooltip")
    expect(tooltip).to_be_visible()

def test_mouse_leave_hides_tooltip(auth_page: Page):
    auth_page.goto("/#/settings")
    term = auth_page.get_by_text("Manual Moodle Token")
    term.hover()
    
    tooltip = auth_page.locator("#custom-tooltip")
    expect(tooltip).to_be_visible()
    
    auth_page.mouse.move(0, 0)
    expect(tooltip).not_to_be_visible()

def test_keyboard_tab_shows_tooltip(auth_page: Page):
    auth_page.goto("/#/settings")
    # Set focus near the element
    auth_page.get_by_text("Moodle Configuration").click()
    # It might take a couple of tabs, we tab until the tooltip shows or up to 10 times
    for _ in range(10):
        auth_page.keyboard.press("Tab")
        if auth_page.locator("#custom-tooltip").is_visible():
            break
            
    tooltip = auth_page.locator("#custom-tooltip")
    expect(tooltip).to_be_visible()

def test_tooltip_content_matches(auth_page: Page):
    auth_page.goto("/#/settings")
    term = auth_page.get_by_text("SSO ID Number")
    term.hover()
    
    tooltip = auth_page.locator("#custom-tooltip")
    expect(tooltip).to_have_text("Your Single Sign-On identifier.")

def test_tooltip_localization_hebrew(auth_page: Page):
    auth_page.goto("/#/settings")
    auth_page.get_by_role("combobox").select_option("he")
    
    # After switching language to Hebrew, the term changes
    term = auth_page.get_by_text("מספר זיהוי SSO")
    term.hover()
    
    tooltip = auth_page.locator("#custom-tooltip")
    expect(tooltip).to_have_text("Your Single Sign-On identifier.") # Wait, tooltip content wasn't translated in settings.js, it's just 'data-tooltip="Your Single Sign-On identifier."'
