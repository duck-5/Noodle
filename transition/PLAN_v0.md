## I. Architectural Overview

The system utilizes a **Monorepo Architecture** (managed via Turborepo or Nx) to maximize code reuse between a native mobile application and a browser extension. Because Moodle limits direct unauthorized API access and strictly enforces Cross-Origin Resource Sharing (CORS), the system completely bypasses the need for a centralized backend proxy. Instead, it relies on **Client-Side Edge Fetching**, turning the user's local device (phone or browser) into the authenticated API client.

### Core Stack

* **Package Manager/Workspace:** pnpm + Turborepo.
* **Shared Library (`packages/api-client`):** Pure TypeScript. Contains all Moodle API and Google Tasks API data fetching, parsing logic, and type definitions.
* **Mobile App (`apps/mobile`):** React Native (Expo). Targets iOS and Android.
* **Browser Extension (`apps/extension`):** React + Vite + CRXJS. Targets Chromium (Manifest V3) with polyfills for future Gecko support.

---

## II. Component Breakdown & Technical Solutions

### 1. The Browser Extension (Manifest V3)

The extension operates directly inside the Chromium browser, bypassing CORS restrictions by leveraging elevated host permissions.

**Technical Challenges & Solutions:**

* **Challenge: CORS Blocks:** Standard web applications cannot fetch from `moodle.tau.ac.il` due to the Same-Origin Policy.
* **Solution:** The extension's `manifest.json` will declare `"host_permissions": ["*://moodle.tau.ac.il/*"]`. This grants the background Service Worker the network privileges required to make direct `fetch()` requests without triggering CORS blocks.


* **Challenge: Frictionless Authentication (No Password Entry):** Users should not have to manually extract and paste their Moodle tokens.
* **Solution:** The Service Worker utilizes the `chrome.cookies` API. When the user logs into Moodle normally, the extension detects the `MoodleSession` cookie. The background script then performs a silent request to Moodle's `/login/token.php` endpoint. Because the browser automatically attaches the session cookie to this request, the endpoint returns the API token (`wstoken`). The token is captured and saved.


* **Challenge: UI Instability:** Modifying the raw Moodle DOM via Content Scripts is highly brittle due to inconsistent HTML formatting across different courses.
* **Solution:** The extension employs an "Extension Page" layout. It does not overwrite the course pages. It provides a dedicated, isolated React dashboard (opened via the extension icon or a new tab) that renders the extracted data cleanly.



### 2. The Native Mobile Application

The native mobile app ensures high user engagement by providing on-the-go access without relying on browser cookie sessions.

**Technical Challenges & Solutions:**

* **Challenge: Centralized IP Blacklisting:** Routing traffic through a single backend server to serve the mobile app would trigger university firewalls.
* **Solution:** React Native executes HTTP requests natively via the host OS network stack, which does not enforce CORS. Every API call originates from the user's specific cellular or Wi-Fi IP address, rendering the traffic indistinguishable from the official Moodle app.


* **Challenge: Token Security Liability:** Storing API tokens on a central cloud database exposes the system to massive privacy liabilities under Israeli privacy law.
* **Solution:** Implement **Zero-Trust Local Storage**. The `wstoken` is never transmitted to a developer-owned server. It is stored exclusively on the user's device using `expo-secure-store`. This leverages hardware-backed encryption (iOS Keychain / Secure Enclave and Android Keystore / TEE).


* **Challenge: File Viewing & Downloads:** Moodle assignment files (PDFs) require authentication to download.
* **Solution:** Utilize `expo-file-system` paired with a React Native PDF viewer. The API client must append the `wstoken` as a query parameter (e.g., `?token=YOUR_TOKEN`) to the file URL before initiating the download to bypass the standard login redirect.



### 3. The Shared API Client

This is an isolated NPM package within the monorepo responsible for standardizing data structures.

**Technical Challenges & Solutions:**

* **Challenge: Google Tasks Synchronization:** Managing two-way sync states between Moodle assignments and Google Tasks.
* **Solution:** Implement a unified sync engine in TypeScript. The engine will hash the Moodle Assignment ID and append it to the Google Task metadata. During background syncs, the engine diffs the Moodle pending array against the Google Tasks array, adding new tasks and marking completed ones as "done" via the Google Tasks REST API.



---

## III. Features & System Requirements Specification

The system must fulfill the following functional requirements across both platforms:

| Requirement Category | Specific Implementation Detail |
| --- | --- |
| **1. Comprehensive Data Access** | Full retrieval of Moodle courses, assignments, and grades using the Moodle Web Services API (e.g., `core_course_get_courses_by_field`, `mod_assign_get_assignments`). |
| **2. Configurable Course Tracking** | Users can toggle which active courses are tracked. The local database (SQLite/AsyncStorage) saves these boolean preferences. |
| **3. Centralized Dashboard** | A unified UI displaying a chronological list of pending assignments filtered strictly by the "tracked" courses configuration. |
| **4. Direct Moodle Routing** | Every rendered assignment card must contain a deep link constructed to route directly to the standard Moodle web page (e.g., `https://moodle.tau.ac.il/mod/assign/view.php?id=[CMID]`). |
| **5. Categorized File Access** | Fetch and display course files categorized by Moodle's logical sections/weeks (utilizing `core_course_get_contents`). Includes a native/in-browser PDF viewer. |
| **6. Google Tasks Integration** | Automated synchronization. Adds pending assignments to a designated "University" Google Tasks list, configuring due dates to trigger native Google Calendar reminders. |
| **7. Push/Local Notifications** | Background processes (using Chrome Alarms in the extension, and Expo Background Fetch on mobile) wake up every hour to diff assignments and trigger native OS push notifications for upcoming deadlines. |
| **8. Parallel Synchronization** | Background sync operations (Moodle fetching + Google Tasks writing) must execute asynchronously without blocking the main UI thread. |