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

All requests must include the following parameters:
*   `wstoken`: The user's active Web Service token.
*   `moodlewsrestformat`: `json` (forces the response to be JSON; the default is XML).
*   `wsfunction`: The name of the specific Web Service function.
*   `moodlewssettingfilter`: `true` (instructs Moodle to apply text filters such as `multilang`).
*   `moodlewssettinglang`: `he` (prefers Hebrew strings when multilang tags are present).

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
    *   **Folders (`mod_folder`):** Moodle's `core_course_get_contents` invokes `folder_export_contents($cm, $baseurl)` in `mod/folder/lib.php` to export the full list of files inside the folder module. Noodle extracts each file into `CourseFolderFile` preserving `fileName`, `fileSize`, `fileUrl`, `downloadUrl`, `timeModified`, `mimeType`, and internal nested directory paths (`relativePath`), allowing direct file exploration and single-file downloads without HTML scraping.
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
    *   `cutoffdate` (number): Late submission cut-off epoch timestamp (grace period).
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

#### 5.1 True Deadline & Late Submission Grace Period Mapping
*   **True Deadline Calculation (`syncEngine.ts`)**:
    The official due date displayed in calendars and deadline countdowns strictly prioritizes individual extensions and nominal due dates over late submission cutoffs:
    $$\text{deadline} = \begin{cases} \text{extensionduedate} & \text{if } \text{extensionduedate} > 0 \\ \text{duedate} & \text{else if } \text{duedate} > 0 \\ \text{cutoffdate} & \text{else} \end{cases}$$
*   **Grace Period Exposure (`cutoffDate`)**:
    When a professor configures a late submission cut-off date beyond the official due date ($\text{cutoffdate} > \text{deadline}$), Noodle sets:
    $$\text{cutoffDate} = \text{new Date}(\text{cutoffdate} \times 1000)\text{.toISOString()}$$
    When $\text{cutoffdate} \le \text{deadline}$, `cutoffDate` is `null`.
*   **Client Grace Period Helper (`hasGracePeriod(assignment)`)**:
    Returns `true` when `assignment.cutoffDate` is present and non-null. The client renders an inline SVG clock icon (`ClockIcon`) with a localized tooltip (`"Late assignment accepted til {date}"` / `"מטלות באיחור יתקבלו עד {date}"`) next to the nominal deadline across the Dashboard, Assignments Feed, Monthly Calendar, and Popup.

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

#### 7. Retrieve Quizzes & Exams (mod_quiz)
*   **Function Name:** `mod_quiz_get_quizzes_by_courses`
*   **Method:** `POST`
*   **Parameters:** `courseids[0]={courseid}`
*   **Purpose:** Retrieves all Moodle quiz and online exam descriptions, availability windows, time restrictions, and allowed attempt limits.
*   **Key Response Fields:**
    *   `id` (number): Quiz instance ID.
    *   `coursemodule` (number): Course module ID (`cmid`).
    *   `name` (string): Quiz title (sanitized via `cleanMoodleString`).
    *   `timeopen` (number): Quiz opening epoch timestamp.
    *   `timeclose` (number): Quiz deadline epoch timestamp.
    *   `timelimit` (number): Duration restriction in seconds (e.g. 1800 for 30 minutes).
    *   `attempts` (number): Allowed attempt limit (0 = unlimited).

#### 8. Retrieve Quiz Attempt History
*   **Function Name:** `mod_quiz_get_user_attempts`
*   **Method:** `POST`
*   **Parameters:** `quizid={quizid}`, `status='all'`
*   **Purpose:** Queries attempt records for the authenticated student to determine completion state.
*   **Key Response Fields:**
    *   `attempts` (array): List of user attempts with `state` (`'finished'`, `'inprogress'`, or `'abandoned'`). An attempt with `state === 'finished'` automatically marks the quiz as completed.

#### 9. Update Manual Activity Completion (Two-Way Sync)
*   **Function Name:** `core_completion_update_activity_completion_status_manually`
*   **Method:** `POST`
*   **Parameters:** `cmid={cmid}`, `completed={1 | 0}`
*   **Purpose:** Dispatches user-toggled "Mark as done" (`סמן כבוצע`) states back to the Moodle server for activities configured with manual completion tracking (`completion === 1`).

#### 10. Fetch Course Format AJAX State (2-Level Hierarchy)
*   **Endpoint:** `/lib/ajax/service.php?sesskey={sesskey}&info=core_courseformat_get_state`
*   **Method:** `POST` (JSON payload)
*   **Purpose:** Reconstructs the 2-level hierarchical topic/subtopic tab tree:
    *   `tabsdata` array in `multitopic` format (parent tab `sectionid` to child `subtree` items).
    *   `parentid` and `levelsan` attributes in `onetopic` format.
    *   Moodle 4.5 nested sub-sections (`mod_subsection` sub-components).

#### 11. File Upload (Submission Helper)
*   **Function Name:** `core_files_upload` (or standard multipart to `/webservice/upload.php`)
*   **Method:** `POST`
*   **Purpose:** Uploads a file to the Moodle draft file area on behalf of the user. Returns a draft item ID that must then be saved via assignment submission APIs.

> [!WARNING]
> **Deprecation Notice — HTML Scraping Strategy (`ScraperMoodleStrategy`):**
> HTML scraping via regular expressions is fragile and prone to breakage across TAU Moodle theme and version updates. It is permanently deprecated for all newly introduced structures (quizzes, format hierarchy, folders, announcements), which strictly rely on official Web Services and AJAX endpoints.

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
    # OR for quizzes:
    Noodle:quizId:{moodle_quiz_id}
    # OR unified composite UID:
    Noodle:uid:{assign|quiz}:{id}
    ```
    This allows the sync engine to identify existing tasks without relying on unstable title matching across both assignments and quizzes.
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

## 6. Legacy Web Scraping Strategy Configuration (`@deprecated`)

To optimize sync performance and ensure compliance with pure API standards, the HTML web scraping fallback option has been **removed from the extension Settings UI** and marked as `@deprecated` legacy code:

### Client Core Options (`@deprecated` Legacy)
* **`MoodleClientOptions.enableScraping`** (`boolean`, default: `false`, `@deprecated`):
  * When `false` (default and always forced by the extension): `MoodleClient` initializes only `RestMoodleStrategy` and `AjaxMoodleStrategy`. HTML scraper fallback execution is completely bypassed.
  * When `true`: `ScraperMoodleStrategy` (legacy `@deprecated` class) is appended to the fallback chain in standalone client tests.
* **`RunSyncOptions.enableScraping`** (`boolean`, default: `false`, `@deprecated`):
  * Passed to `runSync(token, trackedCourseIds, onProgress, baseUrl, creds, moodleCookies, sesskey, onPartialSync, options)`.
  * When `false`, HTML web scraping is skipped, executing only standard Moodle API operations. Note: Zoom LTI discovery (`mod_lti_get_tool_launch_data`) runs via Moodle REST WS and does not require HTML scraping.

### Extension Storage (`@deprecated` Legacy)
* **`ExtensionSettings.scrapingEnabled`** (`boolean`, default: `false`, `@deprecated`):
  * Retained only for backwards compatibility with older saved settings objects; removed from Settings UI (`#scraping-enabled-toggle` removed) and background service worker synchronization always passes `enableScraping: false`.

---

## 7. Zoom Meeting Extraction & Utilities (`@tautracker/moodle-client`)

### Multi-Modal Detection & Scraping
* **`scrapeZoomMeetingsWithToken(token: string, instanceId: number, baseUrl?: string, cmid?: number, jar?: CookieJar | null, modname?: string): Promise<LtiZoomMeeting[]>`**:
  * Multi-layer extraction strategy supporting both Moodle native Zoom activities (`mod_zoom`) and external tools (`mod_lti`):
    1. Fetches `/mod/${modname}/view.php?id=${cmid || instanceId}` using active Moodle session cookies.
    2. Parses server-rendered HTML tables with `extractZoomMeetingsFromHtml` to capture spaced meeting IDs (e.g. `840 9026 3132`), Hebrew topics, and action buttons.
    3. Detects and follows embedded `<iframe id="contentframe" src="...">` to inspect launch endpoints or embedded meeting tables.
    4. Falls back to `mod_lti_get_tool_launch_data` or direct `/mod/lti/launch.php?id=${cmid}&triggerview=0` to extract OAuth LTI form signatures and post to Zoom LTI Rich API (`/api/v1/lti/rich/meeting/upComing` and `/previous`).
* **`extractZoomMeetingsFromHtml(html: string, referenceDate?: Date): LtiZoomMeeting[]`**:
  * Scrapes structured HTML tables (`<tr>...<td>...</td>...</tr>`) containing Zoom meeting rows, extracting spaced meeting IDs, Hebrew/English topics, start times, and direct join buttons.
* **`parseZoomHumanDateTime(rawStr: string, referenceDate?: Date): Date | undefined`**:
  * Parses human-readable relative and recurring datetime strings (`Tomorrow (Recurring) 7:05 AM`, `Today 8:05 AM`, `Thu, Nov 12 (Recurring) 4:00 AM`) into valid UTC JavaScript `Date` instances.
* **`normalizeZoomStartTime(m: Record<string, any>, isUpcoming: boolean, referenceDate?: Date): string | undefined`**:
  * Sanitizes Zoom LTI Pro meeting timestamps. Strips creation timestamps returned by Zoom for "No Fixed Time" recurring rooms (`type === 3`), instant meetings (`type === 1`), PMI rooms (`type === 4`), and past/stale timestamps not aligned to 5-minute `:00` boundaries.
* **`collapseRecurringMeetings(meetings: ZoomMeeting[], referenceDate?: Date): ZoomMeeting[]`**:
  * Collapses recurring weekly sessions of the same room/meetingNumber into a single entry representing the currently active session (`startTime <= now <= startTime + 2h`), the nearest upcoming meeting, or the latest past meeting if none are active/upcoming.
  * Sorts active/upcoming sessions chronologically, then non-timestamped, then past sessions.
* **`getZoomMeetingKey(meeting: ZoomMeetingLike): string`**:
  * Returns the canonical composite key (`<courseName>:<meetingNumber><title>`) used to uniquely identify Zoom meetings across dashboard and popup filters.
* **`isZoomMeetingHidden(meeting: ZoomMeetingLike, hiddenZoomMeetings?: string[] | null, legacyInterestedMeetings?: string[] | null): boolean`**:
  * Evaluates Zoom meeting visibility under a denylist architecture. Default state is **visible** (`false`). Returns `true` only if explicitly present in `hiddenZoomMeetings` (by composite key, raw/clean meeting number, or URL) or prefixed with `hidden_` in legacy `interestedMeetings`.
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
* **`LOGOUT`**: Clears cookies, local storage keys (including `localFs*` metadata and Chromium IndexedDB handles), and sync cache (`clearUserSession()`). Returns `{ success: true }` or `{ success: false, error: string }`.
* **`LOCAL_FS_START_SYNC`**: Enqueues planned/missing Local FS downloads (`forceRescan?: boolean`) and starts background queue execution. Returns `{ success: true, status: LocalFsStatus }`.
* **`LOCAL_FS_PAUSE`**: Aborts active Local FS downloads cleanly after the current file and sets `paused` state. Returns `{ success: true, status: LocalFsStatus }`.
* **`LOCAL_FS_RESUME`**: Clears pause/cooldown markers and resumes queued Local FS downloads. Returns `{ success: true, status: LocalFsStatus }`.
* **`LOCAL_FS_RETRY_FAILED`**: Re-enqueues failed/missing Local FS files via `forceRescan` (`autoResyncMissingFiles` respected). Returns `{ success: true, status: LocalFsStatus }`.
* **`LOCAL_FS_RESET_FOLDER`**: Clears Local FS queue and manifest when switching target folders (without deleting files on disk). Returns `{ success: true }`.
* **`LOCAL_FS_ADOPT_SCANNED`**: Receives `{ files: ScannedLocalFileMetadata[] }` from Firefox's `<input webkitdirectory>` folder scan, adopts matching pre-existing files on disk into `localFsManifest` (`origin: 'scan'`, attaching matching Firefox `downloadId`s when available) and removes them from `localFsQueue`. Returns `{ success: true, adoptedCount: number, totalSynced: number }`.
* **`LOCAL_FS_RECONCILE`**: Triggers background-serialized manifest reconciliation (`reconcileLocalFsManifest()`) inside the service worker's `withStateLock` mutex instead of mutating `localFsManifest` directly from UI tabs. Returns `{ success: true, changed: boolean }`.
* **`FETCH_COURSE_STAFF`**: Accepts `{ courseIds: number[], courseBaseUrls?: Record<number, string>, forceRefresh?: boolean }`. Reuses `cachedCourseStaff` (`browser.storage.local`) / `cachedSyncResult.courseStaff` for courses already fetched unless `forceRefresh: true`, queries `MoodleClient.getCourseStaff(courseId)` (`core_enrol_get_enrolled_users` with `moodlewssettingfilter: 'false'`) with `fetchCourseStaffFromParticipantsPage()` (`/user/index.php`) fallback for missing courses, persists newly discovered staff in `cachedCourseStaff` and `cachedSyncResult.courseStaff`, and returns `{ success: true, byCourseId: Record<number, CourseStaffMember[]> }`.

### MV3 Service Worker Protocol
* **Synchronous Registration**: The listener is registered unconditionally at the top level of `serviceWorker.ts` before alarms or async operations.
* **Synchronous Channel Retention**: The handler invokes `sendResponse(result)` when its asynchronous promise resolves and returns `true` synchronously, preserving the native Chromium message port across cold-boot worker wake-ups.

---

## 9. Panopto Lecture & Recitation Discovery & API Protocol (`packages/moodle-client/src/panoptoScraper.ts`)

When `enablePanopto: true` (`ExtensionSettings.panoptoEnabled`) is enabled, Noodle discovers and fetches course lecture and recitation recordings from TAU's Panopto server (`https://panopto.tau.ac.il`) using the browser's implicit SSO session cookies (`credentials: 'include'`).

### 2-Tier Folder Discovery & Hidden-Tab SSO Pipeline
1. **Hidden-Tab Panopto SSO Auto-Login (`ensurePanoptoAuthViaHiddenTab` in `serviceWorker.ts`)**:
   * Checks for an active `.ASPXAUTH` cookie on `panopto.eu` via `browser.cookies.getAll({ domain: 'panopto.eu' })`.
   * If missing or if `fetchPanoptoFolderSessions` returns 0 recordings due to an expired server session (`forceRefresh = true`), opens a hidden background tab (`active: false`) to `https://tau.cloud.panopto.eu/Panopto/Pages/Auth/Login.aspx`, injects `injectedPanoptoLoginStep` via `scripting.executeScript` to click `#PageContentPlaceholder_loginControl_externalLoginButton`, fills `#Ecom_User_ID`, `#Ecom_User_Pid`, and `#Ecom_Password` on `nidp.tau.ac.il` using stored `MoodleCredentials`, waits for redirect back to `/Panopto/Pages/**` with a valid `.ASPXAUTH` cookie, and closes the hidden tab.
2. **Tier 1 — Manual Override (`coursesPanoptoMap`)**:
   * Users can configure a Panopto Folder URL or Folder UUID per course in the Manage Courses modal or inline in `CourseDetailView` (`settings.coursesPanoptoMap[courseId]`).
   * `extractPanoptoFolderId(input)` extracts the folder UUID directly, or if a `Viewer.aspx?id={deliveryId}` link is provided, resolves its parent folder UUID via `DeliveryInfo.aspx`.
3. **Tier 2 — Moodle Course Modules & Page Auto-Discovery**:
   * Scans `core_course_get_contents` modules (`url`, `lti`, `page`, `label`), `core_block_get_course_blocks`, and section summaries for links matching `panopto.tau.ac.il` or `*.panopto.eu`.
   * Fetches `/course/view.php?id={courseId}` and invokes `extractPanoptoFromCourseHtml(html)` to extract folder UUIDs and delivery IDs from course links.
   * If only a session delivery ID (`Viewer.aspx?id={deliveryId}`) is found on the course page, calls `resolveFolderIdFromDelivery(deliveryId)` (`POST /Panopto/Pages/Viewer/DeliveryInfo.aspx` with `deliveryId` and `responseType=json`) to read `Delivery.SessionGroupPublicID` / `Delivery.FolderId` and fetch the entire course folder.

### Session Fetching, Deduplication & Host-Based Classification
* **`fetchPanoptoFolderSessions(folderId, courseId, courseName, panoptoBaseUrl, jar, depth, classificationOptions)`**:
  * Primary: `POST /Panopto/Services/Data.svc/GetSessions` with `queryParameters` (`folderID`, `sortColumn: 1`, `sortAscending: false`, `maxResults: 250`).
  * Extracts `host` from `SessionRow.Abstract` (`extractPanoptoHostFromAbstract`, e.g. `• Host: Yoav Lahini`) or fallback metadata fields, then runs `classifyRecordingWithSource(title, { host, staffEntries, moodleStaff })`.
  * Fallback: `GET /Panopto/Pages/Sessions/List.aspx?folderID={folderId}` parsed via `parsePanoptoListHtml`.
* **`classifyRecordingWithSource(title, { host, staffEntries, moodleStaff })` & `reclassifyPanoptoRecordings(...)`**:
  * Classification priority: (1) explicit user staff entries (`coursesPanoptoStaff`), (2) Moodle course staff (`Teacher` -> `'Lecture'`, `Teaching Assistant` -> `'Recitation'`), matching Hebrew Moodle names phonetically/via transliteration against English Panopto hosts (`doesHostMatchPersonName`), (3) title keyword regex fallback (`classifyRecordingType`).
* **`filterAndDeduplicateRecordings(recordings, classificationOptions)`**:
  * Filters out invalid/garbage titles (`len < 5` or lacking alphabetical/Hebrew characters) and accidental short clips (`durationSeconds < 60`).
  * Preserves `host`, resolved `type`, and `classificationSource`.
  * Deduplicates recitation series by stripping part suffixes (`חלק 1`, `part 2`, `a-c`), grouping by base recitation title, and keeping all parts from the most recent `publishedDate`.
* **`matchRecordingToSection(recording, courseSectionNames)`**:
  * Associates each recording with a Moodle course section by matching lecture/recitation/week numbers or title keyword overlap, falling back to `'הקלטות פנופטו'`.

* **Progressive Backoff**: Senders (`sendMessageToBackground`) utilize a 4-stage backoff (`200, 500, 1000, 1500 ms`, ~3.2s total) to wait for dormant workers to spin up, returning structured error objects on failure.

---

## 7. Pure-TS PKZIP Specification (`zipBuilder.ts`)

To enable instant bulk downloads of course folders (`mod_folder`) without external binary dependencies or native Node.js libraries, Noodle implements a pure TypeScript PKZIP 2.0 archive generator.

### Key Capabilities
1. **Zero Node Dependencies:** Pure typed byte array (`Uint8Array`, `DataView`) construction running seamlessly in Chrome/Firefox MV3 Service Workers and React Native Hermes.
2. **IEEE 802.3 CRC-32:** Generates a lookup table at initialization and computes 32-bit cyclical redundancy checks for all compressed file streams.
3. **UTF-8 Hebrew File Support:** Emits bit 11 (`0x0800`) in the General Purpose Bit Flag for both Local File Headers and Central Directory Records, ensuring Hebrew filenames render properly in Windows Explorer, macOS Archive Utility, and mobile archive handlers.
4. **Collision Disambiguation:** Tracks file paths within the ZIP and appends sequential indicators (`filename (1).pdf`) for identical filenames within the same directory.
5. **Bounded Concurrent Download:** Downloads folder contents in parallel (max concurrency 4) with `wstoken` authentication and JSON exception detection (`{ exception: ... }`).

---

## 10. Local Filesystem Sync Engine & Provider Contracts

### A. Pure-TS Planner & Diff API (`packages/moodle-client/src/localFsPlanner.ts`)
* **`sanitizePathSegment(segment: string, maxLength?: number): string`**: Strips/replaces invalid OS characters (`< > : " / \ | ? *`, control chars), normalizes whitespace, guards Windows reserved names (`CON`, `PRN`, `AUX`, `NUL`, `COM1..9`, `LPT1..9`), and truncates cleanly while preserving extensions.
* **`sanitizeRelativePath(relPath: string, maxTotalLength?: number): string`**: Sanitizes multi-segment paths against `..` traversal and compacts directory segments to keep mirrored paths within `210` chars.
* **`getCanonicalFileUrlPath(rawUrl: string): string`**: Normalizes file URLs (`origin + pathname`) excluding transient query params (`?token=`, `?forcedownload=1`) for fast local manifest lookups.
* **`buildLocalFsTreePlan(syncResult, options)`**: Builds deterministic course trees across `mod_resource` (`!f.folderId`), `mod_folder` (preserving internal `relativePath`), and optional `mod_assign` attachments & student submissions (`includeAssignments`, `includeSubmissions`), anchoring course folder names and unifying Mode A parent/recitation portals.
* **`planLocalFsDiff(plan, existingManifest, { maxFileSizeMb })`**: Emits `toDownload`, `unchanged`, and `skippedTooLarge` sets by comparing `timeModified`, metadata baseline `size`, and `canonicalUrlPath`.

### B. Browser Strategy Interface (`apps/extension/src/services/fs/FileSystemProvider.ts`)
* **`FileSystemProvider`**: Unified contract (`isReady()`, `selectRootDirectory()`, `fileExists(record)`, `checkFilePresence?(record)` returning `'present' | 'missing' | 'unverifiable'`, `writeFile(record, source)`, `openLocalFile(record)`, optional `adoptExistingFiles(candidates)`, optional `revealInFileManager(record)`).
* **`ChromiumFsaProvider`**: Stores `FileSystemDirectoryHandle` in IndexedDB (`NoodleLocalFsDB` -> `handles` -> `rootDirHandle`), automatically adopts non-empty non-HTML files already present in the picked folder before queueing downloads (`adoptExistingFiles`), streams `ReadableStream` payloads via byte-counting/aborting `TransformStream` into `createWritable()`, maps `NotAllowedError`/`SecurityError` to `LocalFsPermissionError`, and opens local files as inline `blob:` tabs via `browser.tabs.create()`.
* **`FirefoxDownloadsProvider`**: Mirrors files via single-pass `browser.downloads.download({ url, filename: '<rootSubfolder>/<relativePath>', conflictAction: 'overwrite', saveAs: false })` enforcing `maxBytes` (`LocalFsDownloadOversizedError`) and `text/html`/small non-`.json` `application/json`/SAML/`SERVER_UNAUTHORIZED`/`SERVER_FORBIDDEN` interception (`LocalFsDownloadAuthError`), automatically adopts existing completed downloads via `browser.downloads.search({ state: 'complete' })` before queueing (`adoptExistingFiles`), returns `'unverifiable'` from `checkFilePresence()` / `batchCheckFilePresence()` for scanned/`rclone` or purged-history entries lacking a `downloadId`, reconciles stale session IDs cleanly (`reconcileManifestDetailed()` via `LOCAL_FS_RECONCILE`), and opens local downloads via `browser.downloads.open(downloadId)` with zero OPFS duplication. Supports explicit user folder pre-scanning (`adoptScannedDiskFiles` / `LOCAL_FS_ADOPT_SCANNED`) when Firefox history lacks pre-existing files on disk.
* **`browser.storage.local` Machine-Local Keys**: `localFsConfig` (off by default, `autoResyncMissingFiles: false` by default), `localFsManifest` (`moodleFileId -> LocalFsManifestRecord` including `origin?: 'fsa' | 'download' | 'scan'`), `localFsQueue`, and `localFsStatus` (including `plannedTotal` and `pendingCount`) — all excluded from `NOODLE_SYNC_DATA` / `browser.storage.sync`.
