# Noodle — Features, Decisions & Needs Specification

This specification serves as the comprehensive architectural reference for the Noodle system. It splits the product definition into **System-Wide (cross-platform)** specifications and **Extension-Specific** specifications to establish a clear development blueprint for both the browser extension and the native mobile app.

---

## 1. System-Wide Features, Decisions, & Needs
These represent core capabilities, business rules, parser formats, and data mappings that apply globally across all clients (both Chrome Extension and Mobile App). The mobile application should replicate these features exactly.

### A. Features

#### 1. Tracked Courses Selection & Grouping
*   **Feature**: Users choose which courses to track from the list of enrolled courses retrieved from Moodle.
*   **Semester Grouping**: Courses must be grouped and sorted by semester (e.g. Semester A, Semester B, Summer) based on the course code metadata. 
*   **Implementation**: Done via the shared parser logic in `packages/moodle-client` which matches patterns in course names and numbers (e.g., matching semesters using the suffix `-1` for Semester A, `-2` for Semester B, and `-3` for Summer).

#### 2. Course Personalization (Nicknames & Colors)
*   **Feature**: Users can assign custom nicknames to courses to replace Moodle's long, cluttered names and select custom UI colors for easy scanning.
*   **Behavior**: Nicknames and color identifiers must propagate everywhere in the client: in course views, on the main assignments list, inside zoom meeting cards, and as prefix categories in Google Tasks.

#### 3. Unified Assignments Dashboard
*   **Feature**: A single, chronological, unified list of all pending and completed assignments across all tracked courses.
*   **Visual Proximity Indicators**: Deadlines are color-coded based on proximity:
    - **Green**: Safe zone (default threshold: 7 days or more).
    - **Yellow**: Medium alert (default threshold: 3 days or more).
    - **Red**: Urgent (default threshold: less than 3 days).
    - *Thresholds are user-customizable in Settings.*

#### 4. In-Place Subject Expansion
*   **Feature**: Clicking on an assignment expands the containing course's section details inline on the same page.
*   **Content**: Displays associated course assets such as PDF documents, files, zoom meeting links, and announcements, avoiding the need to load a separate page.

#### 5. Google Tasks Sync Integration
*   **Feature**: One-way sync of assignments to a dedicated Google Tasks list named "Noodle".
*   **Data Mapping**:
    - **Task Title**: Formatted as `[Course Code / Nickname] Assignment Name` (e.g. `[Linear Algebra] Homework 1`).
    - **Due Date**: Moodle nominal/extension due date formatted in ISO 8601 (date-only: `YYYY-MM-DD`).
    - **Stable Metadata**: Injected into the task notes field as `Noodle:assignId:{moodle_assign_id}` to prevent duplicate creations and match updates.
    - **Completion Mapping**: Staging the task status to `completed` if the Moodle status is `Submitted`.
    - **User Overrides**: If the user manually marks a task as `completed` on Google Tasks, the sync engine preserves the status and never overwrites it back to `needsAction`.

#### 6. Multilingual Support (i18n)
*   **Feature**: Complete interface localization for Hebrew (RTL, right-to-left layout) and English (LTR, left-to-right layout).
*   **Constraint**: Language selection changes the document direction (`dir="rtl"` vs `dir="ltr"`), styling alignments, and text orientations dynamically.

---

### B. Architectural Decisions

#### 1. Decentralized Client-Only Model
*   **Decision**: Absolutely no central server or cloud database is used. Each client fetches data directly from `moodle.tau.ac.il` and the Google API.
*   **Rationale**: 
    1.  **IP Block Prevention**: Central servers making thousands of daily requests on behalf of users are flagged as scrapers. Client-side requests originate from the student's personal IP, matching natural traffic.
    2.  **Privacy Compliance**: Storing user credentials (university login, Israeli national ID, and passwords) on a remote server raises legal compliance issues. The client-only model encrypts and stores credentials locally.

#### 2. Environment-Agnostic Shared Library (`packages/moodle-client`)
*   **Decision**: Shared sync core, Moodle client, and regex course parser reside in a shared library.
*   **Constraint**: The package must remain environment-agnostic. It cannot call Node-specific APIs (`fs`, `crypto`) or browser DOM globals (`window`). It relies purely on the standard fetch API, ensuring compatibility with Hermes/React Native and Chrome Manifest V3 service workers.

---

### C. Technical Needs & Authentication

#### 1. SSO Login Handshake
*   **Need**: Authenticating with Moodle Mobile App launcher using user university credentials.
*   **Redirect Chain**: 
    1.  Post credentials to Moodle SSO.
    2.  Redirect through TAU's SAML provider.
    3.  Redirect to launcher URL containing the target token: `https://moodle.tau.ac.il/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport={passport}`.
    4.  Redirect to custom scheme redirector: `moodlemobile://token={token}`.
*   **Need**: Capturing the `{token}` string from the launch sequence is required to write it to local storage.

#### 2. Moodle REST APIs
*   **Need**: Direct query access to the Moodle REST endpoint (`/webservice/rest/server.php`) with JSON format parameters (`moodlewsrestformat=json`) and the user's `wstoken`.
*   **Required Web Services**:
    - `core_webservice_get_site_info`: Retrieve student user ID.
    - `core_enrol_get_users_courses`: Fetch enrolled courses.
    - `core_course_get_contents`: Retrieve sections, files, and zoom links.
    - `mod_assign_get_assignments`: Pull assignments lists.
    - `mod_assign_get_submission_status`: Query submission states and personal extensions.
    - `gradereport_user_get_grade_items`: Pull course grades.

---

## 2. Extension-Specific Features, Decisions, & Needs
These represent implementation details and limitations specific only to the Google Chrome Extension.

### A. Features

#### 1. Dual-View Interface (Popup vs Options)
*   **Popup UI**: Activating the extension badge displays a compact popup with urgent deadlines, quick sync actions, and a link to the main dashboard.
*   **Options Dashboard**: A full-page tab workspace displaying the complete dashboard, calendar, files repository, settings panel, and onboarding screen.

#### 2. Collapsible Sidebar Navigation
*   **Feature**: The sidebar can be collapsed to maximize screen real estate on smaller desktop displays.
*   **Transitions**: Smooth grid template transition (`grid-template-columns` between `240px 1fr` and `72px 1fr`).
*   **Elements**: Hides navigation labels, replaces text buttons with emoji shorthand, and scales the Noodle logo from `576px` (responsive) down to `40px` inside a collapsed state selector.

---

### B. Architectural Decisions

#### 3. CORS Bypass via Manifest Host Permissions
*   **Decision**: Declare host permissions in `manifest.json` for `*://moodle.tau.ac.il/*`.
*   **Rationale**: Standard web browsers prevent client-side pages from requesting cross-origin resources. Elevating host permissions in the background service worker bypasses CORS restrictions when querying Moodle.

#### 4. Chrome Alarms Sync Frequency Check
*   **Decision**: Use `chrome.alarms` to run background syncs every 5 minutes.
*   **Alarm Existential check**: Since Manifest V3 service workers terminate frequently, running alarm setup at the top-level resets the alarm schedule on every wake-up. The worker must call `chrome.alarms.get` to see if the alarm exists with a 5-minute period before recreating it.

#### 5. SSO CORS Bypass via WebRequest
*   **Decision**: Capture Moodle tokens by hooking into the redirect phase.
*   **Rationale**: The Moodle SSO sequence ends by redirecting to a custom scheme `moodlemobile://`. Standard web fetch calls block this redirect due to security policy (generating a console warning). Hooking `chrome.webRequest.onBeforeRedirect` captures the token from the redirect URL parameter *before* the browser blocks the protocol load, allowing login to succeed seamlessly.

#### 6. Logout Cookie Cleansing
*   **Decision**: Programmatic cookie deletion upon user logout.
*   **Rationale**: Prevents session caching and user account crossover by purging `MoodleSession` and related authentication cookies from `moodle.tau.ac.il` on logout.

---

### C. Extension Needs

#### 1. Chrome storage API
*   `chrome.storage.local`: Caches raw payloads (assignments, course sections, token credentials) encrypted-at-rest.
*   `chrome.storage.sync`: Syncs lightweight user preferences (tracked course IDs, course colors, and nicknames) across user Chrome profiles.

#### 2. Chrome identity API
*   **Need**: Use `chrome.identity.launchWebAuthFlow` to handle Google OAuth consent screens on desktop chrome sessions to query Google Tasks.

---

## 3. Mobile-Specific Context (Guidance for Mobile Porting)
This section details how mobile developers should translate these features and needs into React Native / Expo:

*   **CORS Bypass**: Native HTTP fetches (running in Hermes/JSC) do not enforce browser Same-Origin Policies. Host permissions are not needed; direct calls to Moodle will succeed out-of-the-box.
*   **Secure Storage**: Instead of local storage, mobile must store sensitive items (`wstoken`, Google OAuth tokens) in hardware-encrypted OS keychains via `expo-secure-store`.
*   **Local Caching**: Store course files, zoom links, and assignments in a local SQLite database using `expo-sqlite`, ensuring instantaneous render times and offline usability.
*   **Background Sync**: Replace `chrome.alarms` with `expo-background-fetch` + `expo-task-manager` which coordinates sync loops under OS battery/network constraints.
*   **Local Notifications**: Use `expo-notifications` to schedule push alerts for upcoming deadlines instead of desktop notifications.
*   **SAML SSO Capture**: Open a mobile WebBrowser session (`expo-web-browser` or `react-native-webview`) to complete the SSO login. Replicate token capture by listening to URL state changes and intercepting redirect URLs starting with the custom protocol `moodlemobile://token=`.
*   **File Downloader**: Use `expo-file-system` to download slides and files (appending `?token={wstoken}` to authorized Moodle file URLs) and call `expo-sharing` to launch native iOS/Android document viewers.
