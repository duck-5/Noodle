# Noodle Mobile & Tablet — Next Iteration Plan & Diagnostic Analysis

This document specifies the next wave of mobile and tablet improvements based on real-device testing on an Android tablet (analyzed from `tablet_logcat.txt`) and hands-on UX feedback across both tablet and phone form factors.

---

## 1. Forensic Analysis of `tablet_logcat.txt`

Inspection of the 75 MB real-device log (`tablet_logcat.txt`, session `11-21 20:48:17` – `20:52:18`, PID `25099`) revealed **five concrete runtime bugs**:

### 1.1 Why Panopto Recordings Failed to Sync on the Tablet (3 Compounding Root Causes)
In the logs (`20:49:13`, `20:49:32`, `20:50:54`, `20:51:42`, `20:52:17`), six tracked courses had a `block_panopto` block in Moodle (`321213001 - Methods of Theoretical Physics 1`, `321210501 - Analytical Mechanics`, `368220099 - Computational Models`, `321210299 - Waves`, `368215799 - Java Software 1`, `368215899 - Data Structures`), yet every single one logged:
```text
[Panopto][Tier 2 - Moodle WS] Course 321213001 blocks (1): panopto
[Panopto][Tier 2 - Moodle WS] Panopto block payload for course 321213001:
{"instanceid":3802,"title":"הקלטות הקורס באתר הוידאו Panopto","contentLen":1157,
 "contentPreview":"<div id=\"panopto_block_3802\"><div id=\"loading_text\">טוען תוכן מאתר הוידאו....</div></div><script type=\"text/javascript\">function panopto_launchNotes(url) {..."}
[SyncEngine][Panopto] Course "0321213001 - Methods of Theoretical Physics 1" (321213001): resolvedFolderId=none via none (deliveries=0, ltiRecs=0)
```
* **Root Cause A — `block_panopto` in TAU Moodle is lazy-loaded via AJAX (`/blocks/panopto/panopto_content.php`)**:
  `core_block_get_course_blocks` only returns the initial placeholder `<div id="panopto_block_{instanceid}"><div id="loading_text">טוען תוכן מאתר הוידאו....</div></div>`. When Moodle renders a course page, an inline script fetches the actual Panopto folder UUID and session links from `POST https://moodle.tau.ac.il/blocks/panopto/panopto_content.php` (passing `sesskey` and `courseid`). Because `discoverPanoptoFromMoodleBlocks()` ([panoptoScraper.ts](file:///d:/ProgramFiles/Projects/Noodle/packages/moodle-client/src/panoptoScraper.ts#L2405-L2537)) only inspects the static placeholder from `core_block_get_course_blocks` and never requests `/blocks/panopto/panopto_content.php`, Tier 2C extracts `0` folder IDs for all courses that rely on the Panopto sidebar block.
* **Root Cause B — `ensurePanoptoAuthenticated()` rejects active `.ASPXAUTH` sessions and aborts Tier 3 search**:
  Even after signing into Panopto in the WebView at `20:50:16`–`20:50:24` (`source: https://tau.cloud.panopto.eu/Panopto/Pages/Home.aspx`, Panopto v17.18.1), `ensurePanoptoAuthenticated()` ([panoptoScraper.ts](file:///d:/ProgramFiles/Projects/Noodle/packages/moodle-client/src/panoptoScraper.ts#L2200-L2262)) failed because:
  1. `/Panopto/Api/v1/users/me` is an OAuth2 REST API endpoint that does not authenticate standard browser `.ASPXAUTH` cookies (or returns 401/anonymous).
  2. When `/Api/v1/users/me` returns 200 with a different schema or sets `verifiedAnonymousViaApi = true`, the `Home.aspx` fallback is skipped; and even when `Home.aspx` is checked, the regex `/"isAuthenticated"\s*:\s*true/i` requires double quotes around `"isAuthenticated"`, whereas Panopto 17.18's inline JS object uses unquoted keys (`isAuthenticated: true`) or `Panopto.user.userId`.
  3. Because `ensurePanoptoAuthenticated()` returned `false`, [syncEngine.ts](file:///d:/ProgramFiles/Projects/Noodle/packages/moodle-client/src/syncEngine.ts#L1717-L1771) **completely skipped Tier 3 (`discoverCourseFolderFromBrowse`)** for all 6 courses.
* **Root Cause C — `/blocks/panopto/SSO.php` called without `course_id` and no automated WebView SSO handshake**:
  `ensurePanoptoAuthenticated()` calls `GET https://moodle.tau.ac.il/blocks/panopto/SSO.php` with no query parameters, which fails to bounce to Panopto unless a valid `course_id` or `url` parameter is supplied. Furthermore, unlike the desktop extension (which auto-clicks the TAU IDP login button and fills credentials in a background tab), the mobile app requires manual WebView interaction.

### 1.2 Nested SQLite Transaction Crash (`saveTrackedCourses error`)
Logged repeatedly at `20:48:23.934`, `20:49:05.646`, `20:50:27.560`, `20:51:14.986`, `20:51:48.126`, `20:51:49.975`:
```text
E ReactNativeJS: 'saveTrackedCourses error:', { [Error: Call to function 'NativeDatabase.execSync' has been rejected.
→ Caused by: cannot start a transaction within a transaction] code: 'ERR_INTERNAL_SQLITE_ERROR' }
```
* **Root Cause**: `writeSettingsToLocalStorage()` ([settingsSyncService.ts](file:///d:/ProgramFiles/Projects/Noodle/apps/mobile/src/services/settingsSyncService.ts#L397)) opens a `db.withTransactionSync(...)` block and calls `saveTrackedCourses(...)` ([settingsSyncService.ts](file:///d:/ProgramFiles/Projects/Noodle/apps/mobile/src/services/settingsSyncService.ts#L455)) inside it. However, `saveTrackedCourses()` ([database.ts](file:///d:/ProgramFiles/Projects/Noodle/apps/mobile/src/services/database.ts#L867)) **also** calls `db.withTransactionSync(...)`. SQLite does not allow nested `BEGIN TRANSACTION` statements, causing `saveTrackedCourses` to fail and throw on every settings sync or course update.

### 1.3 Android Notification Sound Error (`Custom sound 'default' not found`)
Logged after every sync (`20:48:20.938`, `20:49:14.442`, `20:49:32.976`, `20:50:55.553`, `20:51:44.028`, `20:52:18.283`):
```text
E ReactNativeJS: expo-notifications: Custom sound 'default' not found in native app. Make sure the sound file (e.g. 'custom_sound.wav') is included in the expo-notifications config plugin sounds array in app config.
```
* **Root Cause**: [notifications.ts](file:///d:/ProgramFiles/Projects/Noodle/apps/mobile/src/services/notifications.ts#L117) and [notifications.ts](file:///d:/ProgramFiles/Projects/Noodle/apps/mobile/src/services/notifications.ts#L132) pass `sound: 'default'` in `NotificationContentInput`. In Expo SDK 56 on Android, passing a string `'default'` instructs the native module to look up a custom raw resource `res/raw/default.wav`. Passing `sound: true` (or omitting `sound` on Android where the notification channel `'deadline-reminders'` controls sound) uses the OS default notification sound cleanly.

### 1.4 Startup `invalidtoken` & Silent Token Renewal Failure
Logged at `20:48:20.821` – `20:48:28.168`:
```text
E ReactNativeJS: '[Mobile Sync] Failed to sync settings:', { [MoodleApiError] errorcode: 'invalidtoken' }
W ReactNativeJS: '[loginTauSso] performLogin did not yield a valid token, trying SAML fallback:', [Error: Failed to extract Moodle mobile token from final redirect]
W ReactNativeJS: '[auth] Silent token renewal failed:', [Error: SSO_TOKEN_EXTRACTION_FAILED]
```
* **Root Cause**: When a stored `wstoken` expires, `performLogin` fails in React Native because `XMLHttpRequest` auto-follows redirects and cannot intercept the custom-scheme `303 -> moodlemobile://token=...` redirect, while the `managetoken.php` HTML scraper in `loginViaSamlAndManageToken` ([auth.ts](file:///d:/ProgramFiles/Projects/Noodle/apps/mobile/src/services/auth.ts#L260-L448)) fails to match Moodle 4.5's token table layout.

### 1.5 Circular Dependency (`Require cycle`) Warnings in `@tautracker/moodle-client`
Logged at `20:48:18.385` – `20:48:18.393`:
```text
W ReactNativeJS: Require cycle: ../../packages/moodle-client/dist/moodleApi.js -> ../../packages/moodle-client/dist/strategies/index.js -> ../../packages/moodle-client/dist/strategies/restStrategy.js -> ../../packages/moodle-client/dist/moodleApi.js
```
* **Root Cause**: `moodleApi.ts` imports `./strategies/index.js`, while `fallbackRunner.ts`, `restStrategy.ts`, `ajaxStrategy.ts`, and `scraperStrategy.ts` import `MoodleApiError` back from `../moodleApi.js`. Moving `MoodleApiError` into `packages/moodle-client/src/errors.ts` (and re-exporting it from `moodleApi.ts`) eliminates all four cycles.

---

## 2. Part A — Easy & Targeted Fixes (Quick Wins)

Each item below is localized to 1–2 files with low regression risk.

### E1. Fix Half-Colored "Manage Courses" & "Go to Course" Gradient Buttons
* **User Observation**: *"The Manage courses button color is half on it."*
* **Reasoning & Root Cause**: In [NoodleAnimations.tsx](file:///d:/ProgramFiles/Projects/Noodle/apps/mobile/src/components/ui/NoodleAnimations.tsx#L148-L189) (`styles.gradBtnOuter`, `gradBtnXs`, `gradBtnSm`, `gradBtnMd` at lines `454–486`), `paddingHorizontal` and `paddingVertical` along with `alignItems: 'center'` and `justifyContent: 'center'` are applied to the **outer** `<Pressable>` (`gradBtnOuter`), while the `<Svg style={StyleSheet.absoluteFill} width="100%" height="100%">` is rendered inside that padded flex box. On Android Fabric (`react-native-svg`), the SVG's `100%` box is offset by the parent's padding/centering alignment, leaving half of the button uncolored.
* **Planned Fix**:
  1. Remove all padding and centering (`alignItems`/`justifyContent`) from `gradBtnOuter` (`padding: 0, position: 'relative', overflow: 'hidden'`).
  2. Move `paddingHorizontal` / `paddingVertical` (`gradBtnXs`, `gradBtnSm`, `gradBtnMd`) onto the inner `<View style={[styles.gradBtnContent, sizeStyle, { flexDirection: rowDir }]}>`.
  3. Wrap the `<Svg>` in `<View pointerEvents="none" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}>` so the gradient always fills 100% of the button's border-box.

### E2. Tone Down the Closest-Task Perimeter Glow to Match the Extension
* **User Observation**: *"The animation on the next task is too bright and takes attention (not like the extension animation...)."*
* **Reasoning & Root Cause**: In the desktop extension ([App.css](file:///d:/ProgramFiles/Projects/Noodle/apps/extension/src/options/App.css#L3674-L3729)), `.closest-task-glow` is a subtle, slow (`4s`) `1.5px` light beam where **55% of the perimeter is completely transparent** (`transparent 0deg 200deg`) and the active arc softly fades in (`rgba(91, 72, 182, 0.35)`) and out (`rgba(212, 99, 55, 0.35)`). On mobile ([NoodleAnimations.tsx](file:///d:/ProgramFiles/Projects/Noodle/apps/mobile/src/components/ui/NoodleAnimations.tsx#L206-L313)), `ClosestTaskGlowWrap` renders a thick `strokeWidth={2}` full-opacity `#5b48b6 -> #a04977 -> #d46337` solid dash (`28%` of the perimeter) with sharp ends and `padding: 2`, creating a distracting neon marquee effect.
* **Planned Fix**:
  1. Reduce `strokeWidth` from `2` to `1.25`, lower the gradient stop opacities (`stopOpacity={0.15}` at ends, `0.55` at center peak), shorten the beam arc to `18%` of the perimeter, and slow the cycle duration from `3400ms` to `4500ms`.
  2. Overlay the `1.25px` SVG stroke directly along the card's existing border (`padding: 0`) with a very faint base border (`rgba(160, 73, 119, 0.14)`).

### E3. Move the Tablet Sidebar Collapse Button from Top-Left to Bottom-Left
* **User Observation**: *"Instead of the sidebar collapse button being on the top left, it should on the bottom left (since in the upper part the tablet/phone menu is)."*
* **Reasoning & Root Cause**: In [\_layout.tsx](file:///d:/ProgramFiles/Projects/Noodle/apps/mobile/src/app/(tabs)/_layout.tsx#L199-L240), `sidebar-toggle-btn` is placed in `sidebarHeader` at the top corner of the screen—directly colliding with Android's status bar, tablet multi-window three-dot handle, and top system gestures.
* **Planned Fix**:
  1. Keep `sidebarHeader` solely for the Noodle logo mark and `"Noodle"` brand title (centered when collapsed).
  2. Move `sidebar-toggle-btn` into `sidebarFooter` at the bottom of the sidebar ([_layout.tsx](file:///d:/ProgramFiles/Projects/Noodle/apps/mobile/src/app/(tabs)/_layout.tsx#L291-L347)), positioned cleanly above/alongside the footer actions with a label (`"Collapse"` / `"צמצם תפריט"`) when expanded and an icon-only button when collapsed.

### E4. Remove the Top-Right Tour Button from the Dashboard Header
* **User Observation**: *"Remove the tour button from the top right."*
* **Reasoning & Root Cause**: In [index.tsx](file:///d:/ProgramFiles/Projects/Noodle/apps/mobile/src/app/(tabs)/index.tsx#L770-L785), the Dashboard top-right header renders an extra `<TourIcon />` button next to Sync, crowding the header on smaller screens and duplicating the `"Take Tour"` action already available in Settings (and the tablet sidebar).
* **Planned Fix**: Remove the `<TourIcon />` `TouchableOpacity` from `headerActions` in [index.tsx](file:///d:/ProgramFiles/Projects/Noodle/apps/mobile/src/app/(tabs)/index.tsx#L770-L785).

### E5. Move "Manage Courses" Next to the "Cards / List" Switcher
* **User Observation**: *"The manage courses should be next to the 'Cards/List' thing (like it is in the extension)."*
* **Reasoning & Root Cause**: In [index.tsx](file:///d:/ProgramFiles/Projects/Noodle/apps/mobile/src/app/(tabs)/index.tsx#L761-L768), `dashboard-manage-courses-btn` was placed in the page's top greeting header next to `"Sync Now"`. In the extension ([App.tsx](file:///d:/ProgramFiles/Projects/Noodle/apps/extension/src/options/App.tsx#L5835-L5865)), the top header only has the greeting and Sync button, while `"Manage Courses"` sits in the **My Courses** section header right next to the `"Cards / List"` segmented toggle.
* **Planned Fix**:
  1. Remove `<NoodleGradientButton testID="dashboard-manage-courses-btn" />` from the top `headerActions` row ([index.tsx](file:///d:/ProgramFiles/Projects/Noodle/apps/mobile/src/app/(tabs)/index.tsx#L761-L768)), leaving only the `"Sync Now"` button in the top header.
  2. Place `<NoodleGradientButton testID="dashboard-manage-courses-btn" />` inside `coursesHeader` ([index.tsx](file:///d:/ProgramFiles/Projects/Noodle/apps/mobile/src/app/(tabs)/index.tsx#L1461-L1525)) grouped horizontally with the `"Cards / List"` segmented toggle (`flexDirection: rowDir, alignItems: 'center', gap: 8`).

### E6. Open Semester Progress Category Menu Only When Pressed (Dropdown / Popover)
* **User Observation**: *"The semester progress bar menu (what to choose from) should be opened only when I'm pressing on it."*
* **Reasoning & Root Cause**: Currently, the Semester Cumulative Progress card ([index.tsx](file:///d:/ProgramFiles/Projects/Noodle/apps/mobile/src/app/(tabs)/index.tsx#L1323-L1366)) permanently displays all 5 category buttons (`Lectures`, `Recitations`, `Assignments`, `Total`, `All`) in a wide horizontal bar that forces horizontal scrolling and visual clutter.
* **Planned Fix**:
  1. Replace the permanent 5-button strip with a single compact **Active Mode Selector Pill** (showing the current mode's icon, label, and a `<ChevronDownIcon />`, e.g., `Total ▾` / `סה"כ ▾`).
  2. Pressing the pill toggles an inline/anchored dropdown menu listing the 5 options (`Lectures`, `Recitations`, `Assignments`, `Total`, `All`) with their icons and a checkmark next to the active option.
  3. Selecting any option updates `semesterProgressMode` and immediately closes the menu.

### E7. Sync Progress Window: Open Only When Tapping Sync During an Active Sync, and Disappear Immediately When Done
* **User Observations**:
  * *"Since this is a small screen, we shouldn't open the sync progress window - but instead, allow it to be opened if the user is pressing on the sync button during a sync."*
  * *"After sync is done, the button thing should disappear."*
* **Reasoning & Root Cause**:
  1. In [use-app-state.tsx](file:///d:/ProgramFiles/Projects/Noodle/apps/mobile/src/hooks/use-app-state.tsx#L413-L465), calling `triggerSync({ manual: true })` immediately sets `syncWindowVisible = true`, popping up the floating 7-step window or mini pill over content every time the user taps `"Sync Now"` or pulls to refresh.
  2. In [SyncProgressBanner.tsx](file:///d:/ProgramFiles/Projects/Noodle/apps/mobile/src/components/SyncProgressBanner.tsx#L90-L120), when sync finishes, `showPostComplete` keeps the floating window/button visible for an extra 2.5 seconds (and if collapsed into the mini pill, the pill stays floating in the corner).
* **Planned Fix**:
  1. **Do not auto-open the floating window when starting a sync**: When the user taps `"Sync Now"` (or pulls to refresh) while `!isSyncing`, start the sync with `syncWindowVisible = false`—only the header Sync button spins (and displays live `%` or `"Syncing..."`).
  2. **Open on second tap during active sync**: If `isSyncing === true` and the user taps the header Sync button, toggle `syncWindowVisible` open (and expanded) so they can inspect the 7-step progress on demand.
  3. **Disappear immediately upon completion**: Remove the 2.5-second `showPostComplete` linger and remove the persistent collapsed mini-pill state once `isSyncing` becomes `false`—as soon as sync finishes, `syncWindowVisible` resets to `false` and the floating tray/pill disappears immediately.

### E8. Remove the "Share" Button from File Rows
* **User Observation**: *"Remove the 'share' button."*
* **Reasoning & Root Cause**: In [MoodleFileRow.tsx](file:///d:/ProgramFiles/Projects/Noodle/apps/mobile/src/components/MoodleFileRow.tsx#L140-L195) (used in `AssignmentDetailSheet`, `assignments.tsx`, and `course/[id].tsx`), every file row displays both a `Download` button and a `Share` button. On mobile, having both clutters narrow file rows and causes accidental taps.
* **Planned Fix**:
  1. Remove the `Share` (`<ShareIcon />`) button from `MoodleFileRow.tsx`, leaving a single clean `<DownloadIcon />` action button on the end side while tapping the file row itself opens the file in the native viewer (`onOpen`).
  2. Make `onShare` optional/deprecated in `MoodleFileRowProps`.

### E9. Replace the App Icon & Splash Icon with the Real Noodle Icon
* **User Observation**: *"The icon should be the Noodle icon, not something made up."*
* **Reasoning & Root Cause**: File size inspection showed that [android-icon-foreground.png](file:///d:/ProgramFiles/Projects/Noodle/apps/mobile/assets/images/android-icon-foreground.png) (`296,878` bytes) and [splash-icon.png](file:///d:/ProgramFiles/Projects/Noodle/apps/mobile/assets/images/splash-icon.png) (`296,878` bytes) are byte-for-byte copies of the default Expo template [expo-logo.png](file:///d:/ProgramFiles/Projects/Noodle/apps/mobile/assets/images/expo-logo.png) (`296,878` bytes), and all Android launcher icons under `apps/mobile/android/app/src/main/res/mipmap-*/ic_launcher*.webp` were generated from that placeholder instead of the actual Noodle logo ([logo.png](file:///d:/ProgramFiles/Projects/Noodle/apps/mobile/assets/logo.png) / [icon-128.png](file:///d:/ProgramFiles/Projects/Noodle/apps/extension/public/icon-128.png)).
* **Planned Fix**:
  1. Generate proper square/adaptive PNG & WebP launcher icons from `apps/mobile/assets/logo.png` (and `apps/extension/public/icon-128.png`) with warm cream background (`#FAF5EB`) and centered Noodle bowl foreground.
  2. Overwrite `apps/mobile/assets/images/{icon.png,android-icon-foreground.png,splash-icon.png,favicon.png}` and all `apps/mobile/android/app/src/main/res/mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher*.webp` files.
  3. Also display the Noodle logo mark in the mobile Dashboard greeting header (matching the tablet sidebar and extension brand identity).

### E10. Fix Nested SQLite Transaction Bug in `saveTrackedCourses`
* **Source**: `tablet_logcat.txt` (`ERR_INTERNAL_SQLITE_ERROR: cannot start a transaction within a transaction`).
* **Reasoning & Root Cause**: `writeSettingsToLocalStorage()` ([settingsSyncService.ts](file:///d:/ProgramFiles/Projects/Noodle/apps/mobile/src/services/settingsSyncService.ts#L397)) wraps all preference + course updates in `db.withTransactionSync(...)` and calls `saveTrackedCourses()` inside it, while `saveTrackedCourses()` ([database.ts](file:///d:/ProgramFiles/Projects/Noodle/apps/mobile/src/services/database.ts#L867)) starts a second `db.withTransactionSync(...)`.
* **Planned Fix**: Add a module-level `inTransactionDepth` counter (or a `runInTransaction(db, fn)` helper in `database.ts`) that executes `fn()` directly when already inside an active transaction instead of calling `db.withTransactionSync` recursively.

### E11. Fix Android Notification `Custom sound 'default' not found` & `moodle-client` Require Cycles
* **Source**: `tablet_logcat.txt` lines `76–87` and `92, 126, 149, 178, 203, 230`.
* **Planned Fix**:
  1. In [notifications.ts](file:///d:/ProgramFiles/Projects/Noodle/apps/mobile/src/services/notifications.ts#L117) and [notifications.ts](file:///d:/ProgramFiles/Projects/Noodle/apps/mobile/src/services/notifications.ts#L132), omit `sound: 'default'` on Android (or pass `sound: true`) so `expo-notifications` uses the channel's default system sound without searching for `res/raw/default.wav`.
  2. Extract `MoodleApiError` into `packages/moodle-client/src/errors.ts` and re-export it from `moodleApi.ts` so `restStrategy.ts`, `ajaxStrategy.ts`, `scraperStrategy.ts`, and `fallbackRunner.ts` do not form circular imports with `moodleApi.ts`.

---

## 3. Part B — Complex & Architectural Tasks

### C1. End-to-End Fix for Panopto Recordings Sync on Mobile & Tablet
* **User Observation & Logcat Proof**: *"Recordings still can't be synced."*
* **Why Previous Fixes Were Not Enough**:
  As proven by `tablet_logcat.txt`, TAU Moodle courses store Panopto links inside `block_panopto`, whose static content in `core_block_get_course_blocks` is just `<div id="loading_text">טוען תוכן מאתר הוידאו....</div>`. Furthermore, `ensurePanoptoAuthenticated()` failed to recognize active Panopto 17.18 sessions (causing Stage 3 to skip Tier 3 `Data.svc` search), and `/blocks/panopto/SSO.php` was called without a `course_id`.
* **Detailed Implementation Plan**:
  1. **Tier 2C Enhancement — Fetch `/blocks/panopto/panopto_content.php` AJAX Endpoint ([panoptoScraper.ts](file:///d:/ProgramFiles/Projects/Noodle/packages/moodle-client/src/panoptoScraper.ts#L2475-L2535))**:
     - Whenever `core_block_get_course_blocks` reports a `panopto` block for `courseId` whose static `contentHtml` contains `panopto_block_` / `loading_text` and yields 0 folder IDs:
     - Fetch `POST ${moodleBaseUrl}/blocks/panopto/panopto_content.php` (with `sesskey=${sesskey}&courseid=${courseId}` or `id=${courseId}`, using native Moodle session cookies / `jar`) and run `extractPanoptoFromCourseHtml(ajaxHtml)` to extract the exact `folderID` UUID and recording delivery links!
     - Also scrape `/course/view.php?id=${courseId}` HTML when a Moodle web session is active (`enableScraping: true` on mobile when web session cookies exist).
  2. **Fix `ensurePanoptoAuthenticated()` Session Detection for Panopto 17.18 ([panoptoScraper.ts](file:///d:/ProgramFiles/Projects/Noodle/packages/moodle-client/src/panoptoScraper.ts#L2200-L2262))**:
     - Instead of relying on `/Panopto/Api/v1/users/me` (which expects OAuth2 tokens) or quoted `"isAuthenticated":true`, verify the `.ASPXAUTH` cookie by:
       a. Calling `POST ${cleanPanopto}/Panopto/Services/Data.svc/GetSessions` with `{ queryParameters: { maxResults: 1, page: 0 } }` or inspecting `Home.aspx` for unquoted `isAuthenticated\s*:\s*true` / non-zero `Panopto\.user\.userId` / presence of `.ASPXAUTH` in `CookieManager.getCookie('https://tau.cloud.panopto.eu')`.
       b. Passing a real tracked `course_id` to `${cleanMoodle}/blocks/panopto/SSO.php?course_id=${firstTrackedCourseId}` during the Moodle→Panopto SSO chain.
       c. **Never aborting Tier 3 (`discoverCourseFolderFromBrowse`)** when the user has Panopto enabled—always attempt `discoverCourseFolderFromBrowse` if Tiers 1–2 did not yield a folder ID!
  3. **Automated Panopto SSO Login in `SsoWebViewModal` & Background WebView ([SsoWebViewModal.tsx](file:///d:/ProgramFiles/Projects/Noodle/apps/mobile/src/components/SsoWebViewModal.tsx))**:
     - Inject the same auto-login script used by the extension's `injectedPanoptoLoginStep` ([serviceWorker.ts](file:///d:/ProgramFiles/Projects/Noodle/apps/extension/src/background/serviceWorker.ts#L1480-L1545)): automatically click `#PageContentPlaceholder_loginControl_externalLoginButton` on `Panopto/Pages/Auth/Login.aspx`, auto-fill stored TAU credentials (`#Ecom_User_ID`, `#Ecom_User_Pid`, `#Ecom_Password`) if the user checked "Remember Me", and verify `.ASPXAUTH` via Android `CookieManager.getInstance().getCookie("https://tau.cloud.panopto.eu")` in `NoodleNativeModule.kt` (`hasPanoptoAuthCookie`).
     - Persist discovered `courseId -> folderId` mappings into `coursesPanoptoMap` in SQLite so subsequent syncs resolve immediately via Tier 1 in a single request.

### C2. Navigation Redesign: Focused Home Tab, Dedicated Courses Tab & Swipeable Tab Pager
* **User Observation**: *"Maybe we need a different approach - the main window will only be upcoming tasks, recordings, and semester progress. The next tab should be the courses, then all of the rest. Moving between them will be done with simple swiping. The reason is that this is very difficult to navigate in."*
* **Reasoning**:
  On phones and portrait screens, stacking Live Zoom + Upcoming Tasks + Catch-Up Recordings + Semester Progress + all Tracked Course Cards into a single screen creates a very long scroll page where courses are buried at the bottom, and tapping bottom-bar icons is slower than horizontal swiping.
* **Detailed Implementation Plan**:
  1. **Split Dashboard into Focused `Home` (`index.tsx`) + Dedicated `Courses` Tab (`courses.tsx`)**:
     - **Tab 1 — `Home` (`ראשי`, `(tabs)/index.tsx`)**: Renders **only**:
       1. Greeting header + `"Sync Now"` button (no Tour button, no Manage Courses button).
       2. Active Live Zoom Strip (only when a session is live/upcoming in `[-15m, +120m]`).
       3. **Upcoming To-Do Queue** (with inline Master–Detail split on landscape tablets and bottom-sheet modal on phones/portrait tablets).
       4. **Catch-Up Recordings Queue** (when Panopto is enabled).
       5. **Semester Cumulative Progress Card** (with the compact press-to-open category dropdown menu from E6).
     - **Tab 2 — `Courses` (`קורסים`, `(tabs)/courses.tsx`)**: A dedicated second tab right after Home containing:
       1. Section header with `"My Courses"` title, `"Cards / List"` segmented toggle, and the `"Manage Courses"` gradient button side by side (from E5).
       2. The 2-column paired Course Cards grid (3 columns on wide landscape tablets) and List view, plus `ManageCoursesModal`.
     - **Full Tab Order**: `Home` (`index`) → `Courses` (`courses`) → `Assignments` (`assignments`) → `Recordings` (`recordings`) → `Grades` (`grades`) → `Settings` (`settings`).
  2. **Horizontal Swipe Navigation Between Tabs**:
     - Implement a gesture-driven horizontal swipe pager wrapper (using `PanResponder` / `react-native-gesture-handler` horizontal pan or a paged container in `(tabs)/_layout.tsx`) across the top-level tabs so swiping left/right transitions smoothly to the next/previous tab (automatically inverted in Hebrew RTL mode so swiping left moves forward in RTL tab order).
     - Ensure horizontal scrollables inside tabs (like filter chip strips or calendar week grids) claim responder priority so swiping on a chip strip scrolls the strip without accidentally switching tabs.

### C3. Native File Explorer ("Save As" / System File Picker) When Downloading Files
* **User Observation**: *"When downloading a file, I'd like to see a file explorer or something, like the one usually opened when I'm downloading something."*
* **Reasoning & Root Cause**:
  Previously, `saveToMediaStoreDownloadsNative` silently wrote files into `Downloads/Noodle/` in the background and showed a text alert. On Android, users expect the native system file explorer dialog (`Intent.ACTION_CREATE_DOCUMENT`) where they can see their device's directory tree (`Downloads`, `Documents`, SD card, Drive), inspect/rename the file, and pick the exact destination folder—just like Chrome or standard Android apps when downloading a file.
* **Detailed Implementation Plan**:
  1. **Add `saveFileWithSystemExplorer(sourcePath: String, fileName: String, mimeType: String, promise: Promise)` to `NoodleNativeModule.kt`**:
     - Launch Android's system document creator intent:
       ```kotlin
       val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
         addCategory(Intent.CATEGORY_OPENABLE)
         type = mimeType.ifBlank { "*/*" }
         putExtra(Intent.EXTRA_TITLE, fileName)
       }
       ```
     - Register an `ActivityEventListener` (`BaseActivityEventListener`) on `reactApplicationContext` in `NoodleNativeModule.kt`.
     - When the user picks the destination in Android's native File Explorer and taps **Save**, `onActivityResult` receives the target `content://` URI, streams `sourcePath` into `contentResolver.openOutputStream(uri)` via a 64 KB buffer on a background executor, and resolves `{ saved: true, uri: uri.toString(), cancelled: false }`.
     - If the user presses Back/Cancel in the system File Explorer (`RESULT_CANCELED`), resolve `{ saved: false, cancelled: true }` cleanly without any error alert or Share Sheet fallback.
  2. **Wire `downloadMoodleFile` & `downloadMoodleFolderZip` ([fileDownloadService.ts](file:///d:/ProgramFiles/Projects/Noodle/apps/mobile/src/services/fileDownloadService.ts))**:
     - After downloading/caching the Moodle file or building the folder `.zip` in `Paths.cache`, invoke `saveFileWithSystemExplorerNative(localUri, displayName, resolvedMime)` so the Android system File Explorer opens immediately for every download.

### C4. Pastel Default Course Color Swatches + Full Interactive Color Palette Picker
* **User Observation**: *"I want to have a better color selection - the default options should be more pastel colors, and there should be an option for choosing from pallet."*
* **Reasoning & Root Cause**:
  `COURSE_COLOR_PALETTE` ([theme.ts](file:///d:/ProgramFiles/Projects/Noodle/apps/mobile/src/constants/theme.ts#L79-L93)) currently uses 14 harsh, highly saturated primary colors (`#ef4444`, `#3b82f6`, `#ea580c`) and offers no way to pick a custom color outside those 14 dots (unlike the extension's `<input type="color">` picker).
* **Detailed Implementation Plan**:
  1. **Curated 14-Color Pastel Academic Palette (`COURSE_COLOR_PALETTE` in `theme.ts`)**:
     - Replace the saturated hex codes with softer, harmonious pastel tones that maintain clear visual distinction and readability across both light (`noodle`/`light`) and dark (`coffee`/`dark`) themes:
       - Pastel Coral (`#E58C7A`), Peach Apricot (`#E8A574`), Warm Amber (`#E2B86B`), Sage Mint (`#7DB899`), Eucalyptus (`#6BB0A8`), Sky Blue (`#74AEE3`), Periwinkle (`#8296E0`), Soft Lavender (`#9D8BE3`), Mauve Orchid (`#BE89D6`), Dusty Rose (`#DF86AC`), Terracotta (`#C9846B`), Pistachio (`#96BF78`), Slate Blue (`#7E9BB5`), Warm Taupe (`#A69382`).
  2. **Interactive Color Palette Picker Modal (`src/components/ColorPalettePickerModal.tsx`)**:
     - At the end of the horizontal color swatch row in `ManageCoursesModal.tsx` and `onboarding.tsx`, add a **`+` / `<PaletteIcon />` Custom Color button**.
     - Tapping it opens `ColorPalettePickerModal` featuring:
       - A **2D Saturation/Brightness SVG gradient canvas** + **360° Hue slider bar** (pure React Native + `react-native-svg` + `PanResponder`, zero extra dependencies).
       - A **fine-grained 36-tile extended pastel & vibrant spectrum grid** for 1-tap selection.
       - A live **Course Card Preview** + editable `#RRGGBB` hex code input.

### C5. Reliable Silent Token Renewal When Moodle `wstoken` Expires
* **Source**: `tablet_logcat.txt` lines `88–101` (`invalidtoken` on startup followed by `SSO_TOKEN_EXTRACTION_FAILED`).
* **Reasoning & Root Cause**:
  In React Native, `XMLHttpRequest` auto-follows HTTP redirects and cannot intercept the `303 -> moodlemobile://token=...` redirect from `/admin/tool/mobile/launch.php`, while `loginViaSamlAndManageToken` failed to parse the token from Moodle's HTML.
* **Detailed Implementation Plan**:
  1. Add a native redirect-intercepting HTTP helper `fetchMoodleMobileTokenViaLaunch` (or headless WebView token extractor / OkHttp `followRedirects(false)` method in `NoodleNativeModule.kt`) that follows `/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=...` hop-by-hop with `followRedirects = false` until it sees `Location: moodlemobile://token=...`, returning the exact token without resetting other devices' tokens.
  2. If credentials are not saved ("Remember Me" was off) and `invalidtoken` occurs, surface a clear one-tap `"Session Expired — Reconnect"` banner that opens `SsoWebViewModal` instead of silently failing sync.

---

## 4. Summary & Recommended Implementation Order

| Priority | ID | Task | Category | Primary Files |
| :--- | :--- | :--- | :--- | :--- |
| **1** | **E10, E11** | Fix nested SQLite transaction crash (`saveTrackedCourses`), notification `'default'` sound error & require cycles | Easy Fix | `database.ts`, `notifications.ts`, `moodle-client/src/errors.ts` |
| **2** | **E1–E9** | Fix half-colored gradient buttons, tone down closest-task glow, move sidebar collapse to bottom-left, remove top-right Tour button, move Manage Courses next to Cards/List, press-to-open Semester Progress menu, open Sync window only on tap-while-syncing & auto-hide on completion, remove Share button, apply official Noodle app icons | Easy Fixes | `NoodleAnimations.tsx`, `_layout.tsx`, `index.tsx`, `SyncProgressBanner.tsx`, `MoodleFileRow.tsx`, `assets/**`, `res/mipmap-*/**` |
| **3** | **C1** | Fix Panopto recordings sync (`/blocks/panopto/panopto_content.php` AJAX discovery, Panopto 17.18 session verification, un-gated Tier 3 fallback, automated WebView SSO + native `.ASPXAUTH` cookie check) | Complex Task | `panoptoScraper.ts`, `syncEngine.ts`, `SsoWebViewModal.tsx`, `NoodleNativeModule.kt` |
| **4** | **C3** | Native Android File Explorer download flow (`Intent.ACTION_CREATE_DOCUMENT` in `NoodleNativeModule.kt`) | Complex Task | `NoodleNativeModule.kt`, `nativeBridge.ts`, `fileDownloadService.ts` |
| **5** | **C4** | Pastel default course color palette + interactive `ColorPalettePickerModal` | Complex Task | `theme.ts`, `ColorPalettePickerModal.tsx`, `ManageCoursesModal.tsx`, `onboarding.tsx` |
| **6** | **C2** | Split Home (Tasks, Recordings, Progress) & dedicated Courses tab + horizontal swipe navigation across tabs | Complex Task | `(tabs)/_layout.tsx`, `(tabs)/index.tsx`, `(tabs)/courses.tsx` |
| **7** | **C5** | Native OkHttp non-redirecting `moodlemobile://` silent token renewal & expired-session reconnect prompt | Complex Task | `NoodleNativeModule.kt`, `auth.ts`, `use-app-state.tsx` |
