# Noodle — Cross-Platform UI Design Specification

This specification documents every UI screen, component, configuration setting, and state transition required for the Noodle user experience. It serves as a unified reference to ensure layout, behavior, and styling parity between the Chrome Extension options page and the React Native mobile app.

---

## 1. Onboarding & Authentication Views

### A. Step 1: Moodle Login Screen
The entry point for unauthorized users. It captures Moodle credentials and initiates the SSO redirect handshake.

*   **Header Section**:
    *   **Noodle Logo**: Responsive brand mark centered at the top. Max-width `1080px` in CSS (scales to fill available container bounds).
    *   **App Name**: `<h1>Noodle</h1>` using the accent gradient typography.
    *   **Description**: Localized text prompting credentials input.
    *   **Language Selector**: Dropdown menu at the top corner (RTL/LTR toggling). Swaps the translation locale and structural direction of the page layout.
*   **SSO Login Form**:
    *   **Username Field**: Text input.
    *   **Israeli National ID Field**: Text input (requires ID format validation).
    *   **Password Field**: Secure password input (toggable visibility recommended).
    *   **Remember Me Checkbox**: Toggle to save credentials in local secure storage.
    *   **Submit Button**: Primary action button labeled "Connect to Moodle".
        - *Active State*: Triggers SSO token capture.
        - *Loading State*: Text changes to "Connecting..." with a spinner; input fields are disabled.
*   **Status Indicators**:
    *   **Toast Notifications**: Bottom-floating toast alerts for error responses (e.g. "Invalid credentials", "Connection timeout").

### B. Step 2: Course Selection Screen
Presented immediately after successful authentication or when manually triggered from course settings.

*   **Header Section**:
    *   **Title**: "Select Courses to Track".
    *   **Subtitle**: Description informing users that only selected courses will populate their dashboard and Google Tasks.
*   **Course List Layout**:
    *   **Grouped Semester Headers**: Section separators displaying academic terms (e.g. "Semester A - 2025", "Semester B - 2025", "Summer - 2025").
    *   **Course Card**: Clickable layout card for each course:
        - **Checkbox**: Check indicator aligning with selection state.
        - **Course Code**: Academic reference code (e.g., `0368-1118`).
        - **Course Full Name**: Official title from Moodle.
        - **Press/Click Behavior**: Toggles selection state. Selected cards change background border color to the primary theme color.
        - **Laboratory Course Prompt**: Selecting a course containing `"מעבדה"` in its name detects the laboratory keyword and presents a confirmation prompt offering to automatically hide all of its assignments to prevent clutter from extensive catalogs of optional or unassigned lab experiments (while allowing manual unhiding later).
*   **Footer Action Bar**:
    *   **Start Tracking Button**: Prominent primary button displaying: "Start Tracking (X Courses)" where X is the count of selected courses. Disabled if X = 0.
    *   **Import Configuration Button**: Secondary button/file picker icon to restore profile configurations from a JSON backup.

---

## 2. Navigation Layout & Shell

### A. Navigation Sidebar (Desktop Options Page)
*   **Header**: Scaled Noodle Logo (`108px` expanded, transitions to `54px` when collapsed) and "Noodle" application title (`1.45rem` bold font).
*   **Extension Bar Action Icon**: High-contrast, full-bleed icons (`16px`, `32px`, `48px`, `128px`) generated with 95–100% canvas height coverage so the noodle bowl is prominent, sharp, and bold on browser toolbars.
*   **Navigation Menu Items**:
    - **Dashboard** (`dashboard`): Central overview cockpit (Hero Action Strip, Multi-Active Zoom, Semester Progress, My Tracked Courses).
    - **Assignments** (`assignments`): Dedicated full-page assignments feed with search, status filters, course filter banner, and expandable cards.
    - **Grades** (`grades`): Course grades breakdown, averages, and overall GPA tracker.
    - **Settings** (`settings`): Configuration settings, theme selector, mock course generator, scraping fallback toggle, Google Tasks, and backup.
    - **About** (`about`): Credits, application details, and interactive tour launcher.
*   **Sidebar Collapse Toggle**:
    - Flat button at the bottom of the sidebar with an arrow icon.
    - Clicking toggles width state (`240px` expanded vs `72px` collapsed).
    - (Mobile only) Clicking anywhere not on the sidebar collapses it
    - *Collapsed state styling*: Hides text labels, scales the logo to `44px` circular bounds, and formats navigation items as centered square buttons.
*   **Footer**:
    - **Disconnect Button**: Exit door with arrow vector icon (`ExitIcon`) that triggers log out.
    - (Mobile only) The disconnect logo will appear only when the sidebar is expended

### B. Resizable Dashboard Container & Edge Dividers
* **Default Width**: `1200px` centered within the main viewport for optimal reading density.
* **Edge Drag Handles**:
  - Subtle, symmetrical vertical dividers (`.content-resize-handle`) along the outer left and right edges.
  - Hovering or dragging reveals an accent line (`var(--primary)`) and a floating frosted-glass pill (`.resize-handle-pill`) showing live pixel width (e.g., `⋮ 1200px`) and guidance tooltip.
  - Symmetrical resizing calculates distance from the viewport center line (`Math.abs(e.clientX - centerX) * 2`), working seamlessly in both LTR and RTL directions.
  - Double-clicking either handle instantly resets the container width back to `1200px`.
  - Automatically persists the chosen width in `localStorage` (`noodle_dashboard_max_width`).
* **Settings Control**: Companion range slider and 1-click "Reset to 1200px" button in the Settings tab under Appearance.

---

## 3. Dashboard Tab (v4 Home View)

* **Header Strip & Subtle Sync Progress Window (`.sync-progress-window`)**:
  - Minimalist SVG sync icon with smooth spinning animation during synchronization (`.spinning-sync-icon`) across both Dashboard and Extension Toolbar Popup (`Popup.tsx`), strictly adhering to zero-emoji design guidelines.
  - Clicking the "Sync now" button (`.header-sync-btn`) triggers synchronization and toggles a subtle, non-overlapping floating progress tray (`.sync-progress-window`) docked in the bottom corner (`bottom: 1.5rem; inset-inline-end: 1.5rem; width: 248px;`).
  - Because it is docked in the bottom viewport corner with a compact width of 248px, it never overlaps the header, search bars, assignment filters, or dashboard cards.
  - Conforms natively to active theme styling:
    * **Noodle Theme**: Warm cream translucent glass (`rgba(253, 246, 240, 0.96)`), warm terracotta borders (`rgba(194, 112, 68, 0.22)`), and dark text.
    * **Coffee Theme**: Deep espresso translucent glass (`rgba(29, 23, 19, 0.96)`), amber caramel borders (`rgba(217, 160, 102, 0.24)`), and caramel accents.
    * **Dark Theme**: Dark slate translucent glass (`rgba(24, 25, 36, 0.95)`), subtle white borders (`rgba(255, 255, 255, 0.1)`), and indigo accents.
  - The window presents discrete, step-by-step progress tracking:
    1. **User Information & Authentication** (`sync_task_init`)
    2. **Enrolled Courses & Academic Routing** (`sync_task_mapping`)
    3. **Assignments & Quizzes Global Manifest** (`sync_task_global_fetch`)
    4. **Course Contents, Files & Media** (`sync_task_courses`) with live scanned counter (`X / Y courses scanned`)
    5. **Activity Submissions & Attempt Statuses** (`sync_task_activities`) with live verified counter (`X / Y activities checked`)
    6. **Panopto Recordings** (`sync_task_panopto`, conditionally rendered when Panopto integration is enabled) with live recording counter (`X / Y courses scanned`)
    7. **Finalizing, Late-Box Heuristics & Cache** (`sync_task_finalizing`)
  - Each task displays a state badge: pending neutral dot (`.sync-task-dot`), active spinning indicator (`.sync-task-badge.active`), completed green checkmark (`.sync-task-badge.done`), or error badge (`.sync-task-badge.failed`).
  - Window footer displays live stage message and overall completion percentage.
  - Automatically auto-closes 2.5 seconds after successful completion.
  - **Anti-Jitter Stage Boundaries**: Sync results are emitted atomically at complete stage boundaries (Level 1: Course Contents Complete, Level 2: Activities & Submissions Complete, Level 3: Panopto Complete) rather than per-item. This eliminates page jitter, layout shifts, jumping assignment cards, and progress bar thrashing.
  - **Silent Background Synchronization**: Automatic periodic syncs (triggered via alarms or extension startup) execute in the background with only the spinning sync icon animating on the header button (`.spinning-sync-icon`), keeping the `.sync-progress-window` closed unless explicitly opened by a manual user click (`handleManualSync`).
  - Header subtitle cleanly displays the "Last synced: ..." timestamp without a countdown timer. Theme controls are centralized in Settings for a clutter-free header.

### A. Hero Action Strip
The top of the dashboard features a focused action strip designed for rapid orientation and zero-anxiety productivity:
1. **Upcoming To-Do Queue ("תור משימות קרובות")**:
   - Primary card listing imminent tasks with smooth internal scrollbar.
   - **Closest Task Flowing Edge Glow**: The single nearest pending deadline features an animated, smoothly flowing border light beam (`.closest-task-glow` / `@keyframes flow-glow-beam`) with a purple-to-orange gradient traveling continuously around the card perimeter using a masked `conic-gradient` and dual drop-shadow glow. Tasks remain collapsed by default for maximum density and clutter-free scanning.
   - **Exclusion & Sorting Filters**: Automatically excludes completed tasks (both Moodle-submitted and manually marked done) as well as hidden assignments.
   - Tasks are partitioned: future-dated tasks $\rightarrow$ tasks without deadlines $\rightarrow$ overdue tasks. Tasks without a deadline are explicitly included in the queue with stable deterministic ordering.
   - **Late Submission Grace Period Clock Indicator**: If an assignment has an extended cutoff date (`hasGracePeriod(assignment) === true`), a delicate vector SVG clock icon (`.grace-period-clock-icon`) is rendered alongside the due date. Hovering reveals a localized tooltip: `"מטלות באיחור יתקבלו עד {date}"` / `"Late assignment accepted til {date}"`. (No emojis used).
   - Each item is an interactive card with a quick checkmark button to mark complete, due badge, and expand drawer (`.queue-drawer`) containing:
     - Assignment prompt attachments with squircle open and arrow-only download buttons.
     - Course Subject Files (`קבצי הנושא`) matching the task's course and topic section with squircle open and arrow-only download buttons.
     - Submitted files chips when coursework was previously submitted.
     - Action toolbar: "עבור לקורס" (`go_to_course`), "סמן כבוצע / כלא הושלם" (`mark_done`), "הסתר / בטל הסתרה" (`hide_assignment`), and prominent "הגש במודל ↗" (`submit_assignment`).
2. **Catch-Up Recordings Queue ("השלמת שיעורים")**: When Panopto integration is active, renders alongside the upcoming tasks queue in a balanced 2-column grid with synchronized height and scrollable unwatched lecture/recitation queue.

### B. Live Session & Progress Bar
* **Multi-Zoom Active Strip**: When one or more courses have live sessions running (`● פעיל כעת`), a prominent live meeting strip appears directly beneath the hero strip, strictly filtering out hidden or uninterested meetings.
* **Semester Progress**: Visual progress bar tracking overall completion percentage across all assignments in tracked courses (`X/Y (Z%)`).

### C. My Tracked Courses ("הקורסים שלי")
* **Deterministic Course Order**: Predictable, clean list of tracked courses.
* **View Options Toggle**: Segmented switcher ("רשימה" / "List" vs "כרטיסים" / "Cards") allows toggling between a vertical rows list and a responsive card grid (`.courses-cards-grid`), persisted in local storage.
* **Manage Courses Modal Trigger**: A signature purple-orange gradient action button (`.manage-courses-trigger-btn`) featuring a clean `<BookOpenIcon size={13} />` opens a centered frosted-glass modal partitioned into semester groups, with course code/full name, display nickname text inputs, native color pickers, and tracking checkboxes.
* **Dual View Modes (List & Cards)**:
   - **List Mode**: Single horizontal flex row with course info, breakdown statistics, progress bar, next task, and 1-click navigation buttons ("Assignments", "Go to Course").
   - **Cards Mode**: Clean 3-row layout partitioned into maximum 3 cards per row (`repeat(3, minmax(0, 1fr))` on desktop, adapting to 2 and 1 on narrower viewports):
     - **1st Row**: Course display title + real title/code with color indicator on the start side (clicking anywhere on the card smoothly navigates to the course).
     - **2nd Row**: Next task preview with due date (`.course-card-next-task`) and secondary "Assignments" button (`.course-card-assignments-btn`).
     - **3rd Row**: Stat breakdown pills for assignments, lectures, and recitations (`.course-card-gaps` displaying numeric counts without "gaps" text labels), and an integrated overall course progress bar with percentage (`.course-card-progress-box`).
* **Direct Navigation**: Course cards and list rows are clean, focused overview cards with no clutter or collapse/expand accordion. Clicking anywhere on a card smoothly navigates directly to the comprehensive course detail page.

---

## 4. Dedicated Assignments Tab ("מטלות")

A dedicated full-page assignment feed providing comprehensive management of all academic tasks:
* **Filter Bar**:
  - **Full Text Search**: Immediate debounced filter by assignment or course name.
  - **Filter Checkboxes**: Real-time filters for Pending ("לביצוע"), Past ("עברו"), Completed ("הושלמו"), and Hidden ("מוסתרים").
  - **Calendar View Toggle Button (`📅 תצוגת לוח שנה` / `📅 Calendar View`)**: Toggles an interactive split-pane monthly calendar alongside the assignments list.
* **Split-Pane Calendar View (`.assignments-workspace.calendar-open`)**:
  - Shrinking the width of the assignments feed (`grid-template-columns: minmax(340px, 1.05fr) minmax(420px, 0.95fr)`), a sticky monthly calendar pane appears on the side.
  - Displays month navigation (`◀`, `היום` / `Today`, `▶`) and color-coded assignment pills on their due dates.
  - When an assignment has a late submission grace period, the calendar pill features an inline `.calendar-pill-clock` vector SVG icon and extends the pill tooltip to include: ` · [Late assignment accepted til {date} / מטלות באיחור יתקבלו עד {date}]`.
  - Clicking any assignment pill in the calendar automatically enables its status filter if currently unchecked, expands that assignment card in the feed, and smoothly scrolls it into view.
* **Course Filter Banner**:
  - Appears when navigating from a course row's "מטלות" button: `מסנן לפי קורס: [Course Name]`.
  - Includes an inline "הצג את כל הקורסים ✕" button to easily clear the filter and return to the complete assignments feed.
* **Compact / Minimized Cards**:
  - Collapsed by default to maximize visible density.
  - Shows course dot, course display name, task title, manual completion tag ("סומן כהושלם") or submission tag ("הוגש"), proximity deadline badge, grace period vector SVG clock indicator (`.grace-period-clock-icon` with `"Late assignment accepted til {date}"` / `"מטלות באיחור יתקבלו עד {date}"` tooltip), direct Moodle submission link, and expansion chevron.
* **Smooth Accordion Drawer & Vertical File Columns**:
  - All file lists across the application (Hero Spotlight, Upcoming To-Do Queue, Tracked Course Rows, Assignments Feed, and Course Detail View) are ordered in a clean vertical column (`.files-column-group` / `.files-column-list` / `.file-column-item`).
  - **Subject Files ("קבצי הנושא")**: Section files matching the assignment's course ID and topic section, stacked vertically in a column with green "פתח ↗" link and SVG "הורדה ↓" button.
  - **Attachments**: Assignment prompt/instruction files stacked vertically in a column with green "פתח ↗" and SVG "הורדה ↓" buttons.
  - **Submitted Files**: Files uploaded by the student stacked vertically in a column with checkmark indicator and green "פתח ↗" / SVG "הורדה ↓" buttons.
  - **Subject / Topic Text**: Unframed metadata text (`נושא: ...`) avoiding button-like framing.
  - **Action Toolbar**: Compact `.btn-xs` buttons ("עבור לקורס", "סמן כבוצע / לביצוע", "הסתר / בטל הסתרה", and secondary styled "פתח במודל ↗").

---

## 5. Course Detail View

### A. Tracked Courses Catalog
*   Grid of cards representing active courses.
*   **Course Overview Card**:
    - Top banner colored with the custom course color.
    - Course nickname and code.
    - Progress Bar: Completed assignments out of total (e.g. `3/4 Completed`).
    - Click behavior: Navigates to the Course Detail View.
*   **Manage Courses Button**: FAB or bottom button that re-opens the Step 2 selection menu.

### B. Course Detail View
*   **Header & Direct Moodle Link**:
    - Includes a direct **"פתח במודל ↗" / "Open in Moodle ↗"** (`data-moodle-link="true"`) button in `.detail-header` to open the course's Moodle page directly (displaying a `"מתחבר למודל..."` / `"Signing in to Moodle..."` status indicator while SSO session verification runs).
*   **Personalization Editor**:
    - **Nickname Field**: Real-time editable text input. Saving changes re-labels the course everywhere.
    - **Color Palette Picker**: A grid of selectable colored circles (min. 8 options). Selecting a circle updates the course's primary accent color.
*   **Layout Containment & Responsiveness**:
    - `.detail-grid` utilizes `grid-template-columns: minmax(0, 1.8fr) minmax(0, 1fr)` ensuring sidebars and content never slide out of frame or cause horizontal viewport scrolling.
    - Responsive single-column breakpoint at `960px` with `overflow-wrap: anywhere` for long titles and file names.
*   **Course-Level Assignment Actions**:
    - **Hide All Assignments Button**: "הסתר את כל המטלות" / "בטל הסתרת הכל" button to bulk-hide or unhide all assignments in this course.
*   **Course Resources Tabs**:
    1.  **Assignments**: List of assignments specific to this course with compact `.btn-xs` action buttons, unframed subject metadata text, dynamic threshold due date coloring (`.assign-deadline.due-green`, `.due-yellow`, `.due-red`, `.due-muted`) reflecting user urgency rules, "סומן כהושלם" status tags for manual completions, and expanded drawers displaying topic/subject files (`קבצי הנושא`), attachments, and submitted files.
    2.  **Lectures & Zoom**: Live session schedule containing:
        - Active live meeting highlights.
        - Section header equipped with vector `<VideoIcon size={16} />` (zero unicode emojis).
        - Modern action buttons (`.secondary-btn.btn-xs`) with `<EyeIcon size={12} />` and `<EyeOffIcon size={12} />` vector icons for bulk "Show all" / "Hide all" visibility management, matching the application's secondary button design language.
        - Strict joinable meeting validation (`isZoomJoinUrl`) ensuring that only actual joinable sessions with valid meeting IDs or vanity rooms are displayed, rejecting generic portal or LTI links.
        - Zoom link button, meeting ID & passcode text fields with quick copy buttons.
    3.  **Files & Panopto Recordings (Course Card + Course Sections)**: Folder structure organizing PDF/PPT course documents and Panopto video recordings by Moodle topic section:
        - **Course-Level Panopto Recordings Card (`.panopto-section-card`)**: Always rendered right below the Zoom card in `CourseDetailView` when `panoptoEnabled: true`. Displays the watched progress counter (`🎬 הקלטות פנופטו (X/Y נצפו)`), a direct `"פתח את Panopto ↗"` / `"Open Panopto ↗"` button, an inline Panopto Folder URL / UUID override input with `"שמור וסנכרן"` / `"Save & Sync"` (guarded by the `showPanoptoFolderOverride` toggle, default off), any Panopto sync diagnostic warnings, and the full list of recordings for the course.
        - **Course Files**: Each file item is equipped with a green squircle "פתח ↗" direct open button (`border-radius: 8px`) and a squircle arrow-only SVG "הורדה" button (`<DownloadIcon size={12} />`) with the HTML `download` attribute.
        - **Panopto Recordings (Inside Course Sections)**: When Panopto tracking is enabled (`panoptoEnabled: true`), matched lecture and recitation recordings are also rendered inside each topic section (with unmatched recordings grouped under a `'הקלטות פנופטו'` / `'Panopto Recordings'` section). Each recording item displays:
          - **Watched / Unwatched Toggle (`watchedRecordings`)**: Interactive checkmark button (`נצפה ✓` when watched, `סמן כנצפה` when unwatched) that dims watched recordings (`opacity: 0.68`) and persists state in `ExtensionSettings.watchedRecordings`.
          - **Recording Title & Metadata Badges**: Color-coded type badge (`🎬 הרצאה` / `Lecture` in indigo, `📐 תרגול` / `Recitation` in green), section tag, and localized recording date (`YYYY-MM-DD`).
          - **Direct Watch Action**: Squircle `"צפה בהקלטה ↗"` / `"Watch ↗"` link opening the Panopto viewer (`Viewer.aspx?id={deliveryId}`) in a new tab.

---

## 5. Files Tab (Central Repository)

*   **Search File Field**: Filters file names.
*   **Course Filter Dropdown**: Option to view files from a single course or all courses.
*   **Grouped Files View**:
    - Organized in folder structures mapping to weeks (e.g. "Week 1", "Week 2").
    - **File Item Card**:
        - **File Format Icon**: PDF, slide (PPTX), document (DOCX), or archive (ZIP).
        - **File Name**: Localized filename.
        - **Course Name**: Small indicator showing course origin.
        - **Download/Open Action**: Click to open. On mobile, downloads to local storage and raises the OS share dialogue.

---

## 6. Settings Tab

The Settings tab is organized in a clear, prioritized hierarchy ensuring quick access to appearance, thresholds, course tracking, and configuration backups:

### A. Appearance & Personalization
*   **Language Selection**: Toggle between `עברית` (Hebrew) and `English` (English).
*   **Theme Selection**:
    - Centralized dropdown supporting:
        - `Noodle Theme` (`noodle`): Warm paper terracotta aesthetic.
        - `Coffee Theme` (`coffee`): Refined dark espresso roast with golden crema accents and high-contrast status colors.
        - `Dark Mode` (`dark`): Deep slate dark theme.
        - `Theme by Time` (`time`): Automatically transitions to Noodle theme during day hours and switches to Coffee theme in the evening/night.
    - **Time Threshold Configuration** (when `time` is selected):
        - Noodle (Day) start hour: default 7:00 (configurable 0–23).
        - Coffee (Night) start hour: default 17:00 (configurable 0–23).
        - Dynamic background timer updates effective body classes every 30 seconds.
*   **Dashboard Width Adjustment**:
    - Slider (760px to 2560px, default 1200px) with one-click reset to default width.

### B. Due Date Colors (Urgency Thresholds)
*   Configurable day thresholds for deadline urgency status badges and next assignment highlights:
    - **Green Threshold** (default: > 7 days remaining).
    - **Yellow Threshold** (default: > 3 days remaining).
    - Anything equal to or below the yellow threshold triggers red urgency alerts.

### C. Manage Tracked Courses
*   Dedicated management section with a clean, vector-icon button (`<BookOpenIcon />`) to trigger the Course Configuration modal directly from Settings without navigating away.

### D. Configuration Backup & Restore
*   **Export Configuration**: One-click JSON export of all settings, course nicknames, custom colors, and authentication tokens (`<DownloadIcon />`).
*   **Import Configuration**: One-click file picker restoring saved preferences (`<UploadIcon />`), strictly avoiding unicode file emojis.

### E. Sandbox & Testing Data
*   **Mock Course Generator ("הוסף קורס לדוגמה")**:
    - One-click button in Settings that instantly injects Course 9999 ("0368-9999-01 קורס לדוגמה - מבני נתונים ואלגוריתמים") into local storage.
    - Includes active live Zoom meeting, upcoming meeting, assignments in all states (with attachments, submitted files, and no-deadline assignments), and course materials.
    - Enables instantaneous UI testing, screenshot generation, and feature verification without requiring live student credentials.

### F. Synchronization Integrations
*   **Google Tasks Sync**:
    - Toggle switch to enable/disable.
    - **Connection Status Indicator**:
        - Green pill badge (`Connected to Google Tasks` / `מחובר ל-Google Tasks`) when authenticated with a valid token.
        - Red warning pill badge (`Not connected — Authentication required` / `לא מחובר — נדרש אימות`) when Google Tasks is enabled but unauthenticated or token refresh failed.
    - **Unauthenticated Alert Banner**:
        - When `googleTasksEnabled === true` and unauthenticated or authentication failed, displays a prominent alert card on both the Dashboard and the Settings tab with title "Google Tasks sync is enabled but not connected" / "סנכרון Google Tasks מופעל אך החשבון אינו מחובר", explanatory text, and a 1-click "Connect Now ↗" / "התחבר עכשיו ↗" button.
    - **OAuth & Silent Re-Authentication**:
        - Preserves Google tokens across Moodle logout / SSO session resets.
        - Performs non-interactive silent token refresh in the background using cached account email (`login_hint`).
        - If silent refresh fails in the background, records error in `browser.storage.local` (`googleTasksAuthError`) and delivers a browser desktop notification instead of failing silently.
    - Status labels: Task List ID name, and "Last Synced" timestamp.
    - **Sync Now / Connect Button**: Triggers interactive authentication or manual sync. Displays spinner during sync. Dynamic label displays `Sync Google Tasks Now` when connected, or `Authenticate & Sync Google Tasks` when unauthenticated.
    - **Sync Assignments Without Deadline Toggle** (`syncWithoutDeadline`):
        - Switch to toggle syncing assignments lacking explicit due dates to Google Tasks.
        - Default state: **OFF** (`syncWithoutDeadline: false`).
        - Description: "Sync assignments without deadline to Google Tasks (Default: Off. When off, undated tasks will be pruned from Google Tasks)." / "סנכרון מטלות ללא תאריך יעד ל-Google Tasks (ברירת מחדל: כבוי. במצב כבוי, מטלות ללא מועד יוסרו מ-Google Tasks)."
    - **Hidden & Completed Task Deletion**: Tasks set as hidden or marked as done are automatically deleted from Google Tasks and never synced as active tasks. Toggling hidden or completed status triggers an immediate silent background sync if Google Tasks integration is enabled.
    - **Advanced Google OAuth Settings (Collapsible)**:
        - Collapsible section toggled via `הגדרות מתקדמות ל-Google Tasks` / `Advanced Google OAuth Settings` with a rotating `<ChevronDownIcon />`.
        - **Authorized Redirect URI Display**: Shows the active runtime redirect URI (`http://127.0.0.1/mozoauth2/<subdomain>` in Firefox per RFC 8252, or `https://<id>.chromiumapp.org/` in Chrome) in a read-only monospace input with a 1-click **Copy** (`העתק` / `Copy`) button.
        - **Help Guidance**: Clear instructional text explaining how to resolve `redirect_uri_mismatch (Error 400)` by registering the redirect URI in Google Cloud Console.
        - **Custom Client ID Input**: Optional input allowing self-hosters or custom GCP project owners to override the default Google OAuth 2.0 Client ID (`googleClientId`).
        - **Manual Access Token Fallback**: Secure password input field allowing direct paste of a Google OAuth access token with a **Save & Sync** button for environments where browser OAuth dialogs cannot be opened.
*   **Automatic Sync Interval (`syncIntervalMinutes`)**:
    - Select dropdown allowing the user to choose the periodic background sync duration: 1 minute, 5 minutes, 10 minutes, 15 minutes, 30 minutes, 60 minutes (default: 1 hour), or 120 minutes.
    - Connected directly to the Moodle Storage API (`NOODLE_SYNC_DATA` private calendar storage) so the preference persists and propagates across all devices.
    - Dynamically reschedules the browser background `periodicSync` alarm.

### D. Notification Configurations
*   **Push Alerts**: Toggle switch to enable/disable deadline reminders.
*   **Alert Windows**: Numeric input selectors to schedule alerts (e.g. "Remind me 24 hours before", "Remind me 3 days before").

### E. Backup & Session Management
*   **Export Configuration**: Button to download a backup file (`noodle_config.json`).
*   **Import Configuration**: Button to upload and parse a backup file.
*   **Account & Development Card**:
    - Displays User ID, Full Name, and Moodle connection state.
    - **Developer Credits**: Yuval Mantin & Michael Kushnir.
    - **Direct Links**:
        - GitHub Repository (`https://github.com/duck-5/Noodle`)
        - GitHub Issues & Bug Reports (`https://github.com/duck-5/Noodle/issues`)
        - Support & Suggestions Email (`noodle.d3v@gmail.com`)
        - Chrome Web Store Review (`https://chromewebstore.google.com/detail/noodle/nelflkccefbdpnaphjabcgkpakhdoope`)
*   **Disconnect Button**: Destructive button labeled "Disconnect from Moodle" that wipes all tokens, logs, local databases, and cookie records.

### F. Web Scraping & Panopto Tracking Configuration
*   **Moodle Web Scraping (Fallback)** (`#scraping-enabled-toggle`):
    - Switch toggle to enable or disable HTML web scraping fallback.
    - Default state: **OFF** (`scrapingEnabled: false`).
    - Bilingual Description: "Scrape Moodle web pages for archived assignments, Zoom links, and files unavailable via the standard API. Default: Off (may slow down sync)." / "סריקת עמודי Moodle לאיתור מטלות בארכיון, קישורי Zoom וקבצים שאינם זמינים ב-API הרגיל. ברירת מחדל: כבוי (עשוי להאט את הסנכרון)."
    - When disabled, synchronization strictly utilizes pure Moodle REST and AJAX endpoints for high-speed performance and minimal resource consumption.
*   **Panopto Lecture & Recitation Tracking** (`#panopto-enabled-toggle`):
    - Switch toggle to enable or disable automatic discovery and tracking of Panopto lecture and recitation recordings per course.
    - Default state: **OFF** (`panoptoEnabled: false`).
    - Bilingual Description: "Automatically discover and display course lecture and recitation recordings from Panopto inside each course page, with watched status tracking and manual folder override." / "איתור והצגה אוטומטית של הקלטות הרצאות ותרגולים מפנופטו בתוך עמודי הקורסים, כולל סימון הרצאות שנצפו ואפשרות להזנת קישור תיקייה ידני בניהול קורסים."
    - When enabled, the **Manage Courses** modal (`CoursesConfigTable`) and `CourseDetailView` display Panopto folder inputs only if `showPanoptoFolderOverride` is enabled.
    - **Manual Folder Override Input Toggle (`showPanoptoFolderOverride`)**:
        - Opt-in switch toggle (default: **OFF**) labeled "Show manual Panopto folder override (URL / UUID)" / "הצגת הגדרה ידנית של תיקיית Panopto".
        - Description: "Allows manually entering a custom Panopto folder link or UUID for courses where automatic discovery does not find recordings." / "מאפשר הזנה ידנית של קישור או מזהה UUID לתיקיית Panopto עבור קורסים שהסריקה האוטומטית לא מזהה."
        - When disabled (default), raw UUID and folder URL override inputs in `CourseDetailView` and the Panopto column in `CoursesConfigTable` remain hidden to provide a clean, non-intimidating experience for non-technical users. When enabled, power users can supply custom folder overrides.

### G. Local Filesystem Sync Configuration (`LocalFsSettingsSection`)
*   **Master Switch (`#local-fs-enabled-toggle`)**: Opt-in toggle (default: **OFF**) with live status pill (`Off` / `Connected` / `Syncing files...` / `Paused` / `Cooldown` / `Permission needed` / `Re-login needed`).
*   **Browser-Adaptive Folder Setup**:
    - **Chromium (`ChromiumFsaProvider`)**: Displays selected root folder badge (`.local-fs-path-chip`), **Choose Folder / Change Folder** button (`#local-fs-choose-folder-btn`), and **Reconnect Folder** button (`#local-fs-reconnect-btn`) if permission returns to `prompt`.
    - **Firefox (`FirefoxDownloadsProvider`)**: Displays target Downloads subfolder input (`#local-fs-firefox-subfolder-input`, default `Noodle`) + **Save** (`#local-fs-firefox-save-btn`), live preview `Downloads/<subfolder>/`, and a collapsible **"Want to sync outside Downloads?"** `<details>` panel with 1-click copy buttons for Linux/macOS (`ln -s`) and Windows (`mklink /J`) commands.
*   **Queue Telemetry & Controls** (visible when enabled): Synchronized file counters, failed/skipped counters, live animated linear progress bar (`.local-fs-progress-fill`) with current relative file path, `Sync Now` (`#local-fs-sync-now-btn`), `Pause` (`#local-fs-pause-btn`), `Resume` (`#local-fs-resume-btn`), `Retry Failed` (`#local-fs-retry-btn`), and collapsible skipped/failed logs drawer.
*   **Machine-Local Sub-Toggles & Selectors**:
    - **Automatically re-sync missing files (`#local-fs-auto-resync-toggle`)**: Default **OFF** (manual deletions remain deleted unless enabled).
    - **Include assignment prompt attachments (`#local-fs-include-assignments-toggle`)**: Default **ON**.
    - **Include my submitted assignment files (`#local-fs-include-submissions-toggle`)**: Default **OFF**.
    - **Use custom course nicknames (`#local-fs-use-nicknames-toggle`)**: Default **OFF**.
    - **Max single file size (`#local-fs-max-size-select`)**: `50 MB`, `100 MB` (default), `250 MB`, `500 MB`, or `Unlimited`.
    - **Initial sync throughput profile (`#local-fs-speed-profile-select`)**: `Safe & polite` (default) or `Moderate`.
*   **Permission Prompts**: If folder permissions reset (`needs_permission`), both the Dashboard (`.local-fs-perm-warning-banner`) and Popup surface a non-blocking banner linking directly to reconnect.


---

## 7. About Tab

*   **Brand Hero**: Responsive logo mark, gradient Noodle branding heading, and active version pill badge with live status dot (`v{manifestVersion}`).
*   **Developer Credits**: Special recognition for developers Yuval Mantin and Michael Kushnir housed in a styled accent pill (`.about-credits-author-chip`) with user avatar vector icon.
*   **Actionable Quick-Link Grid**: High-contrast, interactive link cards with dedicated accent color styling and themed icon containers (`.about-link-icon-box`):
    - **Official Website**: Cyan/Sky accented card (`https://noodle.mantin.dev/`).
    - **Chrome Web Store Review**: Amber/Gold star accented card (`https://chromewebstore.google.com/detail/noodle/nelflkccefbdpnaphjabcgkpakhdoope`).
    - **GitHub Repository**: Purple accented card (`https://github.com/duck-5/Noodle`).
    - **Issues & Suggestions**: Coral/Rose accented card (`https://github.com/duck-5/Noodle/issues`).
    - **Support Email**: Emerald/Green accented mailto shortcut to `noodle.d3v@gmail.com`.
    - **Relaunch Tour Button**: Indigo accented button that re-triggers the interactive onboarding walkthrough.
*   **Expandable Information Accordions** (`<details className="about-accordion">`):
    Each accordion features a category-specific SVG icon badge in the header, section title, numeric count pill badge (`7`, `5`, `4`), and smooth animated vector chevron. Content is rendered as modern, colorful item cards (`.about-item-card`) with theme-adaptive color accents instead of dense plain text:
    1. **Core Features & Cockpit (`✨ פיצ'רים עיקריים וניהול אקדמי` / `Core Features`)**:
       - 7 distinct feature cards with dedicated vector SVG icons and color accents:
         * *2-Way Google Tasks & Calendar Sync*: Sky Blue (`accent-sky`) with calendar-check icon.
         * *Lab Course Experiment Detection*: Purple (`accent-purple`) with chemistry flask icon.
         * *Next Task Spotlight & Live Countdown*: Amber (`accent-amber`) with stopwatch icon.
         * *Zoom Hub*: Emerald (`accent-emerald`) with video camera icon.
         * *Panopto Recordings Tracking (Beta)*: Rose (`accent-rose`) with media play icon.
         * *Fast File Browser & Attachments*: Sky Blue (`accent-sky`) with folder-download icon.
         * *Custom Themes*: Orange (`accent-orange`) with palette icon.
    2. **Pro Tips & Shortcuts (`💡 טיפים לשימוש וקיצורי דרך` / `Pro Tips & Shortcuts`)**:
       - 5 tip cards with distinct color-coded icons covering lab course filtering, deadline-less task sync, custom course colors/nicknames, cross-device configuration backup/restore, and keyboard navigation.
    3. **Privacy & Security Architecture (`🛡️ פרטיות ואבטחה` / `Privacy & Architecture`)**:
       - 4 security principle cards with trust-focused emerald, teal, sky, and purple icons covering 100% decentralized execution, zero telemetry, secure browser-local storage, and open-source transparency.

---

## 8. Zoom Links UI Integration & Filtering

To manage the multiple Zoom meetings extracted per course (such as lectures, tutorials, and recitations), both the Chrome Extension options page and the React Native mobile app implement a dedicated **Zoom Links** section on the main Dashboard view.

### A. Meeting Sorting & Color States
Meetings are grouped and sorted dynamically based on their status and schedule:
1. **Active State (Green)**: 
   - *Condition*: `startTime <= CurrentTime <= startTime + 2 hours`
   - *Styling*: Render card border or badge in vibrant Green.
   - *Sorting*: Pinned to the very top of the list.
2. **Unknown State (Standard Theme)**: 
   - *Condition*: Meeting has no fixed schedule / no `startTime` (recurring links).
   - *Styling*: Standard card color (blue/gray/dark theme color).
   - *Sorting*: Placed in the middle of the list.
3. **Inactive State (Grey)**: 
   - *Condition*: Meeting is not currently active (either in the past or far in the future).
   - *Styling*: Faded out with a grey accent color.
   - *Sorting*: Pushed to the bottom of the list.

### B. Interest & Custom Visibility Configuration
Users can filter out Zoom links they are not interested in (e.g., hiding other recitation groups they do not attend):
1. **Recurring Session Collapsing**: Weekly recurring sessions sharing the same meeting number or room URL are collapsed by default into a single entry representing the nearest upcoming meeting (or the latest past meeting if all sessions concluded).
2. **Uncluttered Visible-Only List**: Only user-selected (visible) meetings are rendered in the course card's main meeting list. Hidden meetings are completely removed from the primary list rather than taking up vertical space.
3. **Collapsible "Show Hidden" Toggle**: If a course contains hidden meetings, a toggle button (`👁️‍🗨️ הצג פגישות מוסתרות (X)` / `Show hidden meetings (X)`) appears below the visible list. Clicking expands a muted, dashed container showing the hidden meetings with eye-off buttons to unhide them.
4. **Course-Level Bulk Actions**: Header action buttons ("הצג הכל" / "Show all" and "הסתר הכל" / "Hide all") allow students to configure 10+ group instances in two clicks without affecting other courses.
5. **Empty State Notice**: If all meetings in a course are hidden, a friendly message ("כל קישורי הזום מוסתרים עבור קורס זה") is displayed alongside the "Show hidden meetings" button.

---

## 9. Theming Engine & Palettes

The extension and companion platforms support three distinct, high-contrast visual themes switchable via the Settings Tab:

1. **Slate Dark (`dark`)**:
   - Modern, ultra-deep dark palette optimized for late-night study sessions.
   - Background: `#0b0f19` / Card panels: `rgba(20, 27, 45, 0.75)`.
   - Accent borders: `rgba(255, 255, 255, 0.08)` / Primary: `#6366f1`.
2. **Warm Cream Noodle (`noodle`)**:
   - Soft, paper-like warm aesthetic inspired by artisanal noodle bowls.
   - Background: `#faf6ee` / Card panels: `rgba(255, 255, 255, 0.75)`.
   - Accent borders: `rgba(215, 204, 184, 0.6)` / Primary: `#b85d19`.
3. **Dark Noodle "Coffee" (`coffee`)**:
   - Refined, high-contrast dark roast palette free of reddish/burgundy hues, built with rich espresso tones, golden crema accents, and crisp velvety froth text.
   - Background: `#14100d` (pure dark espresso bean).
   - Card panels: `rgba(29, 23, 19, 0.94)` (dark roast glassmorphism).
   - Card borders: `rgba(196, 153, 108, 0.22)` (silky golden crema stroke).
   - Primary: `#d4a373` (rich luminous golden crema).
   - Secondary: `#10b981` (emerald green accent).
   - Warning: `#f59e0b` (vibrant warm amber).
   - Danger: `#ef4444` (vibrant clear ruby red).
   - Text Primary: `#fbf6f0` (froth cream, 100% sharp contrast).
   - Text Secondary: `#d0c3b6` (steamed milk foam).
   - Student Custom Course Colors: Preserved across course cards, rows, and queue items (preventing blanket header color resets).

4. **Theme by Time (`time`)**:
   - Automatic dynamic schedule cycling between Warm Cream Noodle during daytime hours (default 7:00–17:00) and Dark Noodle "Coffee" during nighttime hours (default 17:00–7:00).
   - Monitored on a 30-second runtime interval in both popup and full options views.

---

## 10. Interactive Landing & Onboarding Tour (v4 Cockpit)

The extension includes a 10-step interactive walkthrough designed in the v4 frosted glassmorphic aesthetic to orient first-time users and showcase Noodle's core features. It triggers automatically upon first successful setup (when `hasSeenTour` is falsy) and can be relaunched anytime from the **About** tab.

### A. Walkthrough Progression & Steps
1. **Step 0 — Cockpit Overview (`tour_welcome`)**:
   - *Target View*: Centered modal dialog on Dashboard.
   - *Contents*: Noodle bowl icon avatar badge, category pill `מבט כולל • Cockpit Overview`, decentralized local-first architecture highlights.
2. **Step 1 — Real-Time Sync Button (`tour_sync_btn`)**:
   - *Target View*: Highlights `.header-sync-btn` on Dashboard.
   - *Contents*: Real-time manual sync trigger, direct Moodle fetching without external proxy, automatic synchronization to Google Tasks.
3. **Step 2 — Next Task Spotlight (`tour_next_task`)**:
   - *Target View*: Docks to bottom center; highlights `.hero-spotlight-card`.
   - *Contents*: Immediate urgency spotlight, live countdown timer, 1-click submission link, prompt attachments, and course topic materials.
4. **Step 3 — Task Controls: Done & Hidden (`tour_tasks_actions`)**:
   - *Target View*: Highlights `.hero-actions-row` and `.queue-card`.
   - *Contents*: Single-click completion (`✓`) and hiding tasks (`👁`). Dynamic auto-removal from active to-do queue.
5. **Step 4 — Manage Courses Modal (`tour_courses_custom`)**:
   - *Target View*: Automatically opens `ManageCoursesModal` (`isManageModalOpen: true`), highlights `.modal-content` aligned to top viewport (`maxHeight: 62vh`).
   - *Contents*: Setting short course nicknames, assigning theme colors, tracking checkboxes, and semester grouping.
6. **Step 5 — Live Zoom Sessions & Visibility (`tour_zoom_visibility`)**:
   - *Target View*: Closes modal and automatically expands the first tracked course row (`expandedCourseId`), highlighting `.course-row-card`.
   - *Contents*: Recitation filtering via the eye icon (`👁`), "Active Now" banner with 1-click join, and viewing hidden sessions.
7. **Step 6 — Assignments Hub & Feed (`tour_tab_assignments`)**:
   - *Target View*: Automatically switches to the `assignments` tab; highlights `.filter-bar`.
   - *Contents*: Real-time search by task or course, 4 status filters (To Do, Past, Completed, Hidden), and expandable subject materials drawers.
8. **Step 7 — Grades & GPA Tracker (`tour_tab_grades`)**:
   - *Target View*: Automatically switches to the `grades` tab; highlights `.stat-card`.
   - *Contents*: Cumulative estimated GPA, grade component distributions (exams, exercises, quizzes), and auto-calculated averages.
9. **Step 8 — Settings & Google Tasks Sync (`tour_google_tasks`)**:
   - *Target View*: Automatically switches to the `settings` tab; highlights `.google-tasks-section`.
   - *Contents*: 2-way sync engine connecting Moodle assignment deadlines directly to Google Tasks and Google Calendar, theme options, and alert thresholds.
10. **Step 9 — Ready to Roll & About Tab (`tour_finish`)**:
   - *Target View*: Automatically switches to the `about` tab; highlights `.tab-about`.
   - *Contents*: Restarting the tour anytime, keyboard navigation shortcuts, developer credits, and version information. Exiting cleanly returns user to the Dashboard (`setActiveTab('dashboard')`).

### B. UI/UX Design System
- **Viewport Docking**:
  - *Steps 0 & 9*: Centered modal with `rgba(10, 12, 20, 0.72)` blurred backdrop overlay.
  - *Steps 1–8 (Highlight Mode)*: Transparent backdrop (`pointer-events: none`); card docks at the bottom viewport center (`max-width: 560px`), leaving the target highlighted UI elements completely visible and interactive.
- **Segmented Progress Stepper**: 10 segmented pill bars at the top of the card indicating progress. Users can click any step segment to jump directly to that step.
- **Glowing Element Pulse**: Target elements receive `.tour-highlight` with `outline: 2px solid var(--primary)` and smooth ambient glow (`box-shadow: 0 0 28px rgba(var(--primary-rgb), 0.5)`).
- **Keyboard Navigation**:
  - `ArrowRight` / `ArrowLeft` adapted to RTL (Hebrew) and LTR (English) locales.
  - `Escape` key immediately closes the tour and sets `hasSeenTour: true`.
  - On-screen monospace keyboard badge row (`[←] [→] [Esc]`) informs users of keyboard shortcuts.
- **Multi-Theme Parity**: Complete visual integration across `dark`, `theme-noodle`, and `theme-coffee` palettes.

---

## 7. Hierarchical Course Detail, Quizzes & Gradebook Components

### A. 2-Level Section Navigation Chip Bar
Course Detail views in the desktop extension and mobile apps render a format-aware 2-level topic chip bar:
1. **Top-Level Topic Bar**: Horizontally scrollable row displaying main course sections (e.g. "Intro", "Lectures", "Recitations", "Home assignments", "Quick-check quizzes").
2. **Child Subtopic Pill Row**: When a top-level topic containing nested subtopics or Moodle 4.5 subsections (`mod_subsection`) is selected, an indented secondary row appears displaying its child sections (e.g. "Week 1", "Week 2").
3. **Smooth Scroll Docking**: Clicking any chip smoothly scrolls the viewport to the matching section card and automatically expands it.

### B. Quizzes & בחנים (`mod_quiz`) UI Components
1. **Activity Badges**:
   - Distinctive purple badge: `❓ בוחן` (Hebrew) / `❓ Quiz` (English).
   - Time limit pill: `⏱️ 30 דק'` / `⏱️ 30 min` displayed whenever `timelimit > 0`.
2. **Interactive Two-Way Completion Checkbox**:
   - For activities with manual completion tracking (`requiresManualCompletion`), renders an interactive `Mark as done` (`סמן כבוצע`) button.
   - Clicking toggles state locally and synchronously dispatches completion back to Moodle server via `core_completion_update_activity_completion_status_manually`.
   - Visual state changes to green `✓ בוצע` / `✓ Done`.

### C. Folder Cards, Interactive Directory Browser & Pure-TS ZIP Downloader
1. **Folder Container**: Renders a dedicated card for Moodle folders (`mod_folder`) displaying folder title, description, file count, and total size.
2. **Interactive Directory Tree & Single-File Access**:
   - Folders are expandable and collapsible via header click or toggle chevron (`▼`/`▲`), defaulting to expanded so students can immediately see and access files.
   - Files inside the folder are rendered with a clean, minimalist monochrome <FileIcon />, file sizes, 1-click in-browser/local PC opening via FileOpenAction, and direct single-file download buttons. Zero emojis are used.
   - Preserves nested directory paths (`relativePath`), visually grouping files under styled subfolder headers (`📁 <subfolder>/`).
   - Empty folders display an empty state note (`No files in this folder` / `אין קבצים בתיקייה זו`) and disable ZIP downloading.
3. **Bulk ZIP Download Button**:
   - Prominent action button labeled `📦 הורד תיקייה כ-ZIP` / `Download ZIP`.
   - On click, triggers pure TypeScript in-memory ZIP assembly with live progress bar (`מוריד 2/5 קבצים...`).
   - Automatically prompts native browser or mobile OS save dialog with UTF-8 Hebrew filename preservation.
4. **Direct Moodle Deep Link**: Provides a secondary link button (`פתח תיקייה במודל ↗` / `Open in Moodle ↗`) pointing directly to `/mod/folder/view.php?id={cmid}`.

### D. Course Announcements Noticeboard Card
Renders a blue accent noticeboard card at the top of the course detail page for courses with active announcement forums (`mod_forum`):
- Icon: `📢`.
- Title: `לוח מודעות והודעות` / `Announcements & News`.
- Direct action buttons linking straight to individual Moodle forum views.

### E. Gradebook Fidelity, Bonus Badges, Feedback & Calculation Policy
1. **Consistent Course Average Display**:
   - Both Course Detail and Grades Tab display the consistent calculated course average (`Avg: 92.50` / `ממוצע: 92.50`) derived from published graded activities, matching the Estimated GPA formula and preventing mid-semester distortions where partial point accumulations (e.g. 16.67 or 33.33) are misinterpreted as final course totals.
2. **Bonus Badges**: Assignments and grade items flagged as bonus (`grademax <= 5` or `בונוס` in title) carry a minimalist amber `בונוס` / `Bonus` badge without unicode emojis.
3. **Instructor Feedback**: Assignment and grade rows display feedback notes in an indented green callout without unicode emojis.
4. **Grades Calculation Engine & Policy Notice**:
   - Pedagogical filtering strictly includes only activities with an official published grade in Moodle:
     * Excludes course-level exclusions and administrative / safety tutorials (course code prefixes `5800...`, `5900...` or `isAdministrativeCourse`).
     * Excludes hidden assignments (`isHidden` or present in `settings.hiddenAssignments`).
     * Excludes unsubmitted assignments locally marked as done (`isCompleted && !isMoodleSubmitted`).
     * Excludes future pending unsubmitted assignments, overdue unsubmitted assignments without a grade, and submitted assignments awaiting instructor grading (unsubmitted/overdue tasks are NOT defaulted to 0; only official grades assigned in Moodle are included).
   - Only assignments with an official published grade are displayed in the grades list.
   - A short, subtle explanatory notice banner (`.grades-calc-notice`) sits at the top of the Grades tab informing students of this policy across both Extension and Mobile.

### F. Local-First File Opening & PC vs Web Visual Indicators
* **Visual Status Differentiation (`FileOpenAction`)**: Every file row across Dashboard, Assignments Tab, and Course Detail renders an immediately distinguishable action button:
  - **Locally Synced Files (`.file-action-local`)**: Displays an emerald **PC/Monitor icon** (`<PcIcon />`) + **`Open` / `פתח`** as a `<button>` (suppressing the browser's bottom-left Moodle URL status preview on hover and instead displaying a local relative-path tooltip).
  - **Remote / Unsynced Files (`.file-action-web`)**: Displays a blue **Globe icon** (`<GlobeIcon />`) + **`Open ↗` / `פתח ↗`** as an `<a href={openUrl}>` linking to Moodle.
* **Synchronous Local Dispatch & Fallback**: Clicking a locally synced file reads `LocalFilesContext` synchronously in the click handler (`handleOpenFileInNewTab`) so Firefox preserves click activation for `browser.downloads.open(downloadId)` without losing user gesture across storage awaits, and Chromium opens a `blob:` preview tab from the `FileSystemFileHandle`. If the local copy is missing on disk, it flips cleanly to the Web icon and falls back seamlessly to Moodle HTTPS.

---

## 13. Minimalist Iconography & Zero-Emoji Standard

* **Zero Emojis**: The Noodle UI enforces a strict, professional design language. Colorful unicode emojis (such as file type emojis) are strictly prohibited across all screens, cards, badges, and file trees. They create a cheap, AI-generated appearance.
* **Minimalist Monochrome Icons**: When visual affordances are necessary, use crisp SVG vector components (<FileIcon />, <FolderIcon />, <ClockIcon />, <DownloadIcon />, <EyeIcon />).
* **Clean Restraint**: Never overuse icons. Prefer typography, clear hierarchy, and subtle neutral badges over icon clutter.
