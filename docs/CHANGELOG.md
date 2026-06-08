# Changelog

All notable changes in this working copy are documented below.

---

## [Unreleased] - 2026-06-08 (Patch 2)

### Added
- **Moodle Assignment Grades Fetching (`clients/moodle_client.py`, `clients/__init__.py`)**:
  - Implemented `get_assignment_grades(enrolled_courses)` which calls `gradereport_user_get_grade_items` for each enrolled course and builds a dict keyed by `cmid` (int), containing `gradeformatted`, `graderaw`, `grademax`, and `gradeishidden`.
  - Exposed in `clients/__init__.py` for direct import by the orchestrator.
- **Grades wired into the sync job (`main.py`)**:
  - `job()` now calls `get_assignment_grades()` after fetching assignments, deduplicating courses by `course_id` to avoid redundant API calls, and passes the resulting `grades_by_cmid` dict to `sync_data()`.

### Fixed
- **Epoch `1970-01-01` deadline artifact (`clients/moodle_client.py`)**:
  - Previously, when an assignment had no due date (`duedate=0`), the deadline was written as `1970-01-01 02:00:00` (Unix epoch). Now, `deadline_str` is set to an empty string `''` when `final_deadline_ts == 0`, preventing the bad epoch date from appearing in the spreadsheet.
- **UTF-8 encoding for logs and stdout (`main.py`)**:
  - Set `sys.stdout` encoding to `utf-8` (with `errors='replace'`) and opened `TauTracker.log` with `encoding='utf-8'` to prevent `UnicodeEncodeError` crashes when logging Hebrew course names on Windows.

### Removed
- Deleted stale developer diagnostic scripts (`inspect_blocks.py`, `inspect_course_contents.py`, `inspect_functions.py`, `search_moodle_functions.py`, `search_transcript.py`) that are no longer needed after the auto-discovery and clients package was established.

---

## [Unreleased] - 2026-06-08

### Added
- **Configurable Google Tasks List (`config.py`, `.env.example`, `clients/google_client.py`)**:
  - Introduced `GOOGLE_TASKS_LIST` environment variable (default: `"General"`) that controls which named Google Tasks list TauTracker syncs assignments into.
  - Added `get_or_create_tasklist(tasks_service, list_name)` helper in `google_client.py`: looks up the list by name from the user's tasklists (case-insensitive), and automatically creates it if it does not exist. Falls back to `@default` on any API error.
  - Threaded the resolved `tasklist_id` through `sync_task()` (new keyword argument) and the pre-fetch `tasks().list()` call in `sync_data()`, replacing all previously hardcoded `tasklist='@default'` references.

---

## [Previous Unreleased] - 2026-05-25

### Changed
- **Renamed Panopto/SSO Credential Keys (`config.py`, `.env.example`)**:
  - Renamed `PANOPTO_USER` → `UNIVERSITY_USERNAME`, `PANOPTO_PASS` → `UNIVERSITY_PASSWORD`, and `PANOPTO_PID` → `STUDENT_ID` to reflect that these credentials belong to the university SSO system (used for both Moodle and Panopto), not Panopto alone.
  - Updated `config.py` to read from the new env var names.
  - Updated `.env.example` to document the new names under a clearer comment: `# University SSO Credentials`.

### Added
- **Panopto Scraping Feature Flag (`config.py`, `.env.example`, `clients/panopto_client.py`)**:
  - Introduced `SCRAPE_PANOPTO` environment variable (set to `1` to enable, default `0`/disabled).
  - `config.py` reads `SCRAPE_PANOPTO` and exposes it as a boolean.
  - `panopto_client.py`'s `get_new_lectures()` returns early with an info log when `SCRAPE_PANOPTO` is falsy, allowing users to opt-out of Playwright headless browser usage entirely.
- **Legacy Credential Migration in Setup Wizard (`startup.py`)**:
  - The setup wizard now auto-detects old-style `PANOPTO_USER` / `PANOPTO_PASS` / `PANOPTO_PID` keys in `.env` and silently migrates them to the new names (`UNIVERSITY_USERNAME`, `UNIVERSITY_PASSWORD`, `STUDENT_ID`), removing the old keys.
- **Interactive SSO Credential Entry in Setup Wizard (`startup.py`)**:
  - If SSO credentials are not yet configured when the wizard needs to resolve Panopto folders, users are now interactively prompted (with `getpass` for password masking) to enter their university login details, which are saved directly to `.env`.
- **Interactive `SCRAPE_PANOPTO` Enable Prompt (`startup.py`)**:
  - If Panopto scraping is disabled, the wizard now asks the user whether to enable it and writes `SCRAPE_PANOPTO=1` to `.env` if they confirm.

---

## [Previous Unreleased] - 2026-05-25

### Added
- **Automated Panopto Folder Auto-Discovery (`clients/panopto_client.py`)**:
  - Implemented `resolve_course_panopto_folders()` using Playwright network interception to automate Moodle SSO login, navigate to course main view pages, and trigger LTI integration viewer clicks.
  - Captures `deliveryinfo.aspx` AJAX payloads to dynamically parse and extract `SessionGroupPublicID` or `FolderId`.
- **Integrated Panopto Auto-Discovery into Setup Wizard (`startup.py`)**:
  - Automatically prompts users to discover and map Panopto courses using saved Moodle SSO credentials, eliminating manual copy-paste steps for `PANOPTO_COURSE_{id}` variables in `.env`.
- **Developer Diagnostic Utilities**:
  - Added `inspect_course_contents.py` to fetch Moodle course structures via `core_course_get_contents`.
  - Added `inspect_functions.py` to fetch Moodle web service functions via `core_webservice_get_site_info` and search for Panopto integrations.
  - Added `search_moodle_functions.py` to filter site info functions for block, LTI, and tool keywords.
  - Added `search_transcript.py` to query local conversation transcripts for Panopto credentials/IDs.
- **Enterprise `.gitignore` Upgrade (`.gitignore`)**:
  - Redesigned gitignore configuration to secure sensitive API keys, local databases, and diagnostic files containing personal/academic details (`site_info.json`, `course_contents.json`, `course_blocks.json`, etc.).


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
