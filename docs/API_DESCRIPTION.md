# Noodle — API & Interface Descriptions

This document describes all the web services, interfaces, APIs, and client-side storage systems utilized by Noodle to synchronize data, perform authentication, and manage state.

---

## 1. Moodle Web Service REST API

Noodle communicates directly with Tel Aviv University's Moodle server using standard HTTP REST requests. Because Moodle uses Web Services, we bypass session authentication for data synchronization and instead use a Web Service token (`wstoken`).

### Base Request Protocol
All API requests must target the Moodle REST server:
```
https://moodle.tau.ac.il/webservice/rest/server.php
```

All requests must include the following query parameters:
*   `wstoken`: The user's active Web Service token.
*   `moodlewsrestformat`: `json` (forces the response to be JSON; the default is XML).
*   `wsfunction`: The name of the specific Web Service function.

---

### Key Web Service Functions

#### 1. Retrieve Site & User Information
*   **Function Name:** `core_webservice_get_site_info`
*   **Method:** `GET` or `POST`
*   **Purpose:** Fetches metadata about the user's Moodle account, including their unique integer `userid` (needed for course and grade retrieval).
*   **Key Response Fields:**
    *   `userid` (number): The Moodle internal ID of the student.
    *   `username` (string): The student's SSO username.
    *   `fullname` (string): The student's full name.

#### 2. Retrieve Enrolled Courses
*   **Function Name:** `core_enrol_get_users_courses`
*   **Method:** `GET` or `POST`
*   **Parameters:**
    *   `userid`: The student's Moodle internal ID.
*   **Purpose:** Retrieves all active and historical courses in which the student is enrolled.
*   **Key Response Fields:**
    *   `id` (number): Moodle's internal course ID.
    *   `fullname` (string): Human-readable name of the course.
    *   `idnumber` (string): Academic metadata tracking code (e.g. `0368111801-2025-1`).
    *   `shortname` (string): Short identifier.

#### 3. Retrieve Course Contents (Files & Links)
*   **Function Name:** `core_course_get_contents`
*   **Method:** `GET` or `POST`
*   **Parameters:**
    *   `courseid`: The internal course ID.
*   **Purpose:** Fetches the full section-by-section breakdown of a course page, listing files, quizzes, assignments, and external URL resources.
*   **Parsing Logic:**
    *   **Files:** Identify modules where `modname === 'resource'`. Retrieve `fileurl` and `filename` from the `contents` array.
    *   **Zoom Meetings:** Multi-modal extraction detects Zoom sessions across all common Moodle configurations:
        *   **URL Modules (`modname === 'url'`):** Modules pointing directly to Zoom domains (`*.zoom.us`, `*.zoom.com`, `zoomgov.com`) or containing English/Hebrew meeting keywords in their title (e.g. "קישור לזום", "מפגש מקוון", "שיעור זום", "הרצאה מקוונת", "Zoom").
        *   **Zoom Activities (`modname === 'zoom'`):** Dedicated Moodle `mod_zoom` integration activities.
        *   **LTI Modules (`modname === 'lti'`):** LTI Zoom Pro modules with automatic fallback to the Moodle LTI launch URL (`/mod/lti/view.php?id={cmid}`) when scraping is disabled, unavailable, or yields no scheduled sessions.
        *   **Embedded HTML Links (`label`, `page`, descriptions, and section summaries):** Regular expression scans over HTML bodies to locate anchor links (`<a href="...zoom.us...">`) and plain-text URLs, extracting meeting IDs, passcodes, and direct links normalized to the university tenant (`https://tau-ac-il.zoom.us/j/...`).
        *   **Deduplication:** Collapses identical recurring links within the same course based on meeting number or URL and start time.

#### 4. Retrieve Assignments List
*   **Function Name:** `mod_assign_get_assignments`
*   **Method:** `GET` or `POST`
*   **Purpose:** Retrieves all Moodle assignment descriptions, base deadlines, and configurations across the user's courses in a single call.
*   **Key Response Fields:**
    *   `courses` (array): List of courses containing an `assignments` array.
    *   `id` (number): Moodle assignment ID.
    *   `cmid` (number): Course-module ID (used for linking and grades).
    *   `name` (string): Title of the assignment.
    *   `duedate` (number): Nominal deadline epoch timestamp.
    *   `cutoffdate` (number): Absolute deadline epoch timestamp.
    *   `allowsubmissionsfromdate` (number): Opening epoch timestamp.

#### 5. Retrieve Assignment Submission Status
*   **Function Name:** `mod_assign_get_submission_status`
*   **Method:** `GET` or `POST`
*   **Parameters:**
    *   `assignid`: The Moodle assignment ID.
*   **Purpose:** Retrieves the submission state for a specific student, including their progress status and personal extension deadline.
*   **Key Response Fields:**
    *   `lastattempt.submission.status` (string): Typically `submitted` or `new` / `draft`.
    *   `feedback.grade` (object): Contains grading status.
    *   `extensionduedate` (number): Personal deadline extension epoch timestamp.

#### 6. Retrieve Grades
*   **Function Name:** `gradereport_user_get_grade_items`
*   **Method:** `GET` or `POST`
*   **Parameters:**
    *   `courseid`: The internal course ID.
    *   `userid`: The student's user ID.
*   **Purpose:** Fetches all gradebook items for a course, which is filtered to map assignment grades.
*   **Key Response Fields:**
    *   `cmid` (number): Course-module ID (used to match with assignments).
    *   `graderaw` (number | null): Numeric grade.
    *   `grademax` (number | null): Max possible grade.
    *   `gradeformatted` (string): Formatted grade representation.
    *   `gradeishidden` (boolean): Flag indicating whether the grade is hidden by the teacher.

#### 7. File Upload (Submission Helper)
*   **Function Name:** `core_files_upload` (or standard multipart to `/webservice/upload.php`)
*   **Method:** `POST`
*   **Purpose:** Uploads a file to the Moodle draft file area on behalf of the user. Returns a draft item ID that must then be saved via assignment submission APIs.

---

## 2. Google Tasks REST API

Noodle synchronizes pending assignments to the user's Google Tasks account using direct HTTP endpoints.

### Authentication
*   **Type:** OAuth 2.0 (Bearer JWT Token in `Authorization: Bearer <TOKEN>` header).
*   **Scopes Required:** `https://www.googleapis.com/auth/tasks`
*   **Client IDs:** Unique Client IDs registered in the Google Cloud Console for the mobile application and the browser extension.

### Endpoints
*   **List Task Lists:** `GET https://tasks.googleapis.com/tasks/v1/users/@me/lists`
*   **Create Task List:** `POST https://tasks.googleapis.com/tasks/v1/users/@me/lists`
*   **List Tasks:** `GET https://tasks.googleapis.com/tasks/v1/lists/{tasklist_id}/tasks`
*   **Create Task:** `POST https://tasks.googleapis.com/tasks/v1/lists/{tasklist_id}/tasks`
*   **Update Task:** `PUT https://tasks.googleapis.com/tasks/v1/lists/{tasklist_id}/tasks/{task_id}`
*   **Patch Task:** `PATCH https://tasks.googleapis.com/tasks/v1/lists/{tasklist_id}/tasks/{task_id}`
*   **Delete Task:** `DELETE https://tasks.googleapis.com/tasks/v1/lists/{tasklist_id}/tasks/{task_id}`

### Data Synchronization Mapping
*   **Task Title:** Constructed as `[Course Code] Assignment Title` (e.g. `[03681118] Assignment 1`).
*   **Task Due Date:** Set to the Moodle assignment's True Deadline in ISO 8601 format (date-only: `YYYY-MM-DD`).
*   **Stable Identifier (Metadata):** Google Tasks has no custom field metadata. Noodle injects a deterministic string into the `notes` (description) field of the task:
    ```
    Noodle:assignId:{moodle_assign_id}
    ```
    This allows the sync engine to identify existing tasks without relying on unstable title matching.
*   **Hidden & Completed Task Deletion Policy (`GoogleTasksSyncOptions`):**
    *   **Hidden Tasks:** Assignments in `hiddenAssignmentIds` or marked `isHidden` **must never** be synced to Google Tasks. If an existing Google Task exists for a hidden assignment, it is immediately deleted via `DELETE`.
    *   **Marked as Done / Completed Tasks:** Assignments that are submitted in Moodle, marked in `completedAssignmentIds`, or marked completed in Google Tasks (`status: 'completed'`) are **deleted** from Google Tasks to prevent to-do clutter.
    *   **To Do Override:** If an assignment was submitted in Moodle but the student explicitly marked it as To Do (`uncompletedAssignmentIds`), it remains active with `status: 'needsAction'`.
    *   **Assignments Without Deadline Policy (`syncWithoutDeadline`):** If `syncWithoutDeadline` is falsy or `false` (default), assignments lacking explicit deadlines (`duedate === 0` or missing) are excluded from Google Tasks synchronization. Any pre-existing Google Task matching an undated assignment is pruned via `DELETE`. When `syncWithoutDeadline === true`, undated assignments are synchronized with the `due` field omitted.
    *   **Orphaned Cleanup:** Any task bearing a `Noodle:assignId` that is untracked or deleted is removed via `DELETE`. Personal non-Noodle tasks are strictly preserved.

---

## 3. Client Platform APIs

### Chrome Extension APIs (Manifest V3)
*   `chrome.webRequest`: Intercepts `onBeforeRedirect` events to catch custom URL schemes (like `moodlemobile://token=...`) during the SSO handshake, enabling silent wstoken retrieval without the high-privilege `cookies` permission.
*   `chrome.storage.local`: Encrypted-at-rest local storage for caching Moodle data and storing the raw `wstoken` securely.
*   `chrome.storage.sync`: Cloud-synchronized browser storage for lightweight user preferences (tracked course lists, colors, language settings).
*   `chrome.alarms`: Triggers the background Service Worker once per hour to run the synchronization engine.
*   `chrome.notifications`: Pushes native desktop notifications for upcoming assignment deadlines.
*   `chrome.identity`: Manages interactive Google OAuth flows to get Google API tokens.

### React Native & Expo APIs (Mobile)
*   `expo-secure-store`: Accesses hardware-backed keychains (iOS Keychain via Secure Enclave, Android Keystore via Trusted Execution Environment) to store the Moodle token and Google OAuth tokens.
*   `expo-sqlite`: Connects to a local SQLite database to query and persist courses, assignments, files, Zoom meetings, and local settings.
*   `expo-background-fetch` & `expo-task-manager`: Registers OS-level background sync workers (using iOS background tasks and Android `WorkManager`) to trigger periodic syncing.
*   `expo-notifications`: Handles scheduling, clearing, and triggering of local push alerts on the user's mobile device.
*   `expo-file-system` & `expo-sharing`: Downloads authenticated course files (by appending `?token={wstoken}` to Moodle file URLs) to the local sandboxed storage and invokes native share dialogs to open them in other apps (e.g., PDF readers).

---

## 4. Zoom LTI Scraping Protocol

To isolate and extract direct, session-free Zoom links (with their `pwd` passcodes) from Moodle courses, Noodle implements a multi-step scraping pipeline inside the `@tautracker/moodle-client` package.

### Authentication & Cookies Handshake
The scraper supports two authentication schemes depending on the execution context:
1. **SSO Headless login (Mobile app)**:
   Performs a programmatic SAML SSO handshake with `nidp.tau.ac.il` using the student's stored credentials. It builds a `CookieJar` which retains the `MoodleSessionMoodle2025` session cookie.
2. **Browser-Implicit Authentication (Chrome Extension)**:
   Leverages the browser's native cookie handling. By sending requests with `credentials: 'include'`, the browser automatically forwards the active `MoodleSession` session cookies and manages intermediate Zoom LTI cookies, bypassing any credential or custom cookie-injection requirements.

### Scraping Pipeline
For each tracked course:
1. **Fetch LTI Module**: Locates the course section module where `modname === 'lti'` and the name contains "zoom".
2. **Launch Verification**: Requests the LTI launch page `/mod/lti/view.php?id={moduleId}` using the session-authenticated connection.
3. **Parse Launch Form**: Extracts the auto-submitting form `id="tool_launch_form"` containing OAuth launch credentials.
4. **Submit LTI Launch**: Sends a `POST` request to the Zoom LTI provider (`https://applications.zoom.us/lti/rich`) with the launch credentials. This registers the Zoom session cookies in the browser's session or the mobile app's `CookieJar`.
5. **Get Zoom Config**: Parses `window.appConf` from the response to extract request authorization headers (`ajaxHeaders`).
6. **Fetch API Meetings**: Calls the Zoom LTI REST endpoints using the `ajaxHeaders`:
   * Upcoming: `/api/v1/lti/rich/meeting/upComing/COURSE/all?page=1&total=0`
   * Previous: `/api/v1/lti/rich/meeting/previous/COURSE/all?page=1&total=0`
7. **Extract Direct URLs**: Parses the meetings list and extracts the `m.joinUrl` field, which contains the direct Zoom URL with the password parameter (e.g., `https://tau-ac-il.zoom.us/j/{meetingNumber}?pwd={passcode}`). This direct URL is stored as `joinUrl` in the scraped results.

---

## 5. Moodle Strategy Interfaces (`packages/moodle-client`)

The `IMoodleStrategy` interface defines common operations across REST, AJAX, and Web Scraping tiers:

### Token Lifecycle Methods:
* `getMobileToken?(): Promise<string>`
  * Implemented by `ScraperMoodleStrategy`. Performs an authenticated POST to `/user/managetoken.php` with `action=resetwstoken&confirm=1` using active SSO cookies. Extracts and returns the newly generated Web Service token from `id="copytoclipboardtoken"`.
* `setToken?(token: string): void`
  * Implemented by all strategies (`RestMoodleStrategy`, `AjaxMoodleStrategy`, `ScraperMoodleStrategy`). Updates the internal `context.token` reference so that subsequent calls immediately use the refreshed token without rebuilding the strategy instances.

---

## 6. Optional Web Scraping Strategy Configuration

To optimize sync performance and ensure compliance with pure API standards, all web scraping functionality is optional and **default OFF**:

### Client Core Options
* **`MoodleClientOptions.enableScraping`** (`boolean`, default: `false`):
  * When `false`: `MoodleClient` initializes only `RestMoodleStrategy` and `AjaxMoodleStrategy`. HTML scraper fallback execution is completely bypassed.
  * When `true`: `ScraperMoodleStrategy` is appended to the fallback chain.
* **`RunSyncOptions.enableScraping`** (`boolean`, default: `false`):
  * Passed to `runSync(token, trackedCourseIds, onProgress, baseUrl, creds, moodleCookies, sesskey, onPartialSync, options)`.
  * When `false`, HTML web scraping and headless cookie-jar authentication are skipped, executing only standard Moodle API operations. Note: Zoom LTI discovery (`mod_lti_get_tool_launch_data`) runs via Moodle REST WS and does not require HTML scraping.

### Extension Storage & UI
* **`ExtensionSettings.scrapingEnabled`** (`boolean`, default: `false`):
  * Persisted in `browser.storage.local.get('settings')`.
  * User-configurable via the `#scraping-enabled-toggle` switch on the extension Settings page.
  * Forwarded to background service worker synchronization and Moodle client instances.

---

## 7. Zoom Meeting Extraction & Utilities (`@tautracker/moodle-client`)

### Multi-Modal Detection & Scraping
* **`scrapeZoomMeetingsWithToken(token: string, instanceId: number, baseUrl?: string): Promise<LtiZoomMeeting[]>`**:
  * Calls Moodle WS `mod_lti_get_tool_launch_data` using `wstoken` to get the Zoom LTI launch signature, fetches the Zoom session JSON endpoints (`/api/v1/lti/rich/meeting/upComing` and `/previous`), deduplicates `previous` rooms against `upComing`, normalizes start timestamps via `normalizeZoomStartTime`, and returns structured meeting objects with topic, direct `joinUrl`, `meetingNumber`, `password`, and ISO `startTime`.
* **`normalizeZoomStartTime(m: Record<string, any>, isUpcoming: boolean, referenceDate?: Date): string | undefined`**:
  * Sanitizes Zoom LTI Pro meeting timestamps. Strips creation timestamps returned by Zoom for "No Fixed Time" recurring rooms (`type === 3`), instant meetings (`type === 1`), PMI rooms (`type === 4`), and past/stale timestamps not aligned to 5-minute `:00` boundaries.
* **`collapseRecurringMeetings(meetings: ZoomMeeting[], referenceDate?: Date): ZoomMeeting[]`**:
  * Collapses recurring weekly sessions of the same room/meetingNumber into a single entry representing the currently active session (`startTime <= now <= startTime + 2h`), the nearest upcoming meeting, or the latest past meeting if none are active/upcoming.
  * Sorts active/upcoming sessions chronologically, then non-timestamped, then past sessions.
* **`isZoomUrl(url: string): boolean`**: Tests if a URL points to Zoom (`tau-ac-il.zoom.us`, `zoom.us`, `zoomgov.com`, etc.).
* **`isZoomOrMeetingName(name: string): boolean`**: Tests for English and Hebrew Zoom/meeting keywords (`זום`, `מפגש מקוון`, `שיעור מקוון`, `היוועדות חזותית`, `כיתה וירטואלית`, etc.).
* **`parseZoomUrl(rawUrl: string): { meetingUrl: string; meetingNumber?: string; password?: string }`**: Normalizes join links to `https://tau-ac-il.zoom.us/j/{id}?pwd={pwd}`.
* **`extractZoomLinksFromHtml(html: string): { url: string; title?: string }[]`**: Scans HTML strings (labels, section summaries, descriptions) for embedded Zoom hyperlinks.

---

## 8. Extension Background Message Passing Protocol (`apps/extension`)

Communication between the UI frontends (Options Page, Popup) and the background Service Worker uses a strongly-typed, synchronous one-time messaging protocol:

### Request Message Types
* **`SYNC_NOW`**: Triggers immediate full data synchronization (`performBackgroundSync()`). Returns `{ success: true, result: SyncResult }` or `{ success: false, error: string }`.
* **`SYNC_SETTINGS`**: Pulls and merges remote NOODLE_SYNC_DATA calendar settings (`performSettingsSync()`). Returns `{ success: true }` or `{ success: false, error: string }`.
* **`SYNC_GOOGLE_TASKS`**: Triggers Google Tasks synchronization (`interactive?: boolean`). Returns `{ success: true, status: string }` or `{ success: false, error: string }`.
* **`LOGIN_TAU_SSO`**: Programmatically executes TAU SSO SAML flow with student credentials. Returns `{ success: true, token: string }` or `{ success: false, error: string }`.
* **`VALIDATE_TOKEN`**: Validates a Moodle `wstoken` via `getSiteInfo()`. Returns `{ success: true, info: SiteInfo }` or `{ success: false, error: string }`.
* **`FETCH_ENROLLED_COURSES`**: Retrieves course list for onboarding. Returns `{ success: true, courses: Course[] }` or `{ success: false, error: string, errorcode?: string }`.
* **`LOGOUT`**: Clears cookies, local storage keys, and sync cache (`clearUserSession()`). Returns `{ success: true }` or `{ success: false, error: string }`.

### MV3 Service Worker Protocol
* **Synchronous Registration**: The listener is registered unconditionally at the top level of `serviceWorker.ts` before alarms or async operations.
* **Synchronous Channel Retention**: The handler invokes `sendResponse(result)` when its asynchronous promise resolves and returns `true` synchronously, preserving the native Chromium message port across cold-boot worker wake-ups.
* **Progressive Backoff**: Senders (`sendMessageToBackground`) utilize a 4-stage backoff (`200, 500, 1000, 1500 ms`, ~3.2s total) to wait for dormant workers to spin up, returning structured error objects on failure.
