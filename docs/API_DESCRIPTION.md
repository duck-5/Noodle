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
    *   **Zoom Meetings:** Identify modules where `modname === 'lti'` and the name contains Zoom (or `modname === 'url'` with a `zoom.us` target link).

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

### Data Synchronization Mapping
*   **Task Title:** Constructed as `[Course Code] Assignment Title` (e.g. `[03681118] Assignment 1`).
*   **Task Due Date:** Set to the Moodle assignment's True Deadline in ISO 8601 format (date-only: `YYYY-MM-DD`).
*   **Stable Identifier (Metadata):** Google Tasks has no custom field metadata. Noodle injects a deterministic string into the `notes` (description) field of the task:
    ```
    Noodle:assignId:{moodle_assign_id}
    ```
    This allow the sync engine to identify existing tasks without relying on unstable title matching.
*   **Status Mapping:**
    *   If Moodle assignment status is `Submitted` $\rightarrow$ set Google Task status to `completed`.
    *   If Moodle assignment status is not submitted $\rightarrow$ leave status as `needsAction`.
    *   If a Google Task has been marked `completed` by the user manually, it is **never** overwritten back to `needsAction` by the sync engine (preserves user intent).

---

## 3. Client Platform APIs

### Chrome Extension APIs (Manifest V3)
*   `chrome.cookies`: Scans for the HTTP-Only `MoodleSession` cookie on `moodle.tau.ac.il` to automate token retrieval.
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
