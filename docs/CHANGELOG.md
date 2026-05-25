# Changelog

All notable changes in this uncommitted working copy are documented below. This release introduces package reorganization for clean modularity, a new developer block-inspection utility, and streamlined package-based imports.

---

## [Unreleased] - 2026-05-25

### Added
- **Developer Utility Script (`inspect_blocks.py`)**:
  - Added a diagnostic helper script to test retrieval of Moodle course blocks using the `core_block_get_course_blocks` endpoint, dumping results to `course_blocks.json`.

### Changed
- **Code Refactoring & Package Reorganization**:
  - Moved client modules (`moodle_client.py`, `google_client.py`, and `panopto_client.py`) into a unified `clients` package folder.
  - Created `clients/__init__.py` to cleanly expose public API functions (`get_enrolled_courses`, `get_pending_assignments`, `parse_course_metadata`, `get_new_lectures`, `get_google_services`, and `sync_data`).
  - Refactored `main.py`, `startup.py`, and `configure_courses.py` to import all client modules from the centralized `clients` package instead of direct parent-directory files.

---

## [1.0.0] - 2026-05-25


### Added
- **Interactive Setup Wizard (`startup.py`)**:
  - Created a comprehensive CLI onboarding wizard that guides new users through the entire configuration flow.
  - Automatically initializes `.env` from `.env.example`.
  - Prompts and saves the `MOODLE_TOKEN` inside `.env`.
  - Integrates Moodle course selection to dynamically populate `MOODLE_COURSES`.
  - Verifies the existence of `credentials.json` and helps troubleshoot missing Google Cloud client secrets.
  - Automates Google OAuth flow to safely write `token.json` locally.
  - Detects Playwright status and prompts to install headless browsers (`playwright install`).
  - Provides a manual validation step to run a test synchronization cycle (`main.py`).
- **Interactive Moodle Course Configurator (`configure_courses.py`)**:
  - Developed a standalone utility enabling users to filter, search, and select specific courses to synchronize.
  - Automatically groups Moodle courses into academic semesters (e.g., `2025 - Semester B`) and highlights the detected "active" semester.
  - Allows selecting courses to sync, updating the `.env` file's `MOODLE_COURSES` variable, and generating matching `PANOPTO_COURSE_{id}` placeholders.
- **Dynamic Semester Metadata Parsing (`moodle_client.py`)**:
  - Added `parse_course_metadata()` to decode course code, academic year, group ID, and semester code (Semester A, Semester B, Yearly) from Moodle's `idnumber` or `shortname` string (following Tel Aviv University's structural pattern: `[8-digit Course Code]-[2-digit Group]-[4-digit Year]-[1-digit Semester]`).
- **Enrolled Courses Retriever (`moodle_client.py`)**:
  - Implemented `get_enrolled_courses()` which queries the Moodle Web Service API in two steps:
    1. Calls `core_webservice_get_site_info` to retrieve the current user's Moodle `userid`.
    2. Calls `core_enrol_get_users_courses` using that `userid` to pull all course enrollments.
- **Dynamic Worksheet Management (`google_client.py`)**:
  - Introduced automatic spreadsheet segmentation! Assignments and lectures are now routed to specific worksheets based on their year/semester metadata (e.g., `2025-SemesterA`), preventing a single monolithic sheet clutter.
  - Implemented dynamic worksheet creation: if a worksheet for a semester does not exist in the Google Spreadsheet, the client automatically adds it and formats the header row (`A1:G1` as bold text).
  - Individualized tracking for each worksheet: each sheet maintains its own last sync timestamp in cell `I1`, sorting, and row insertion.

### Changed
- **Orchestration Flow (`main.py`)**:
  - Refactored `job()` to retrieve `course_metadata` from Moodle and pass it directly to `sync_data()`.
- **Moodle Client (`moodle_client.py`)**:
  - Modified `get_pending_assignments()` to query all enrolled courses first, building a comprehensive mapping between course IDs and display names.
  - Cleaned up display name formatting to extract clean Hebrew/English strings (e.g., stripping course prefix and Jewish calendar year noise).
  - Updated returned values to include `course_metadata` as a third return variable.
- **Google Client (`google_client.py`)**:
  - Refactored `sync_data()` to group assignments and lectures by worksheet based on metadata parsing.
  - Enhanced error handling to isolate sheet-specific failures so a single missing sheet does not break sync for other sheets.
  - Upgraded logging to prefix all sync steps with the target sheet's name (e.g., `[2025-SemesterA] Queued Assignment: ...`).
- **Onboarding Documentation (`README.md`)**:
  - Updated Google Cloud Console desktop client instructions to specify the "Audience" publishing requirements to prevent 7-day token expiration.
  - Replaced manual `.env` setup instructions with details on using the interactive setup wizard (`python startup.py`).

---

## Detailed File Diff Summary

### 1. `moodle_client.py`
- Added imports for `re`.
- Created helper `parse_course_metadata(course)`.
- Created API caller `get_enrolled_courses()`.
- Refactored `get_pending_assignments()`:
  - Calls `get_enrolled_courses()` and constructs `course_mapping` and `course_metadata`.
  - Integrates course metadata return signature: `return pending_assignments, course_mapping, course_metadata`.

### 2. `google_client.py`
- Added support for `course_metadata` dict argument in `sync_data()`.
- Created worksheet selection helper `get_worksheet_name()`.
- Grouped both assignments and lectures by target sheet.
- Added dynamic worksheet creation block with `ws.format("A1:G1", {"textFormat": {"bold": True}})` formatting.
- Loop-wrapped synchronization logic to execute sheet-by-sheet with separate date parsing, sorting, and I1 cell sync state updates.

### 3. `main.py`
- Unpacked the additional `course_metadata` return value from Moodle.
- Passed `course_metadata` to the Google Sheet sync service.

### 4. `README.md`
- Streamlined setup steps to leverage the CLI configuration tool (`startup.py`).
- Added troubleshooting tips for Google Cloud Audience publication to avoid token expiration.
