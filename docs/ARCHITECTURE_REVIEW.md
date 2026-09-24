# Moodle Sync Architecture Review: Optimal Flow vs. Current Flow

This document evaluates the ideal synchronization architecture for a client-side Moodle frontend (Chrome Extension / React Native) and contrasts it with the current implementation in `moodle-client`. It identifies architectural deviations and assigns them severity scores based on their impact on performance, stability, and maintainability.

## 1. The Optimal Flow (The "Gold Standard")

A flawless Moodle sync engine should operate as a highly efficient, deterministic pipeline:

1. **Authentication**:
   - Relies on standard OAuth2 or SSO (Single Sign-On) cookies naturally managed by the browser.
   - A valid Moodle Web Services token (`wstoken`) is securely acquired and automatically refreshed.
2. **Primary Data Fetching (REST API)**:
   - Queries Moodle's native Web Service endpoints (e.g., `core_course_get_contents`, `mod_assign_get_assignments`) returning strict, structured JSON.
   - Network requests are minimal, parallelized, and highly resilient to UI changes.
3. **Archive Instance Routing**:
   - The engine intelligently recognizes course IDs belonging to past academic years (e.g., `2025/`, `2024/`).
   - It bypasses the root REST token (which is bound to the current year) and directly queries the archive instances using authenticated AJAX calls.
4. **Fallback Mechanism**:
   - HTML scraping is used *exclusively* as a last resort for data not exposed by APIs (e.g., specific Zoom LTI links).
5. **Unified Data Model**:
   - Moodle's confusing ID system (`instanceId` vs. `cmid`) is strictly normalized immediately at the network boundary.

---

## 2. Our Current Flow

Our implementation uses a **Strategy Fallback Architecture** (`RestStrategy` → `AjaxStrategy` → `ScraperStrategy`). It orchestrates syncs via `syncEngine.ts`:

1. Uses user-provided credentials to generate a root `wstoken`.
2. Attempts the REST strategy. If the token expires or an endpoint is unsupported, it cascades down to AJAX, and finally to HTML Scraping.
3. `syncEngine.ts` processes course discovery, course contents (modules/files), assignment aggregation, submission statuses, and grades.

---

## 3. Architectural Deviations & Severity Analysis

Comparing our current flow to the optimal flow reveals several significant deviations:

### Deviation 1: Brittle HTML Scraping Dependency
* **Severity: HIGH (8/10)**
* **The Problem**: When the REST token expires or fails, the entire application degrades to the `ScraperStrategy`. This strategy relies heavily on complex Regular Expressions (Regex) to parse the Moodle DOM (e.g., extracting modules, links, IDs).
* **The Impact**: Moodle frequently updates its HTML structure (e.g., Moodle 4.x nesting `modtype_` spans deeper inside `activitytitle`). When the DOM changes, the regex fails silently, leading to bugs like "0 files and 0 zoom links found." 
* **Optimal Fix**: We must shift as much weight as possible away from DOM parsing and towards `AjaxStrategy` (which returns structured JSON using `lib/ajax/service.php`), relying on HTML parsing *only* when absolutely necessary.

### Deviation 2: Token Expiration & Silent Degradation
* **Severity: HIGH (7/10) — [RESOLVED]**
* **The Problem**: If the user's root `wstoken` expires (due to password changes or university security policies), the `RestStrategy` fails completely. The client used to engage a 1-hour circuit breaker and fall back to the `ScraperStrategy` using the browser's native SSO cookies, leaving the user permanently in a degraded scraper state.
* **The Solution Implemented**: The fallback runner (`fallbackRunner.ts`) now intercepts `invalidtoken` and `accessexception` errors on `RestMoodleStrategy`. It immediately invokes `getMobileToken()` on `ScraperMoodleStrategy`, which leverages active SSO session cookies to hit `/user/managetoken.php`, executes a token reset, and extracts the freshly generated `wstoken`. It propagates the new token across all strategies (`setToken`), resets the circuit breaker cooldown, and retries the REST operation seamlessly without requiring the user to re-enter credentials or log in again.

### Deviation 3: Unnecessary Network Overhead for Archive Courses
* **Severity: MEDIUM (5/10)**
* **The Problem**: The `MoodleClient` does not proactively route archive courses (e.g., a course on `/2025/`) away from the REST strategy. 
* **The Impact**: When `syncEngine` attempts to fetch grades or submissions for a 2025 course, it blindly calls the root REST API. The REST API throws an exception ("Course not found"). The client intercepts the error and successfully falls back to the scraper. While this *works*, it causes a massive amount of unnecessary failed network requests, wasting bandwidth and slowing down the sync process.
* **Optimal Fix**: The `StrategyMoodleClient` should inspect the target `courseId`. If the course belongs to an archive year, it should instantly bypass the REST strategy and route directly to the archive's AJAX/Scraper strategies.

### Deviation 4: Missing Historical Due Dates for Archive Assignments
* **Severity: LOW (3/10) — [RESOLVED]**
* **The Problem**: The `ScraperStrategy` historically relied on the Moodle Calendar to discover assignments. The calendar explicitly filters out past events, causing past assignments (many of which are not graded or have passed deadlines) to be missed.
* **The Solution Implemented**: Completely eliminated calendar dependency in `ScraperMoodleStrategy.getAssignments()`. It now loops directly over known courses in `courseYearMap`, fetching individual course pages (`/course/view.php?id=X`) across all active and archive years (e.g. 2025, 2024, current), extracting all assignment module links (`/mod/assign/view.php?id=Y`) and their `.instancename` titles directly from the course DOM. This accurately and comprehensively discovers all course assignments (verifying 141 assignments in live testing).

### Deviation 5: Mixed ID Normalization (`cmid` vs `instanceId`)
* **Severity: LOW (3/10)**
* **The Problem**: Moodle identifies assignments by two IDs: `id` (the assignment instance ID) and `cmid` (the course module ID). REST requires the `instanceId`, while HTML URLs require the `cmid`. 
* **The Impact**: Historically, the `ScraperStrategy` conflated the two to make the calendar logic work. Our recent patch (`getSubmissionStatus(assignId, cmid)`) bridged this technical debt safely, but the underlying data model produced by `ScraperStrategy` remains slightly denormalized. It works perfectly in practice, but poses a minor risk for future developers maintaining the codebase.

---

## Conclusion & Next Steps

The recent fixes we implemented directly addressed the critical failure points (SSO race conditions and regex truncations). The sync engine is currently robust enough to bypass these deviations and successfully deliver your data. 

However, to achieve the "Optimal Flow," we should prioritize fixing **Deviation 1** and **Deviation 2** in the future: transitioning the fallback mechanism to rely more on AJAX JSON endpoints rather than HTML scraping, and implementing a UI prompt when the primary REST token permanently expires.
