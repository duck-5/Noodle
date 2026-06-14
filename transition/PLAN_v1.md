# TauTracker — Transition Plan v1
## From: Centralized Server → To: Mobile App + Browser Extension (Client-Side Architecture)

> **Prepared after a full audit of the existing codebase.**
> Reference files are documented in [`transition/data/`](./data/).
> The original system architecture lives in [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).
> The original v0 plan is in [`transition/PLAN_v0.md`](./PLAN_v0.md).

---

## 0. Background & Motivation

### What exists today (v2.0.0)

The current TauTracker system is a **Python FastAPI server** with a centralized CSV database. It serves a web frontend from the same process. Key traits:

- All Moodle API calls are made **server-side** (every user's token is decrypted on the server and used to fetch data on their behalf).
- All user credentials (Moodle `wstoken`, SSO username/password/student-ID) are stored **server-side**, encrypted with a Fernet key derived from `SERVER_SECRET`.
- A Playwright-based headless browser runs on the server to scrape Panopto lecture recordings.
- Background sync jobs run in FastAPI `BackgroundTasks` threads, triggered manually by the user via the web UI.
- There is a native Android app skeleton (`android-app/`) that was started but **is not connected** to any backend yet.

### Why we are transitioning

1. **IP Blocking Risk:** A single server sending thousands of Moodle API requests per day (one per user per sync) will have its IP flagged and blocked by Moodle's infrastructure.
2. **Privacy Liability:** Storing 1000+ users' Moodle tokens and SSO passwords on a central server creates a severe security liability under Israeli privacy law (Hok HaHagana Al Nitunim Isiyim) and potentially GDPR.
3. **Operational Cost:** Maintaining a server, database, encryption key rotation, etc., adds complexity that is disproportionate for a student-run tool.

### The new architecture (in one sentence)

> Every user's device (phone or browser) is its own authenticated Moodle API client — no intermediary server, no shared IP, no centralized credential storage.

---

## I. New Architecture Overview

```
┌──────────────────────────┐     ┌──────────────────────────┐
│   Mobile App (React Native / Expo)  │     │  Browser Extension (MV3 + React)  │
│  - Token: expo-secure-store         │     │  - Token: chrome.storage.local     │
│  - Prefs: AsyncStorage / SQLite     │     │  - Prefs: chrome.storage.sync      │
│  - BG Sync: expo-background-fetch   │     │  - BG Sync: chrome.alarms API      │
│  - Notifs: expo-notifications       │     │  - Notifs: chrome.notifications    │
└───────────────┬──────────┘     └──────────────┬───────────┘
                │                               │
                │  Direct HTTPS (no proxy)       │  Direct HTTPS (host_permissions)
                ▼                               ▼
    ┌──────────────────────────────────────────────────┐
    │            moodle.tau.ac.il  (Moodle WS API)     │
    │  /webservice/rest/server.php                      │
    │  /login/token.php                                │
    │  /webservice/upload.php                          │
    └──────────────────────────────────────────────────┘
                │
                │  (optional, future)
                ▼
    ┌──────────────────────────────┐
    │  Google APIs (OAuth 2.0)     │
    │  - Google Tasks REST API     │
    │  - Google Calendar API       │
    └──────────────────────────────┘
```

### Code organization (Monorepo)

```
TauTracker/                         ← Existing root (git repo)
├── apps/
│   ├── mobile/                     ← React Native + Expo app  [NEW]
│   └── extension/                  ← Browser Extension (MV3)  [NEW]
├── packages/
│   └── moodle-client/              ← Shared TypeScript API client  [NEW]
├── legacy/                         ← Archived Python server code  [RENAMED from existing]
│   ├── server/                     ← (moved here from root/server/)
│   ├── clients/                    ← (moved here from root/clients/)
│   ├── docs/                       ← (moved here from root/docs/)
│   └── main.py, config.py, etc.    ← old daemon scripts
├── transition/
│   ├── PLAN_v0.md
│   ├── PLAN_v1.md                  ← this file
│   └── data/                       ← reference copies of key old files
├── package.json                    ← monorepo workspace root
├── pnpm-workspace.yaml
└── turbo.json
```

> **Important:** The old Python server code must NOT be deleted. It should be moved to a `legacy/` directory at the repo root. This code is the source of truth for the business logic (Moodle API call patterns, data parsing, sync logic) and must be referenced when re-implementing in TypeScript.

---

## II. Phase 0: Repository Restructuring

This is the first concrete step. Do this before writing a single line of new code.

### Step 0.1 — Create the `legacy/` archive

Move all existing server-side Python code into a `legacy/` directory. Nothing should be deleted.

```
# Directories to MOVE (not copy) to legacy/:
server/         → legacy/server/
clients/        → legacy/clients/
docs/           → legacy/docs/
db/             → legacy/db/
tests/          → legacy/tests/
android-app/    → legacy/android-app/   (the unfinished Kotlin skeleton)

# Root files to MOVE to legacy/:
main.py
config.py
configure_courses.py
startup.py
run_m3.py
clear_tasks.py
requirements.txt
Dockerfile
docker-compose.yml
run.sh
.env
.env.example
```

Keep at root level: `.git`, `.github`, `.gitignore`, `README.md`, `transition/`, and the new monorepo files.

**Update `.gitignore`** to reflect the new structure (node_modules, dist folders, Expo `.expo`, extension dist, etc.).

### Step 0.2 — Initialize the monorepo

```
pnpm init
```

Create `pnpm-workspace.yaml`:
```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

Create `turbo.json` with basic pipeline definitions for `build`, `dev`, `lint`, `type-check`.

### Step 0.3 — Create placeholder directories

```
apps/mobile/          (empty, Expo will be initialized here)
apps/extension/       (empty, Vite + CRXJS will be initialized here)
packages/moodle-client/  (shared TS library)
```

---

## III. Phase 1: Shared `packages/moodle-client` Library

This is the heart of the new system. It is a **pure TypeScript package** with zero runtime dependencies on any framework (no React, no Expo). It must run in:

- A React Native environment (iOS/Android native runtime).
- A Chrome Extension Service Worker (browser-based JS engine).

### What it contains

All the business logic that currently lives in `legacy/clients/moodle_client.py` and `legacy/server/services/sync_service.py`, rewritten in TypeScript.

### 1.1 — Data Types (`types.ts`)

Define strict TypeScript interfaces for every data entity the system handles:

```typescript
interface MoodleCourse {
  id: number;         // Moodle's internal integer ID
  courseId: string;   // Extracted from shortname (e.g. "0368111801")
  shortname: string;
  fullname: string;
  semester: 'SemesterA' | 'SemesterB' | 'Yearly' | 'Other';
  year: string;
}

interface Assignment {
  id: number;               // Moodle assign ID
  cmid: number;             // Course-module ID (used in deep links and grade lookups)
  courseId: number;         // Moodle course internal ID
  courseName: string;
  name: string;
  status: 'Assigned' | 'Submitted' | 'Not submitted';
  deadline: string | null;  // ISO 8601 string or null
  opened: string | null;
  link: string;             // https://moodle.tau.ac.il/mod/assign/view.php?id={cmid}
  grade: number | null;
  gradeMax: number | null;
}

interface CourseFile {
  fileName: string;
  fileUrl: string;       // raw URL — token must be appended for download
  fileSize: number;
  mimeType: string;
  sectionName: string;
  timeModified: number;
  courseId: number;
  courseName: string;
}

interface ZoomMeeting {
  title: string;
  meetingUrl: string;
  sectionName: string;
  courseId: number;
  courseName: string;
}

interface SyncResult {
  assignments: Assignment[];
  files: CourseFile[];
  meetings: ZoomMeeting[];
  errors: SyncError[];
  syncedAt: string; // ISO 8601
}

interface SyncError {
  context: string;  // e.g. "assignment grade fetch for course 12345"
  message: string;
}
```

### 1.2 — API Client (`moodleApi.ts`)

A class (or collection of functions) that wraps `fetch()` calls to Moodle's Web Services REST API. All calls go to:
```
https://moodle.tau.ac.il/webservice/rest/server.php
```

**Critical design constraint:** The `fetch` call must work in both React Native (where it is a native HTTP call with no CORS) and in the Chrome Extension Service Worker (where host_permissions grants it access). Do NOT use any Node.js-specific APIs (`axios`, `requests`, `node-fetch`). Use the global `fetch` API only.

**Functions to implement** (porting from `legacy/clients/moodle_client.py`):

```typescript
// Validate a token and get the logged-in user's ID and info
getSiteInfo(token: string): Promise<{ userId: number; username: string; siteName: string }>

// Get all courses the user is enrolled in
getEnrolledCourses(token: string, userId: number): Promise<MoodleCourse[]>

// Get all assignments across all courses (returns course + assignment data together)
getAssignments(token: string): Promise<RawMoodleAssignment[]>

// Get submission status for a specific assignment
getSubmissionStatus(token: string, assignId: number): Promise<{ status: string; extensionDueDate: number }>

// Get grade items for a specific course
getGradeItems(token: string, courseId: number, userId: number): Promise<RawGradeItem[]>

// Get course contents (sections + modules + files)
getCourseContents(token: string, courseId: number): Promise<RawCourseSection[]>

// Upload a file to Moodle draft area (returns itemId)
uploadFile(token: string, filename: string, fileContentBase64: string): Promise<number>

// Link uploaded file to an assignment and submit for grading
saveAndSubmitAssignment(token: string, assignId: number, itemId: number): Promise<void>
```

**Error handling:** Every function must distinguish between:
1. Network errors (no internet, DNS failure).
2. HTTP errors (4xx, 5xx from Moodle).
3. Moodle API errors — Moodle returns HTTP 200 but includes `{"exception": "...", "message": "..."}` in the JSON body. This must be detected and thrown as a typed `MoodleApiError`.

**Token appending for file downloads:** Moodle's `pluginfile.php` URLs require the `wstoken` as a query parameter. The library must expose a `buildAuthenticatedFileUrl(rawUrl: string, token: string): string` utility function that other parts of the app use before opening or downloading a file.

### 1.3 — Sync Engine (`syncEngine.ts`)

A pure function (no side effects beyond what's passed in) that orchestrates the full data fetch for a user.

```typescript
async function runSync(
  token: string,
  trackedCourseIds: number[],
  onProgress: (message: string) => void
): Promise<SyncResult>
```

**Logic flow** (ported from `legacy/server/services/sync_service.py`):

1. `getSiteInfo(token)` → get `userId`.
2. `getEnrolledCourses(token, userId)` → filter to `trackedCourseIds`.
3. `getAssignments(token)` → filter to tracked courses.
4. For each assignment: `getSubmissionStatus(token, assignId)` → determine final status and deadline.
5. For each tracked course: `getGradeItems(token, courseId, userId)` → build a `cmid → grade` map.
6. Merge grades into assignments.
7. For each tracked course: `getCourseContents(token, courseId)` → extract files and Zoom meetings.
8. Return `SyncResult`.

**Key porting note from Python:** The Python code calls `mod_assign_get_submission_status` for EVERY assignment in a separate HTTP request (see `moodle_client.py` lines 194–212). This is O(n) in the number of assignments and will be slow on mobile. Consider batching or caching — but do not skip it, as it is the only reliable way to get individual submission status and personal extension dates.

### 1.4 — Parsing Utilities (`courseParser.ts`)

Port the TAU-specific course metadata parsing logic from `legacy/clients/moodle_client.py::parse_course_metadata()`:

```typescript
// TAU idnumber format: "03211100-01-2025-1"
// → { courseCode: "03211100", groupId: "01", year: "2025", semester: "SemesterA" }
function parseTauCourseMetadata(idnumber: string): TauCourseMetadata | null
```

This logic extracts the academic year and semester from Moodle's `idnumber` field, which follows a TAU-specific format. The regex and semester mapping must be ported exactly.

---

## IV. Phase 2: Browser Extension (`apps/extension/`)

### 2.1 — Tooling

- **Bundler:** Vite + CRXJS plugin (handles Manifest V3 service worker bundling automatically).
- **UI Framework:** React + TypeScript.
- **Manifest Version:** 3 (required for Chrome Web Store).

### 2.2 — Manifest Configuration (`manifest.json`)

```json
{
  "manifest_version": 3,
  "name": "TauTracker",
  "version": "3.0.0",
  "permissions": [
    "storage",
    "alarms",
    "notifications",
    "cookies",
    "identity"
  ],
  "host_permissions": [
    "*://moodle.tau.ac.il/*",
    "https://accounts.google.com/*",
    "https://tasks.googleapis.com/*",
    "https://www.googleapis.com/*"
  ],
  "background": {
    "service_worker": "src/background/serviceWorker.ts",
    "type": "module"
  },
  "action": {
    "default_popup": "src/popup/index.html",
    "default_icon": { "48": "icons/icon48.png" }
  },
  "options_page": "src/options/index.html"
}
```

> **Why `host_permissions` for moodle.tau.ac.il?** The extension Service Worker runs with elevated network privileges. Unlike a webpage, it is not subject to Same-Origin Policy or CORS. Declaring `host_permissions` grants the background script the ability to `fetch()` from Moodle directly, just as if the browser itself were making the request.

### 2.3 — Token Acquisition (Frictionless Authentication)

**Challenge:** Users should not have to manually find their Moodle `wstoken`. Token generation requires a POST to `/login/token.php` with credentials, but we don't want users to enter their password into the extension.

**Solution 1 (Preferred) — Cookie-based token capture:**

The extension's Service Worker listens for changes to Moodle cookies using `chrome.cookies.onChanged`. When the user logs in to Moodle normally in their browser, Moodle sets a `MoodleSession` cookie. When this cookie appears, the background script:

1. Makes a `fetch()` to `https://moodle.tau.ac.il/login/token.php` with the `wsfunction=moodle_mobile_app` parameter.
2. Because the browser automatically sends the `MoodleSession` cookie with this request (same domain), Moodle returns the `wstoken` in the JSON response.
3. The token is saved to `chrome.storage.local`.

> **Important caveat:** The `MoodleSession` cookie is `HttpOnly`, which means JavaScript cannot read it directly. However, when the extension's background script makes a `fetch()` to `moodle.tau.ac.il`, the browser **will automatically include** that cookie in the request. The extension does not need to read the cookie value — it just needs to know the session exists.

**Solution 2 (Fallback) — Manual token entry:**

If cookie-based capture fails (e.g., Moodle changes its session mechanics), provide a settings page where the user can paste their `wstoken` manually. Guide them via a help section explaining where to find it in Moodle's profile settings.

**Solution 3 (Future) — OAuth / SSO flow:**

Not practical for TAU's current Moodle setup, but document as a future path.

### 2.4 — Storage Architecture

All data in the extension is stored using `chrome.storage`:

| Data | Location | Notes |
|------|----------|-------|
| `wstoken` | `chrome.storage.local` | Never synced to Google account |
| Tracked course IDs | `chrome.storage.sync` | Synced across user's Chrome browsers |
| User preferences (language, notification settings) | `chrome.storage.sync` | Synced |
| Cached assignments/files (last sync result) | `chrome.storage.local` | Large, not synced |
| Last sync timestamp | `chrome.storage.local` | |

**Size limits:** `chrome.storage.local` supports up to 10MB (with `unlimitedStorage` permission) and `chrome.storage.sync` is limited to 100KB total. Store only IDs and preferences in `sync`. Store full assignment/file data in `local`.

### 2.5 — Background Sync (`serviceWorker.ts`)

The Service Worker manages background alarms and sync.

```typescript
// On install / startup: register recurring alarm
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('periodicSync', { periodInMinutes: 60 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'periodicSync') {
    await performBackgroundSync();
  }
});

async function performBackgroundSync() {
  const token = await getStoredToken(); // from chrome.storage.local
  if (!token) return;
  
  const trackedCourseIds = await getTrackedCourseIds(); // from chrome.storage.sync
  const result = await runSync(token, trackedCourseIds, () => {});
  
  await chrome.storage.local.set({ cachedSyncResult: result });
  
  // Trigger notifications for upcoming deadlines
  await checkAndNotifyDeadlines(result.assignments);
}
```

**MV3 Service Worker Lifecycle:** Service Workers in MV3 are ephemeral — they are terminated when idle. This means:
- Do NOT rely on in-memory state between alarm fires.
- Always load state from `chrome.storage` at the start of each alarm handler.
- Long-running operations (like the full sync) may get cut off if the browser decides to terminate the SW. Design for partial failures with checkpointing if needed.

### 2.6 — UI Structure

The extension UI is served from the popup (`action.default_popup`) and a full options page.

**Popup** (`src/popup/`): A compact React app (~400×600px) showing:
- Upcoming assignments in the next 7 days (from cached data).
- A "Sync Now" button.
- Quick links to Moodle pages.

**Options Page** (`src/options/`): A full-page React app with tabs:
- **Dashboard:** All tracked courses, assignments, deadlines.
- **Courses:** Toggle which courses are tracked.
- **Files:** Browse and download course files (authenticated file URLs).
- **Grades:** View current grades.
- **Settings:** Token configuration, notification preferences, Google Tasks settings.

**Design note:** Do NOT inject content scripts into Moodle pages. The extension does not modify the Moodle DOM. It is a separate, clean dashboard.

### 2.7 — Google Tasks Integration (Extension)

In the extension, Google Tasks integration uses the Chrome `identity` API for OAuth 2.0:

```typescript
// In manifest.json, add to oauth2 section:
"oauth2": {
  "client_id": "YOUR_CHROME_EXTENSION_CLIENT_ID",
  "scopes": ["https://www.googleapis.com/auth/tasks"]
}

// In code:
chrome.identity.getAuthToken({ interactive: true }, (token) => {
  // Use token to call Google Tasks REST API directly
});
```

The sync engine (from `packages/moodle-client`) produces a `SyncResult`. After syncing Moodle data, the extension makes direct HTTP calls to `https://tasks.googleapis.com/tasks/v1/lists/{listId}/tasks` to create/update Google Tasks for each pending assignment.

**Matching algorithm:** Each Google Task created by TauTracker should have a deterministic, stable identifier derived from the Moodle assignment ID. Store this as the task `notes` field in a structured format: `tautracker:assignId:{moodle_assign_id}`. When re-syncing, search for tasks with this note prefix to find existing tasks instead of matching by title (which is fragile).

---

## V. Phase 3: Mobile App (`apps/mobile/`)

### 3.1 — Tooling

- **Framework:** React Native + Expo (managed workflow).
- **Target:** iOS and Android.
- **Key packages:**
  - `expo-secure-store` — for the Moodle token.
  - `expo-sqlite` — for local course/assignment/file caching.
  - `expo-background-fetch` + `expo-task-manager` — for background sync.
  - `expo-notifications` — for local push notifications.
  - `expo-file-system` — for authenticated file downloads.
  - `expo-sharing` — for sharing downloaded files.
  - `react-native-webview` — potentially for rendering Moodle pages.
  - `@react-native-google-signin/google-signin` — for Google OAuth on mobile.

### 3.2 — Token Storage & Authentication

**Moodle token:**
```typescript
import * as SecureStore from 'expo-secure-store';

async function saveToken(token: string): Promise<void> {
  await SecureStore.setItemAsync('moodle_wstoken', token);
}

async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync('moodle_wstoken');
}
```

`expo-secure-store` uses:
- **iOS:** Keychain / Secure Enclave (hardware-backed).
- **Android:** Keystore system / TEE (hardware-backed on modern devices, software on older ones).

The token is **never stored in plaintext**, never in `AsyncStorage`, and **never transmitted to any TauTracker-controlled server**.

**Token acquisition on mobile:**

Unlike the browser extension, there is no cookie session to tap into. The mobile app must ask the user for their Moodle token explicitly. Two paths:

1. **Manual entry:** User goes to their Moodle profile → Preferences → Security keys → Web service token, copies it, and pastes it into the app. This is the current mechanism used by the existing Python daemon.

2. **In-app login (preferred):** Present a `WebView` pointing to `https://moodle.tau.ac.il/login/index.php`. Intercept the navigation to detect successful login (redirect to Moodle home). Then make a JS-injected or native `fetch()` call to `/login/token.php?service=moodle_mobile_app` from the WebView context. Extract the `wstoken` from the JSON response and save it to SecureStore.

   **Important:** The `fetch()` call to `/login/token.php` should be made with the session cookie that the WebView obtained during login. This is doable in React Native WebView because it shares the app's cookie storage.

3. **Deep link token handoff:** Generate a one-time link in the Moodle web interface that opens the app and passes the token via URL scheme. This requires a custom app URL scheme (`tautracker://auth?token=XXX`) and a corresponding Moodle plugin or user script — complex but the smoothest UX long-term.

### 3.3 — Local Data Storage (SQLite)

The mobile app uses `expo-sqlite` as its local database. This replaces the server-side CSV store.

**Schema:**

```sql
CREATE TABLE tracked_courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  moodle_id INTEGER UNIQUE NOT NULL,
  course_id TEXT,           -- TAU course code (e.g. "0368111801")
  name TEXT NOT NULL,
  semester TEXT,
  year TEXT,
  color TEXT,               -- user-assigned hex color
  is_active INTEGER DEFAULT 1
);

CREATE TABLE assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  moodle_assign_id INTEGER UNIQUE NOT NULL,
  cmid INTEGER,
  course_moodle_id INTEGER NOT NULL,
  course_name TEXT,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'Assigned',
  deadline TEXT,            -- ISO 8601 or NULL
  opened TEXT,
  link TEXT,
  grade REAL,
  grade_max REAL,
  last_synced TEXT          -- ISO 8601
);

CREATE TABLE files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_moodle_id INTEGER NOT NULL,
  course_name TEXT,
  section_name TEXT,
  file_name TEXT NOT NULL,
  file_url TEXT UNIQUE NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  last_synced TEXT
);

CREATE TABLE meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_moodle_id INTEGER NOT NULL,
  course_name TEXT,
  title TEXT,
  meeting_url TEXT UNIQUE NOT NULL,
  section_name TEXT,
  last_synced TEXT
);

CREATE TABLE preferences (
  key TEXT PRIMARY KEY,
  value TEXT
);
```

### 3.4 — Background Sync

Background sync on mobile uses `expo-background-fetch`:

```typescript
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';

const BACKGROUND_SYNC_TASK = 'TAUTRACKER_BACKGROUND_SYNC';

TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
  const token = await getToken();
  if (!token) return BackgroundFetch.BackgroundFetchResult.NoData;
  
  const trackedCourseIds = await getTrackedCourseIds(); // from SQLite
  const result = await runSync(token, trackedCourseIds, () => {});
  
  await saveToDatabase(result); // write to SQLite
  await scheduleDeadlineNotifications(result.assignments);
  
  return BackgroundFetch.BackgroundFetchResult.NewData;
});
```

**Platform limitations:**
- **iOS:** Background fetch is heavily restricted. iOS may run the task as infrequently as every 30 minutes or less. The app cannot guarantee hourly syncs. Notify users of this limitation clearly in the onboarding UI.
- **Android:** Background fetch is more reliable. Expo uses `WorkManager` under the hood, which generally runs on time.

### 3.5 — File Downloads

Authenticated file downloading using `expo-file-system`:

```typescript
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

async function downloadAndOpenFile(file: CourseFile, token: string): Promise<void> {
  const authenticatedUrl = buildAuthenticatedFileUrl(file.fileUrl, token);
  const localUri = FileSystem.documentDirectory + file.fileName;
  
  const downloadResult = await FileSystem.downloadAsync(authenticatedUrl, localUri);
  
  if (downloadResult.status === 200) {
    await Sharing.shareAsync(downloadResult.uri, {
      mimeType: file.mimeType,
      dialogTitle: `Open ${file.fileName}`
    });
  }
}
```

**Important:** The `token` is appended to the file URL as `?token={wstoken}`. This is how Moodle authenticates file downloads from the Web Services API. This is the same mechanism implemented in `legacy/clients/moodle_client.py::download_file()`.

### 3.6 — Notifications

```typescript
import * as Notifications from 'expo-notifications';

async function scheduleDeadlineNotifications(assignments: Assignment[]): Promise<void> {
  // Cancel all existing TauTracker notifications first
  await Notifications.cancelAllScheduledNotificationsAsync();
  
  const now = new Date();
  
  for (const assignment of assignments) {
    if (!assignment.deadline || assignment.status === 'Submitted') continue;
    
    const deadline = new Date(assignment.deadline);
    const hoursUntilDeadline = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60);
    
    if (hoursUntilDeadline <= 0) continue;
    
    // Notify 24 hours before
    if (hoursUntilDeadline <= 24) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `⚠️ Due in ${Math.round(hoursUntilDeadline)}h`,
          body: `${assignment.name} — ${assignment.courseName}`,
          data: { assignmentId: assignment.id, link: assignment.link }
        },
        trigger: null // fire immediately if deadline is very soon
      });
    } else {
      // Schedule for 24 hours before deadline
      const triggerDate = new Date(deadline.getTime() - 24 * 60 * 60 * 1000);
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `📅 Due tomorrow`,
          body: `${assignment.name} — ${assignment.courseName}`,
        },
        trigger: { date: triggerDate }
      });
    }
  }
}
```

### 3.7 — Google Tasks Integration (Mobile)

Use `@react-native-google-signin/google-signin` for OAuth 2.0 on mobile:

```typescript
import { GoogleSignin } from '@react-native-google-signin/google-signin';

GoogleSignin.configure({
  scopes: ['https://www.googleapis.com/auth/tasks'],
  webClientId: 'YOUR_WEB_CLIENT_ID',
});

async function syncToGoogleTasks(assignments: Assignment[]): Promise<void> {
  const { accessToken } = await GoogleSignin.getTokens();
  
  for (const assignment of assignments) {
    if (assignment.status === 'Submitted') continue;
    
    // Call Google Tasks REST API directly
    await fetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: `[${assignment.courseName}] ${assignment.name}`,
        due: assignment.deadline ? new Date(assignment.deadline).toISOString() : undefined,
        notes: `tautracker:assignId:${assignment.id}`
      })
    });
  }
}
```

---

## VI. Features & Requirements Specification

This is an exhaustive list of features both platforms must implement. Each feature is labeled with its complexity and the primary challenge.

### Feature 1: Authentication & Token Management

| | Mobile | Extension |
|--|--------|-----------|
| **Token storage** | `expo-secure-store` (hardware-backed) | `chrome.storage.local` (encrypted by Chrome on disk) |
| **Token acquisition** | In-app Moodle WebView login or manual paste | Cookie-based silent capture or manual paste |
| **Token validation** | On save: call `getSiteInfo()`, check for non-error response | On save: call `getSiteInfo()`, check for non-error response |
| **Token revocation UI** | "Disconnect Moodle" button in settings | "Disconnect Moodle" button in options page |
| **Token expiry** | Moodle tokens currently don't expire — but handle `invalidtoken` errors gracefully by prompting re-auth | Same |

**Developer challenge:** Moodle `wstoken` values for the `moodle_mobile_app` service do not expire by default. However, if a user changes their Moodle password, all tokens are invalidated. The app must detect `{"errorcode": "invalidtoken"}` responses and immediately prompt the user to re-authenticate.

### Feature 2: Course Tracking Configuration

| Requirement | Detail |
|-------------|--------|
| Display all enrolled courses | Grouped by semester/year using TAU's `idnumber` parsing |
| Toggle tracking per-course | Local boolean persisted in SQLite (mobile) or `chrome.storage` (extension) |
| Custom course display name | User can rename a course locally (no change to Moodle) |
| Custom course color | Color picker for each course, used in dashboard UI |

**Developer note:** The course list fetched from Moodle (via `core_enrol_get_users_courses`) includes ALL courses the user was ever enrolled in, including past years. The app must use the TAU `idnumber` parsing logic to group them by year/semester and allow the user to select only the current semester's courses by default.

### Feature 3: Assignment Dashboard

| Requirement | Detail |
|-------------|--------|
| Show pending assignments | Status: `Assigned` or `Not submitted`, filtered to tracked courses |
| Sort by deadline | Chronological, earliest first |
| Show submission status | Live from Moodle (via `mod_assign_get_submission_status`) |
| Show deadline countdown | "Due in 3 days", "Due in 5 hours" — real-time countdown |
| Deep link to Moodle | Each assignment card has a button/tap that opens `https://moodle.tau.ac.il/mod/assign/view.php?id={cmid}` |
| Extension date support | If `extensionduedate > 0`, use that as the true deadline, even if it is after `duedate` or `cutoffdate` |
| Overdue detection | If `max(duedate, cutoffdate, extensionduedate) < now` and status != Submitted → status = `Not submitted` |
| Mark as locally done | Optional local toggle to hide an assignment from the "pending" list (stored locally, does NOT submit to Moodle) |

**Critical porting note from `legacy/clients/moodle_client.py`:** The deadline computation logic at lines 215–233 is subtle and must be ported exactly:
```
final_deadline = max(duedate, cutoffdate, extensionduedate)
```
All three timestamps can be 0 (meaning "not set"). Never treat 0 as a valid timestamp. Only use `final_deadline` if it is greater than 0. If all are 0, display no deadline.

### Feature 4: File Browser

| Requirement | Detail |
|-------------|--------|
| Browse files per course | Grouped by Moodle section/week name |
| Display file metadata | Name, size, type, last modified |
| Authenticated download | File URLs must have `?token={wstoken}` appended before opening |
| In-app PDF viewer | Mobile: use a native PDF library. Extension: open in a new browser tab. |
| Filter by file type | PDFs, videos, images, etc. |

**Security note:** The `wstoken` is appended as a query parameter to the download URL. This means the token appears in server access logs on Moodle's side. This is acceptable since it is the official Moodle Web Services download mechanism (same as the official Moodle app). Moodle expects this pattern.

### Feature 5: Grades View

| Requirement | Detail |
|-------------|--------|
| Per-assignment grades | Fetched from `gradereport_user_get_grade_items` (one API call per course) |
| Per-course average | Calculated client-side: sum(graderaw / grademax) / count |
| Hidden grades | If `gradeishidden = true`, display as "–" (do not show the grade value) |
| Overall GPA | Weighted average across all courses with graded assignments |

### Feature 6: Google Tasks Sync

| Requirement | Detail |
|-------------|--------|
| One-way sync | Moodle assignments → Google Tasks (not the reverse) |
| Deduplication | Use `tautracker:assignId:{id}` prefix in task notes as stable identifier |
| Status sync | If assignment is `Submitted` in Moodle → mark Google Task as `completed` |
| Deadline sync | Task `due` field = assignment deadline (ISO 8601, date-only is sufficient per Google Tasks API) |
| Task list selection | User can choose which Google Tasks list to sync to (default: create "TauTracker" list) |
| Preserve user edits | If user manually marks a Google Task as completed, do NOT revert it back to `needsAction` on next sync |
| Configurable | Google Tasks sync is opt-in. Don't force it on users who don't want it. |

### Feature 7: Push / Local Notifications

| Requirement | Detail |
|-------------|--------|
| Notification triggers | 24 hours before deadline, 1 hour before deadline |
| Notification content | Assignment name + course name + time remaining |
| Tap action | Opens the relevant assignment page (deep link) |
| Deduplication | Track which notifications have already been sent (store in local storage) to avoid repeat notifications on repeated syncs |
| User control | Settings toggle to enable/disable notifications per-type |

### Feature 8: Zoom / Meeting Links

| Requirement | Detail |
|-------------|--------|
| Detect Zoom links | In `getCourseContents()`, detect modules where `modname == 'lti'` and name contains "zoom", or `modname == 'url'` and the URL contains `zoom.us` |
| Display per-course | Show a list of all Zoom meeting links found in a course |
| One-tap join | Tap the meeting link to open Zoom directly |

### Feature 9: Background Sync

| Requirement | Detail |
|-------------|--------|
| Trigger | Automatic, once per hour (extension: `chrome.alarms`, mobile: `expo-background-fetch`) |
| Manual trigger | "Sync Now" button in the UI |
| Cooldown | Do not allow manual sync more than once every 5 minutes (to avoid hammering Moodle API) |
| Progress reporting | Show sync progress in the UI (in-progress, last synced time, items updated count) |
| Error recovery | If sync fails partway through, catch errors per-course and continue syncing other courses. Report failures without crashing. |
| Parallel fetching | Where possible, fetch multiple courses' contents concurrently using `Promise.all()` — but limit concurrency (max 4–5 parallel requests) to avoid being rate-limited by Moodle |

### Feature 10: Search

| Requirement | Detail |
|-------------|--------|
| Search scope | Courses (by name), assignments (by name or course), files (by name) |
| Language support | Hebrew and English (since course names often contain Hebrew) |
| Implementation | Client-side fuzzy search over cached data — no API call needed |

---

## VII. Technical Challenges & Solutions

### Challenge 1: Moodle CORS (Extension Only)

**Problem:** A regular webpage cannot `fetch()` from `moodle.tau.ac.il` due to Same-Origin Policy. Moodle does not set `Access-Control-Allow-Origin: *` headers.

**Solution:** The extension's Service Worker has `host_permissions` for `*://moodle.tau.ac.il/*`. This grants it network-level access. All Moodle API calls in the extension **must happen in the background Service Worker**, not in a content script or popup. The popup and options page retrieve data from `chrome.storage.local` (which was populated by the Service Worker).

**Developer pitfall:** If a developer puts a `fetch()` call directly in the popup's React component, it will fail with a CORS error because the popup runs in the extension's own origin, not in the privileged Service Worker context. All network calls must go through `chrome.runtime.sendMessage()` to the Service Worker, or use `chrome.scripting.executeScript()` in the context of a Moodle tab.

### Challenge 2: Moodle API Rate Limiting

**Problem:** The sync engine makes many HTTP requests (1 per assignment for submission status + 1 per course for grade items + 1 per course for contents). A user with 6 courses and 20 assignments would make approximately 28 API calls per sync. At hourly intervals, this is 672 calls/day per user.

**Solution:**
1. **Concurrency limiting:** Use a concurrency pool (e.g., `p-limit` library) to run at most 4 requests simultaneously.
2. **Caching:** Cache responses with a TTL. Don't re-fetch course contents if they haven't changed since the last hour.
3. **Graceful degradation:** If Moodle returns a rate-limit error (HTTP 429 or specific error codes), back off exponentially and retry.

### Challenge 3: `expo-background-fetch` on iOS

**Problem:** iOS severely restricts background execution time and frequency. An app using `expo-background-fetch` may only get 30 seconds of background execution time, and iOS decides when to call the task (not the app).

**Solution:**
1. Make the background sync as fast as possible. Parallelize requests.
2. Use `expo-notifications` to schedule local notifications during foreground syncs, so notifications still fire even if the background task doesn't run.
3. **Inform users:** Display a clear notice in the iOS app that background sync frequency is limited by iOS. Recommend opening the app daily for reliable data.

### Challenge 4: Service Worker Lifetime (Extension)

**Problem:** Chrome MV3 Service Workers terminate after ~30 seconds of inactivity, which means the Service Worker cannot hold state in memory between events.

**Solution:**
1. Always load state from `chrome.storage` at the beginning of each message/alarm handler.
2. Do not use global variables for stateful data. Use `chrome.storage.local` as the single source of truth.
3. For long-running sync operations that might exceed the SW lifetime: checkpoint progress to `chrome.storage.local` after each course is processed, so if the SW is killed mid-sync, the next alarm pick up from where it left off.

### Challenge 5: Panopto Recordings

**Problem:** Panopto does NOT have a public API. The current server (`legacy/clients/panopto_client.py`) scrapes Panopto using Playwright (a headless Chromium browser). This is not feasible in:
- A mobile app (cannot run a headless browser).
- A browser extension Service Worker (no DOM access in SW).

**Possible paths forward:**
1. **Content script injection (Extension only):** When the user visits a Panopto page in their browser, inject a content script that scrapes the DOM and sends lecture links to the background script. This works but only captures recordings the user actively browses.
2. **Authenticated Panopto API calls:** Investigate whether Panopto exposes any authenticated REST API endpoints. TAU's Panopto instance (`tau.cloud.panopto.eu`) uses OAuth2 SSO. Some Panopto versions expose a REST API (`/Panopto/api/v1/`) that returns folder contents.
3. **Deprioritize for MVP:** Ship the mobile app and extension without Panopto support. Document this as a known gap and revisit.

**Recommendation:** Exclude Panopto from the MVP scope. Focus on Moodle-native features. Add a Panopto tab in the UI that says "Coming soon" or links to the Panopto website directly.

### Challenge 6: Assignment Submission (File Upload)

**Problem:** The current server uploads files using `core_files_upload` Web Service (base64-encoded content). This works for files up to ~10MB. The upload route in `legacy/server/routes/assignments.py` receives the file via multipart, base64-encodes it, and sends it to Moodle.

**In the new client-side architecture:** The file never leaves the user's device to go to a server. The mobile app reads the file locally and encodes it to base64. The extension handles file selection via the browser's file picker.

**Implementation approach:**
- **Mobile:** Use `expo-document-picker` to let the user pick a file. Read it with `expo-file-system.readAsStringAsync(uri, { encoding: 'base64' })`. Send the base64 string directly to `core_files_upload`.
- **Extension:** Use `<input type="file">` in the options page React component. Use `FileReader.readAsDataURL()` to get the base64 content. Send from the options page via `chrome.runtime.sendMessage()` to the Service Worker, which makes the Moodle API call.

**File size limit:** Base64 encoding inflates the file size by ~33%. `core_files_upload` may have its own server-side limits (check Moodle admin settings). For files >10MB, use the multipart upload endpoint `/webservice/upload.php` instead.

### Challenge 7: Hebrew / RTL Support

**Problem:** Course names, assignment titles, and section names on TAU's Moodle are frequently in Hebrew. The app must render Hebrew text correctly, support RTL layout, and allow searching in Hebrew.

**Solution:**
- **Mobile (Expo):** React Native handles RTL via `I18nManager.isRTL`. However, since the app's UI language may be English while course names are Hebrew, the best approach is to support per-element RTL detection: use `writingDirection: 'auto'` on text components displaying Moodle-sourced data.
- **Extension:** Use CSS `direction: auto` on elements displaying Moodle course names and assignment titles. The browser's Unicode bidirectionality algorithm will handle mixed Hebrew/English strings.

---

## VIII. Data Flow Diagrams

### 8.1 — First-Time Setup Flow

```
User installs app/extension
        │
        ▼
Show onboarding screen
"Connect your Moodle account"
        │
        ├──(Extension)──► Monitor for MoodleSession cookie
        │                        │
        │                  User logs into Moodle normally
        │                        │
        │                  Cookie detected → silent token capture
        │                        │
        └──(Mobile)──► Show WebView with Moodle login page
                               │
                         User logs in
                               │
                         Extract wstoken from /login/token.php
                               │
                         ┌─────▼───────────────────────┐
                         │  Validate token:             │
                         │  getSiteInfo(token)          │
                         │  → get userId, username      │
                         └─────┬───────────────────────┘
                               │
                         Save token to secure storage
                               │
                         Fetch enrolled courses
                               │
                         Show course selection screen
                               │
                         User selects courses to track
                               │
                         Save preferences to local storage
                               │
                         Run first full sync
                               │
                         Show dashboard with data
```

### 8.2 — Background Sync Flow

```
Alarm fires (every hour)
        │
        ▼
Load token from secure storage
        │
        ├── No token? → Log "not authenticated", exit
        │
        ▼
Load tracked course IDs from local storage
        │
        ▼
runSync(token, courseIds, onProgress)
        │
        ├── getSiteInfo() → userId
        │
        ├── getEnrolledCourses() → filter to tracked
        │
        ├── getAssignments() → all assignments
        │
        ├── [for each assignment] getSubmissionStatus() → status, extensionDate
        │
        ├── [for each course] getGradeItems() → grade map
        │
        └── [for each course] getCourseContents() → files, meetings
                │
                ▼
        Merge into SyncResult
                │
                ▼
        Save to local storage (SQLite / chrome.storage.local)
                │
                ▼
        Diff against previous sync result
                │
                ▼
        Schedule deadline notifications for new/changed assignments
                │
                ▼
        (If Google Tasks enabled) syncToGoogleTasks()
                │
                ▼
        Update "last synced" timestamp
```

---

## IX. Project Structure (Detailed)

```
TauTracker/
├── apps/
│   ├── mobile/
│   │   ├── app/                    # Expo Router file-based routing
│   │   │   ├── (tabs)/
│   │   │   │   ├── index.tsx       # Dashboard (upcoming assignments)
│   │   │   │   ├── courses.tsx     # Course tracking config
│   │   │   │   ├── files.tsx       # File browser
│   │   │   │   ├── grades.tsx      # Grades view
│   │   │   │   └── settings.tsx    # Settings
│   │   │   ├── assignment/[id].tsx # Assignment detail page
│   │   │   └── _layout.tsx
│   │   ├── components/             # Shared React Native components
│   │   ├── hooks/                  # Custom hooks (useSync, useToken, etc.)
│   │   ├── store/                  # Local state (Zustand or Redux Toolkit)
│   │   ├── services/
│   │   │   ├── database.ts         # expo-sqlite wrapper
│   │   │   ├── notifications.ts    # expo-notifications wrapper
│   │   │   ├── backgroundSync.ts   # expo-background-fetch task
│   │   │   └── googleTasks.ts      # Google Tasks integration
│   │   ├── app.json                # Expo config
│   │   └── package.json
│   │
│   └── extension/
│       ├── src/
│       │   ├── background/
│       │   │   └── serviceWorker.ts     # MV3 SW: alarms, sync, notifications
│       │   ├── popup/
│       │   │   ├── index.html
│       │   │   ├── Popup.tsx            # Compact upcoming assignments view
│       │   │   └── main.tsx
│       │   ├── options/
│       │   │   ├── index.html
│       │   │   ├── App.tsx              # Full dashboard SPA
│       │   │   ├── pages/
│       │   │   │   ├── Dashboard.tsx
│       │   │   │   ├── Courses.tsx
│       │   │   │   ├── Files.tsx
│       │   │   │   ├── Grades.tsx
│       │   │   │   └── Settings.tsx
│       │   │   └── main.tsx
│       │   └── shared/
│       │       ├── storage.ts           # chrome.storage wrappers
│       │       ├── messaging.ts         # chrome.runtime.sendMessage helpers
│       │       └── googleTasks.ts
│       ├── public/
│       │   ├── icons/
│       │   └── manifest.json
│       ├── vite.config.ts
│       └── package.json
│
├── packages/
│   └── moodle-client/
│       ├── src/
│       │   ├── types.ts             # All TypeScript interfaces
│       │   ├── moodleApi.ts         # fetch()-based Moodle WS API wrapper
│       │   ├── syncEngine.ts        # Orchestrates full data sync
│       │   ├── courseParser.ts      # TAU idnumber parsing
│       │   ├── googleTasksSync.ts   # Google Tasks sync logic
│       │   └── index.ts             # Public API exports
│       ├── __tests__/
│       │   ├── moodleApi.test.ts
│       │   ├── syncEngine.test.ts
│       └── package.json
│
├── legacy/                          # All old Python server code (READ-ONLY reference)
│   ├── server/
│   ├── clients/
│   ├── docs/
│   ├── db/
│   └── ...
│
├── transition/
│   ├── PLAN_v0.md
│   ├── PLAN_v1.md
│   └── data/
│
├── package.json                     # Monorepo root
├── pnpm-workspace.yaml
├── turbo.json
└── README.md
```

---

## X. Implementation Order (Recommended Phases)

### Phase 0 — Restructuring (1-2 days)
1. Move all existing Python code into `legacy/`.
2. Initialize monorepo with pnpm + Turborepo.
3. Create empty `apps/` and `packages/` directories.

### Phase 1 — Shared Library (1-2 weeks)
1. Scaffold `packages/moodle-client` with TypeScript config.
2. Implement `types.ts` — all data interfaces.
3. Implement `moodleApi.ts` — all Moodle API calls using `fetch()`.
4. Write unit tests for `moodleApi.ts` using mocked `fetch()` responses.
5. Implement `courseParser.ts` — TAU idnumber parsing.
6. Implement `syncEngine.ts` — orchestration logic.
7. Test `syncEngine.ts` against a real Moodle token (integration test, not in CI).

### Phase 2 — Browser Extension MVP (2-3 weeks)
1. Initialize with Vite + CRXJS + React.
2. Set up `manifest.json` with correct permissions.
3. Implement `serviceWorker.ts`: token storage, alarm setup, sync call.
4. Implement token acquisition (cookie capture + manual fallback).
5. Implement options page with Dashboard and Settings tabs.
6. Implement Courses tab (tracking configuration).
7. Implement assignment list view with deep links.
8. Implement background notifications.
9. Pack and test in Chrome developer mode.

### Phase 3 — Mobile App MVP (3-4 weeks)
1. Initialize with `npx create-expo-app@latest`.
2. Set up Expo Router with tab navigation.
3. Implement secure token storage and onboarding flow.
4. Set up SQLite schema and migration system.
5. Implement sync service (foreground + background).
6. Implement Dashboard screen (assignment list).
7. Implement Courses screen (tracking config).
8. Implement Files screen (file browser + download).
9. Implement Grades screen.
10. Implement notifications.
11. Test on iOS simulator and physical Android device.

### Phase 4 — Google Tasks Integration (1 week)
1. Implement Google OAuth flow (both platforms).
2. Port sync logic from `legacy/clients/google_client.py`.
3. Add Google Tasks settings UI.
4. End-to-end test.

### Phase 5 — Polish & Release (1-2 weeks)
1. Hebrew/RTL text handling audit.
2. Error states and empty states for all screens.
3. Offline mode (show cached data when no internet).
4. Chrome Web Store submission.
5. Expo EAS Build for iOS/Android.

---

## XI. What to Port from Legacy Code

This section maps each piece of legacy Python code to its TypeScript equivalent.

| Legacy File | Legacy Function/Class | Port To | Notes |
|-------------|----------------------|---------|-------|
| `legacy/clients/moodle_client.py` | `get_enrolled_courses()` | `packages/moodle-client/moodleApi.ts::getEnrolledCourses()` | Port exactly |
| `legacy/clients/moodle_client.py` | `get_pending_assignments()` | `packages/moodle-client/syncEngine.ts::runSync()` (assignment step) | Complex — see porting notes in Section 1.3 |
| `legacy/clients/moodle_client.py` | `get_assignment_grades()` | `packages/moodle-client/moodleApi.ts::getGradeItems()` | One API call per course |
| `legacy/clients/moodle_client.py` | `get_course_contents()` | `packages/moodle-client/moodleApi.ts::getCourseContents()` | |
| `legacy/clients/moodle_client.py` | `get_course_files()` | Part of `syncEngine.ts` (extract from course contents) | |
| `legacy/clients/moodle_client.py` | `get_course_meetings()` | Part of `syncEngine.ts` (extract from course contents) | Hebrew keyword detection for Zoom ("שיעור", "הרצאה") |
| `legacy/clients/moodle_client.py` | `download_file()` | `packages/moodle-client/moodleApi.ts::buildAuthenticatedFileUrl()` | Append `?token=...` |
| `legacy/clients/moodle_client.py` | `upload_submission()` + `submit_assignment()` | `packages/moodle-client/moodleApi.ts::uploadFile()` + `saveAndSubmitAssignment()` | |
| `legacy/clients/moodle_client.py` | `parse_course_metadata()` | `packages/moodle-client/courseParser.ts::parseTauCourseMetadata()` | TAU-specific regex |
| `legacy/clients/google_client.py` | `sync_task()` | `packages/moodle-client/googleTasksSync.ts::syncAssignmentToTask()` | Title matching → note-based stable ID |
| `legacy/clients/google_client.py` | `get_or_create_tasklist()` | `packages/moodle-client/googleTasksSync.ts::getOrCreateTaskList()` | |
| `legacy/clients/google_client.py` | `sync_data()` | `packages/moodle-client/googleTasksSync.ts::syncAllToGoogleTasks()` | Simplified: no Google Sheets |
| `legacy/server/services/sync_service.py` | `run_sync_task()` | `packages/moodle-client/syncEngine.ts::runSync()` | Major logic lives here |
| `legacy/server/auth/encryption.py` | `encrypt_token()` / `decrypt_token()` | **NOT PORTED** — encryption is handled by the platform (SecureStore / chrome.storage) | |
| `legacy/server/auth/security.py` | JWT, password hashing | **NOT PORTED** — no server, no user accounts | |
| `legacy/clients/panopto_client.py` | `get_new_lectures()` | **DEFERRED** — Panopto not supported in MVP | |

---

## XII. What NOT to Port (Retired Concepts)

The following concepts from the current system are **explicitly not carried forward** to the new architecture:

| Concept | Why It's Retired |
|---------|-----------------|
| User registration / login / JWT auth | No server = no user accounts. The "account" is the Moodle token on the device. |
| Server-side CSV database | All data is stored locally on the user's device. |
| Fernet token encryption on server | Token security is delegated to the OS (SecureStore / chrome.storage). |
| FastAPI backend server | No backend. All API calls go directly from client to Moodle. |
| Python `requests` library | Replaced by the global `fetch()` API (works in both Extension SW and React Native). |
| Server-side Playwright scraping | No Panopto for MVP. If re-added, use content scripts in extension. |
| Google Sheets integration | Removed. The local database replaces Google Sheets as the user's data view. Google Tasks integration remains for task management. |
| Sync cooldown stored in server DB | Cooldown tracked in local storage (`chrome.storage.local` or SQLite `preferences` table). |
| GitHub Actions CI for data sync | No scheduled server-side jobs. Everything runs on the user's device. |

---

## XIII. Open Questions & Decisions for Developers

These are unresolved design decisions that developers must discuss and decide before implementation.

1. **Monorepo tool: Turborepo vs Nx?** PLAN_v0 suggests Turborepo. This is the simpler choice for a project of this size. Unless there is a specific reason to use Nx, go with Turborepo.

2. **Extension token capture: Cookie detection vs manual?** The cookie-based approach is elegant but may break if Moodle changes its session cookie mechanics. Should we implement the manual paste flow first (simpler) and add cookie capture as a UX enhancement later?

3. **Mobile onboarding: WebView login vs manual token paste?** WebView login is a better UX but more complex (handling SSO redirects, extracting the token). Manual paste is simpler but requires user education. Recommendation: implement manual paste first, add WebView login in a later version.

4. **State management library for mobile?** Options: Zustand (simple, small), Redux Toolkit (powerful, complex), Jotai (atomic, minimal). Given the relatively simple data model, Zustand is recommended.

5. **Extension popup vs full page?** Should the extension have a popup UI at all, or should clicking the icon always open the full options page? A popup is useful for quick upcoming assignment previews. Both should be implemented.

6. **Google Tasks: OAuth client creation.** Someone needs to create Google Cloud Console projects for both the mobile app (using Google Sign-In) and the browser extension (using Chrome's identity API). These require app store verification for production. Document who owns these credentials.

7. **Multi-institution support.** PLAN_v0 only mentions TAU. The existing code has a global `MOODLE_URL` constant. If other universities are in scope, the Moodle URL should be a user-configurable setting (not hardcoded). Recommend adding an "Institution" selection screen in onboarding with a text field for custom Moodle URLs.

8. **Privacy policy.** If the app is published to the App Store / Play Store / Chrome Web Store, a privacy policy is required. Since no data leaves the device (except to Moodle and Google Tasks), the policy can be simple: "We collect nothing. Your token lives on your device."

---

## XIV. Testing Strategy

### Unit tests (`packages/moodle-client/__tests__/`)
- Test `parseTauCourseMetadata()` with various `idnumber` formats (including edge cases: no idnumber, wrong format, yearly semester code "0").
- Test `buildAuthenticatedFileUrl()` with URLs that already have query parameters vs. clean URLs.
- Test deadline computation logic: max of duedate/cutoffdate/extensionduedate, zero-value handling.
- Mock `fetch()` to test `moodleApi.ts` functions without real Moodle calls.

### Integration tests (manual, against real Moodle)
- Full sync: verify `SyncResult` contains expected assignments for known test courses.
- Token validation: verify `getSiteInfo()` works with a valid token and fails gracefully with an invalid one.
- File download: verify `buildAuthenticatedFileUrl()` produces a URL that Moodle accepts.

### Extension testing
- Load unpacked extension in Chrome developer mode.
- Verify token capture works after logging into Moodle.
- Verify alarm fires and sync runs (check `chrome.storage.local` after alarm fires).
- Verify notifications appear for upcoming deadlines.

### Mobile testing
- Run on iOS Simulator and a physical Android device.
- Test background fetch (requires real device for reliable testing).
- Test SecureStore by verifying the token survives app restart.
- Test file download and sharing on both platforms.

---

> **Final note for developers:** The `legacy/` directory is your reference implementation. Before writing any TypeScript, read the corresponding Python function. The logic is proven and correct. Your job is to translate it faithfully into TypeScript with proper typing, modern async/await patterns, and the constraints of a client-side environment. Do not invent new business logic — port what exists.
