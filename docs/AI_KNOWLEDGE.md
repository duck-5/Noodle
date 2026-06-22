# AI Onboarding & Project Knowledge Base

Welcome, AI Agent! This document compiles the core knowledge, implementation patterns, features, and design constraints of Noodle. Read this document carefully before making changes to the codebase.

---

## 1. Project Map & Core Directory Structure

```
Noodle/
├── apps/
│   ├── mobile/                     # Expo SDK 56 Mobile App (React Native)
│   └── extension/                  # Chrome Extension SPA (Vite + React + TS, Manifest V3)
├── packages/
│   └── moodle-client/              # Shared pure TypeScript API engine
├── legacy/                         # READ-ONLY legacy Python server/client files (source of truth)
│   ├── server/                     # Old FastAPI routes & logic
│   └── clients/                    # Old Moodle, Google, and Playwright scrapers
└── docs/                           # Documentation folder (where you are now)
```

---

## 2. Porting Logic Cheat Sheet

When implementing features in TypeScript, refer to the corresponding legacy Python code in the `legacy/` directory. The legacy logic is correct and tested; translate it faithfully.

### File Mapping Table

| Legacy File | Legacy Function / Class | Destination in Monorepo | Implementation Guidelines |
| :--- | :--- | :--- | :--- |
| `legacy/clients/moodle_client.py` | `get_enrolled_courses()` | `packages/moodle-client/moodleApi.ts` | Retrieve course array and return parsed semester/year meta. |
| `legacy/clients/moodle_client.py` | `get_pending_assignments()` | `packages/moodle-client/syncEngine.ts` | Retrieve assignments + merge submission statuses. |
| `legacy/clients/moodle_client.py` | `get_assignment_grades()` | `packages/moodle-client/moodleApi.ts` | Fetch grades per active course. |
| `legacy/clients/moodle_client.py` | `get_course_contents()` | `packages/moodle-client/moodleApi.ts` | Retrieve sections list for file/zoom parsing. |
| `legacy/clients/moodle_client.py` | `parse_course_metadata()` | `packages/moodle-client/courseParser.ts` | Parse TAU shortname string via regex patterns. |
| `legacy/clients/google_client.py` | `sync_task()` | `packages/moodle-client/googleTasksSync.ts` | Google Tasks REST client logic. |
| `legacy/server/services/sync_service.py`| `run_sync_task()` | `packages/moodle-client/syncEngine.ts` | Orchestrates the sync sequence. |

---

## 3. Critical Implementation Rules

### A. Environment Constraints
*   **The Shared API Client MUST remain pure TypeScript:** Do not use Node-specific packages (`axios`, `node-fetch`, `crypto`, `fs`). Use the global `fetch()` API for all network requests. This ensures compatibility with the mobile browser runtime (Hermes) and the Chrome extension background worker.

### B. Moodle API Error Handling
*   **HTTP 200 Exceptions:** Moodle's REST API frequently returns an HTTP Status code `200 OK` even when the request fails. When an error occurs, the response body contains a JSON object with `exception` and `message` properties.
    *   *Rule:* The `moodleApi` methods must check for the presence of these fields and throw a typed `MoodleApiError`.
*   **Token Invalidation:** If a user resets their password, Moodle invalidates all tokens. Detect `{"errorcode": "invalidtoken"}` and immediately prompt the user to re-authenticate.

### C. True Deadline Computation Formula
*   Port the deadline logic from `legacy/clients/moodle_client.py` exactly:
    $$\text{True Deadline} = \max(\text{duedate}, \text{cutoffdate}, \text{extensionduedate})$$
    *   *Rule:* These values are represented as epoch timestamps in seconds.
    *   *Rule:* A value of `0` indicates the field is not set. **Never** include `0` in the maximum evaluation. If all values are `0`, the assignment has no deadline.
*   **Status Classification:**
    *   `Submitted`: If the submission status equals `submitted`.
    *   `Not submitted`: If status is not submitted and the True Deadline is in the past.
    *   `Assigned`: If status is not submitted and the True Deadline is in the future.

### D. Authenticated File Downloads
*   Moodle files fetched from `/pluginfile.php/` require authentication.
    *   *Rule:* Use the helper `buildAuthenticatedFileUrl(rawUrl, token)` to append `?token={wstoken}` to the file URL before launching the browser tab or file download task.

### E. Google Tasks Matching Logic
*   Google Tasks does not have custom metadata storage.
    *   *Rule:* Insert a structured metadata string into the task's `notes` (description) field:
        ```
        Noodle:assignId:{moodle_assign_id}
        ```
    *   *Rule:* During sync, scan existing tasks' descriptions using this prefix to find matches. Do not match tasks by title, as the user might rename them.
    *   *Rule:* If a task is marked `completed` in Google Tasks by the user, **do not** change it back to `needsAction` even if Moodle reports it is not submitted. Respect user overrides.

### F. Cookie-less Token Interception
*   **No Cookies Permission:** Do not use `chrome.cookies` or request the `"cookies"` permission in the extension manifest.
*   **Redirect Interception:** The background service worker must use `chrome.webRequest.onBeforeRedirect` to capture the final `moodlemobile://token=...` redirect URL generated during the SSO flow, programmatically extracting the Web Service token (`wstoken`).
*   **Implicit Session Sharing:** Rely on the browser's implicit cookie management by using `credentials: 'include'` for all fetch requests within the extension scope to carry over the Moodle and Zoom LTI session credentials automatically.

### G. SAML SSO Login Parsing
*   **Form Extraction:** During programmatic login, the initial redirect to `nidp.tau.ac.il` returns an auto-submitting HTML form containing parameters like `SAMLRequest` and `RelayState`.
*   **SAML Context Propagation:** The login flow must extract **all** hidden `<input>` tag name-value pairs from this form and post them back to the form's action URL as form-urlencoded body data. Simply sending an empty POST to the action URL fails to associate the SAML request context, causing subsequent login credentials to succeed at the identity provider but fail to generate a valid `SAMLResponse` for Moodle.

### H. Session Purging & Invalidation on Disconnect
*   **Local Storage Purge:** When a user logs out or disconnects their account, all personal cached data (moodle data, assignments, grades, courses, OAuth/Moodle tokens) must be completely wiped from the local client databases (`chrome.storage.local` or mobile SQLite/SecureStore). Only general app configurations (e.g., dark mode preferences) should be kept.
*   **Server-Side Invalidation:** A local storage wipe is insufficient. The app must perform server-side session invalidation by invoking Moodle and SSO logout endpoints (`https://moodle.tau.ac.il/login/logout.php` and `https://nidp.tau.ac.il/nidp/app/logout`) with `credentials: 'include'` to tear down active server sessions. This prevents account crossover (where a subsequent user gets automatically logged in to the previous user's SSO session).

---

## 4. Current Roadmap & Outstanding Milestones

When creating new features, keep the following roadmap milestones in mind:

### Milestone 1: Onboarding & Empty States
*   ** Walkthrough:** Add a step-by-step guidance panel for first-time users.
*   **Empty Dashboard UX:** Render welcoming empty states when a user has no active courses or upcoming tasks.

### Milestone 2: Error Feedback & Tooltips
*   **Token Error Banner:** Display descriptive banners when Moodle token authentication fails.
*   **Inline Editing:** Allow users to double-click and rename course titles directly on the dashboard.
*   **Tooltips:** Add helper tooltips explaining academic terminology.

### Milestone 3: Task Management & Calendar
*   **Marked as Done:** Local checkbox toggles to hide pending assignments.
*   **Submitted Priority:** Ensure Moodle's `Submitted` status overrides any manual "Done" toggles.
*   **Personal Notes:** Let users attach text notes directly to assignment cards.

### Milestone 4: Dashboard Widgets & Search
*   **Widget Reordering:** Persist grid widget ordering to local databases (SQLite/chrome.storage).
*   **Course Colors:** Color picker to assign colors to courses, synced across platforms.
*   **GPA Progress Bar:** Render course average gauges and term-based GPA progress trackers.
*   **Global Search:** Implement client-side fuzzy searching supporting both Hebrew and English strings.

---

## 5. Deferrals & Retired Concepts

*   **Panopto Scraping:** Headless Playwright scraping is deferred in the client-side model (cannot run on iOS/Android or extension worker without DOM access). Do not attempt to implement Playwright automation.
*   **Central JWT & Server DB:** Completely retired. All authentication is client-to-Moodle; all databases are client-local.
