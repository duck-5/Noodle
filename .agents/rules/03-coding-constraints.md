# Rule: Coding Constraints & Implementation Rules

All agents contributing code to Noodle must strictly abide by these engineering constraints.

---

## 1. Pure TypeScript Constraints (`packages/moodle-client`)

The core client library (`packages/moodle-client`) is shared across two radically different runtime environments:
- **Chrome Extension Background Context**: Manifest V3 Service Worker.
- **Mobile Client**: React Native running on the Hermes JavaScript engine.

**Mandatory Rules:**
- **No Node.js built-ins**: Never import `fs`, `path`, `crypto`, `os`, `stream`, or `buffer`.
- **No Node-dependent HTTP libraries**: Do not use `axios`, `got`, or `node-fetch`.
- **Standard Fetch Only**: Always use the global `fetch()`, `Headers`, `Request`, and `Response` APIs.
- **Isomorphic Cryptography**: If hashing or base64 decoding is needed, use standard Web APIs (`crypto.subtle` or isomorphic helpers) compatible with Hermes and Service Workers.

---

## 2. Moodle REST API Quirks & Error Handling

- **HTTP 200 False Positives**: Moodle's REST web services (`webservice/rest/server.php`) return an HTTP Status `200 OK` even when a request fails or credentials are invalid.
  - **Rule**: Every API response parser must check whether the response body contains an `exception` or `errorcode` property (e.g. `{"exception": "moodle_exception", "message": "..."}`).
  - When encountered, throw a strongly typed `MoodleApiError`.
- **Token Invalidation**: When `errorcode: "invalidtoken"` is encountered, immediately flag the session as expired and prompt the user to re-authenticate.

---

## 3. True Deadline Computation Formula

Assignments in Moodle may have multiple deadline fields: `duedate`, `cutoffdate`, and `extensionduedate`. All timestamps are stored in epoch seconds.

$$\text{True Deadline} = \begin{cases} 
\text{extensionduedate} & \text{if } \text{extensionduedate} > 0 \\
\text{duedate} & \text{else if } \text{duedate} > 0 \\
\text{cutoffdate} & \text{else if } \text{cutoffdate} > 0 \\
\text{null} & \text{otherwise}
\end{cases}$$

**Rules:**
- A value of `0` signifies that the field is unset.
- **`duedate` is the nominal official deadline**: It must never be superseded by a later `cutoffdate`.
- **Late submission grace periods (`cutoffdate > duedate`)**: When `cutoffdate` extends beyond `duedate`, Moodle permits late submissions (flagged as late). Noodle preserves `duedate` as the primary deadline and sets `cutoffDate` to indicate the grace period. The UI renders a dedicated clock icon (`ClockIcon`, NOT emoji) with tooltip `"Late assignment accepted til {date}"` / `"מטלות באיחור יתקבלו עד {date}"`.
- **Personal extensions**: If `extensionduedate > 0`, it takes absolute precedence over all other dates.
- Status Classification:
  - `Submitted`: Submission status is `submitted`.
  - `Not submitted`: Status is not `submitted` AND the True Deadline is in the past.
  - `Assigned`: Status is not `submitted` AND the True Deadline is in the future (or no deadline).

---

## 4. Strict Prohibition of Emojis / Minimalist Iconography Standard

- **Zero Emojis in UI**: Never use colorful unicode emojis in user-facing components, labels, lists, badges, tooltips, or file representations (e.g. 📕, 📦, 💻, 🖼️, 📄, 📁, ⏳, ✨, ⏱️, 📢, 🏆). Emojis look amateurish, AI-generated, and cluttered.
- **Minimalist Vector Icons Only**: When visual categorization is necessary, use subtle, monochrome/minimalist SVG vector icons (<FileIcon />, <FolderIcon />, <ClockIcon />, <DownloadIcon />, <EyeIcon />).
- **Never Overuse Icons**: Keep the interface clean, functional, and typography-first. Avoid excessive iconography beside every line of text. Subtle badges and clean text hierarchy are strictly preferred over decorative icons.
- **File Type Representations**: Render files with clean typography or a minimalist monochrome <FileIcon />, or uppercase file extension badge tags (PDF, ZIP, DOCX), rather than colorful file emojis.

---

## 5. Google Tasks Integration Logic

Google Tasks does not have custom key-value metadata fields.
- **Metadata Tagging**: Embed a structured identifier into the task's `notes` (description) field:
  ```text
  Noodle:assignId:{moodle_assign_id}
  ```
- **Matching**: Match tasks by scanning for this prefix in `notes`. Never match by task title, as users frequently rename their tasks.
- **User Overrides**: If a task is marked `completed` by the user in Google Tasks, **never** revert it back to `needsAction`, even if Moodle reports that the submission has not occurred.

---

## 6. Authentication, Cookies & Session Security

- **Cookies Permission**: The extension requests `"cookies"` permission in `manifest.json` to purge `moodle.tau.ac.il` and `nidp.tau.ac.il` session cookies (`MoodleSession`, `JSESSIONID`) on user logout, preventing SAML session poisoning across Chromium and Firefox.
- **Token Interception**: In the browser extension, intercept the token via `browser.webRequest.onBeforeRedirect` watching for redirects matching `moodlemobile://token=*`.
- **Credentials Mode**: Set `credentials: 'include'` on fetch requests to allow the browser to manage cookies natively.
- **SAML SSO Parsing**: The auto-submitting form at `nidp.tau.ac.il` contains hidden inputs (`SAMLRequest`, `RelayState`, etc.). Extract **all** hidden `<input>` values and pass them in the POST payload; omitting them will break SAML context propagation.
- **Session Purge & Server-Side Invalidation**:
  1. Wipe all local storage (`chrome.storage.local`, SQLite, SecureStore) except non-identifying preferences (e.g. theme).
  2. Perform server-side session invalidation by hitting `https://moodle.tau.ac.il/login/logout.php` and `https://nidp.tau.ac.il/nidp/app/logout`.
  3. **Always use cache-busting**: Append `?_t=${Date.now()}` and `{ cache: 'no-store' }` to prevent the browser from returning a cached 200 OK for logout calls.
  4. Perform pre-emptive logout before starting a fresh SSO login flow.
