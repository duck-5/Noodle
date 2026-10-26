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
    - **Disconnect Button**: Shorthand power plug icon (`🔌`) that triggers log out.
    - (Mobile only) The disconnect logo will appear only when the sidebar is expended

---

## 3. Dashboard Tab (v4 Home View)

* **Header Strip**: Minimal SVG sync icon with smooth spinning animation during synchronization (`.spinning-sync-icon`). Theme controls are centralized in Settings for a clutter-free header.

### A. Hero Action Strip
The top of the dashboard features a split horizontal action strip designed for rapid orientation and zero-anxiety productivity:
1. **Hero Spotlight Card ("המטלה הקרובה" / Next Task)**:
   - High-contrast card spotlighting the single nearest pending deadline, dynamically tinted with the course accent color (`rgba(courseColor, 0.08)` surface & glow border).
   - Category badge with course name and color indicator dot.
   - Section / Topic metadata strip providing immediate academic context.
   - **Expandable Files Drawer (`isHeroExpanded`)**: Clicking the Hero Spotlight card expands/collapses its files drawer (`.queue-item-expanded`), keeping course subject files (`קבצי הנושא`), assignment attachments, and submitted files hidden by default until expanded.
   - Course Subject Files (`קבצי הנושא`): Dynamically resolves and displays course files matching the assignment's topic section, equipped with squircle green "פתח ↗" link (`#10b981`) and squircle arrow-only SVG Download button (`<DownloadIcon size={12} />`).
   - Action toolbar with direct 1-click controls:
     - "סמן כבוצע" / "סמן כלא הושלם" (`CheckIcon`)
     - "הגש במודל ↗" primary action
     - "עבור לקורס" (`BookOpenIcon`)
     - "הסתר" / "בטל הסתרה" (`EyeIcon` / `EyeOffIcon`)
   - Attachment and submission chips with squircle "פתח ↗" link (`#10b981`) and squircle arrow-only SVG Download button (`<DownloadIcon size={12} />`).
2. **Upcoming To-Do Queue ("תור משימות קרובות")**:
   - Secondary vertical card listing imminent tasks.
   - **Exclusion & Sorting Filters**: Automatically excludes completed tasks (both Moodle-submitted and manually marked done) as well as hidden assignments.
   - Tasks are partitioned: future-dated tasks $\rightarrow$ tasks without deadlines $\rightarrow$ overdue tasks. Tasks without a deadline are explicitly included in the queue with stable deterministic ordering.
   - Each item is an interactive card with a quick checkmark button to mark complete, due badge, and expand drawer (`.queue-item-expanded`) containing:
     - Assignment prompt attachments with squircle open and arrow-only download buttons.
     - Course Subject Files (`קבצי הנושא`) matching the task's course and topic section with squircle open and arrow-only download buttons.
     - Submitted files chips when coursework was previously submitted.
     - Action toolbar: "עבור לקורס" (`go_to_course`), "סמן כבוצע / כלא הושלם" (`mark_done`), "הסתר / בטל הסתרה" (`hide_assignment`), and "הגש במודל ↗" (`submit_assignment`).

### B. Live Session & Progress Bar
* **Multi-Zoom Active Strip**: When one or more courses have live sessions running (`● פעיל כעת`), a prominent live meeting strip appears directly beneath the hero strip, strictly filtering out hidden or uninterested meetings.
* **Semester Progress**: Visual progress bar tracking overall completion percentage across all assignments in tracked courses (`X/Y (Z%)`).

### C. My Tracked Courses ("הקורסים שלי")
* **Deterministic Course Order**: Manual reordering arrows are removed for a predictable, clean list.
* **View Options Toggle**: Segmented switcher ("רשימה" / "List" vs "כרטיסים" / "Cards") allows toggling between a vertical rows list and a responsive card grid (`.courses-cards-grid`), persisted in local storage.
* **Manage Courses Modal Trigger**: "⚙️ ניהול קורסים" button opens a centered frosted-glass modal partitioned into semester groups, with course code/full name, display nickname text inputs, native color pickers, and tracking checkboxes.
* **Dual View Modes (List & Cards)**:
   - **List Mode**: Single horizontal flex row with course info, progress bar, next task, and actions toolbar.
   - **Cards Mode**: Responsive grid (`repeat(auto-fill, minmax(360px, 1fr))`) where each card is partitioned into two horizontal sections:
     - **Left Section**: Stacked column featuring course title/code with color dot, per-course progress bar, and next upcoming assignment details.
     - **Right Section**: Vertically stacked action buttons ("Assignments", "Go to Course") and centered rotating expansion chevron (`▼`).
* **Interactive Smooth Expansion**: Clicking anywhere on the row/card (or on the rotating chevron) smoothly opens the inline drawer (`.course-expanded-panel`) in both view modes, revealing:
   - **Zoom Links with Re-visibility**: All meetings configured for this course, displaying `<EyeIcon />` for visible and `<EyeOffIcon />` for hidden so hidden meetings can be unhidden at any time.
   - **Next 5 Assignments**: Up to 5 upcoming unhidden assignments, start-aligned (not centered) with clean column structure, squircle open links, and squircle arrow-only download buttons. Hidden assignments are excluded. Compact `.btn-xs` action buttons allow marking done or unhiding.

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
  - Clicking any assignment pill in the calendar automatically enables its status filter if currently unchecked, expands that assignment card in the feed, and smoothly scrolls it into view.
* **Course Filter Banner**:
  - Appears when navigating from a course row's "מטלות" button: `מסנן לפי קורס: [Course Name]`.
  - Includes an inline "הצג את כל הקורסים ✕" button to easily clear the filter and return to the complete assignments feed.
* **Compact / Minimized Cards**:
  - Collapsed by default to maximize visible density.
  - Shows course dot, course display name, task title, manual completion tag ("סומן כהושלם") or submission tag ("הוגש"), proximity deadline badge, direct Moodle submission link, and expansion chevron.
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
    1.  **Assignments**: List of assignments specific to this course with compact `.btn-xs` action buttons, unframed subject metadata text, "סומן כהושלם" status tags for manual completions, and expanded drawers displaying topic/subject files (`קבצי הנושא`), attachments, and submitted files.
    2.  **Lectures & Zoom**: Live session schedule containing:
        - Active live meeting highlights.
        - "הצג את כל המפגשים" toggle button to show and unhide hidden Zoom meetings.
        - Zoom link button, meeting ID & passcode text fields with quick copy buttons.
    3.  **Files**: Folder structure organizing PDF/PPT course documents, with each file item equipped with a green squircle "פתח ↗" direct open button (`border-radius: 8px`) and a squircle arrow-only SVG "הורדה" button (`<DownloadIcon size={12} />`) with the HTML `download` attribute.

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

### A. Personalization Settings
*   **Theme Selection**: Centralized theme selector with radio buttons for `Dark Mode` (`dark`), `Noodle Theme` (`noodle`), and `Coffee Theme` (`coffee`).
*   **Language Selection**: Radio buttons/toggle for `עברית` (Hebrew) and `English` (English).

### B. Sandbox & Testing Data
*   **Mock Course Generator ("➕ הוסף קורס לדוגמה")**:
    - One-click button in Settings that instantly injects Course 9999 ("0368-9999-01 קורס לדוגמה - מבני נתונים ואלגוריתמים") into local storage.
    - Includes active live Zoom meeting, upcoming meeting, assignments in all states (with attachments, submitted files, and no-deadline assignments), and course materials.
    - Enables instantaneous UI testing, screenshot generation, and feature verification without requiring live student credentials.

### C. Synchronization Integrations
*   **Google Tasks Sync**:
    - Toggle switch to enable/disable.
    - **Connection Status Indicator**:
        - Green pill badge (`● Connected to Google Tasks` / `מחובר ל-Google Tasks ●`) when authenticated with a valid token.
        - Red warning pill badge (`⚠️ Not connected — Authentication required` / `לא מחובר — נדרש אימות ⚠️`) when Google Tasks is enabled but unauthenticated or token refresh failed.
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
        - Collapsible section toggled via `⚙️ הגדרות מתקדמות ל-Google Tasks` / `⚙️ Advanced Google OAuth Settings` with a rotating chevron.
        - **Authorized Redirect URI Display**: Shows the active runtime redirect URI (`http://127.0.0.1/mozoauth2/<subdomain>` in Firefox per RFC 8252, or `https://<id>.chromiumapp.org/` in Chrome) in a read-only monospace input with a 1-click **Copy** (`📋 העתק` / `Copy`) button.
        - **Help Guidance**: Clear instructional text explaining how to resolve `redirect_uri_mismatch (Error 400)` by registering the redirect URI in Google Cloud Console.
        - **Custom Client ID Input**: Optional input allowing self-hosters or custom GCP project owners to override the default Google OAuth 2.0 Client ID (`googleClientId`).
        - **Manual Access Token Fallback**: Secure password input field allowing direct paste of a Google OAuth access token with a **Save & Sync** button for environments where browser OAuth dialogs cannot be opened.

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

### F. Web Scraping Configuration (Fallback)
*   **Moodle Web Scraping (Fallback)** (`#scraping-enabled-toggle`):
    - Switch toggle to enable or disable HTML web scraping fallback.
    - Default state: **OFF** (`scrapingEnabled: false`).
    - Bilingual Description: "Scrape Moodle web pages for archived assignments, Zoom links, and files unavailable via the standard API. Default: Off (may slow down sync)." / "סריקת עמודי Moodle לאיתור מטלות בארכיון, קישורי Zoom וקבצים שאינם זמינים ב-API הרגיל. ברירת מחדל: כבוי (עשוי להאט את הסנכרון)."
    - When disabled, synchronization strictly utilizes pure Moodle REST and AJAX endpoints for high-speed performance and minimal resource consumption.


---

## 7. About Tab

*   **Brand Hero**: Responsive logo mark, Noodle branding badge, and version label (e.g., `Version 4.0.0 (v4 Cockpit)`).
*   **Developer Credits**: Special recognition for developers Yuval Mantin and Michael Kushnir.
*   **Actionable Quick-Link Grid**: High-contrast, interactive link cards:
    - **GitHub Repository**: Direct link to source code (`https://github.com/duck-5/Noodle`).
    - **Issues & Suggestions**: Direct link to issue tracker (`https://github.com/duck-5/Noodle/issues`).
    - **Support Email**: Mailto shortcut to `noodle.d3v@gmail.com` with prefilled subject.
    - **Chrome Web Store Review**: Direct link to write a review on the store (`https://chromewebstore.google.com/detail/noodle/nelflkccefbdpnaphjabcgkpakhdoope`).
    - **Relaunch Tour Button**: Re-triggers the 7-step interactive onboarding walkthrough.
*   **Expandable Information Accordions** (`<details className="about-accordion">`):
    1. **Core Features & Cockpit (`✨ פיצ'רים עיקריים וניהול אקדמי` / `Core Features`)**:
       - Next Task Spotlight with live countdown and topic materials.
       - Full-page Assignments Feed with instant search and 4 filter chips ("לביצוע", "עברו", "הושלמו", "מוסתרים").
       - Multi-modal Zoom discovery and live active meeting indicators (`● פעיל כעת`).
       - Two-way Google Tasks synchronization.
       - Laboratory course detection and bulk assignment hiding.
    2. **Pro Tips & Shortcuts (`💡 טיפים לשימוש וקיצורי דרך` / `Pro Tips & Shortcuts`)**:
       - Quick theme cycling (`☕ / 🍜 / 🌙`) in top header.
       - Course-specific assignment filtering from Dashboard course rows.
       - Keyboard navigation during onboarding walkthrough (`[←] [→] [Esc]`).
       - One-click "Hide All" assignments toggle in Course Detail.
    3. **Privacy & Security Architecture (`🛡️ פרטיות ואבטחה` / `Privacy & Architecture`)**:
       - 100% decentralized, client-only architecture.
       - Zero third-party telemetry, tracking, or proxy servers.
       - Direct client-to-TAU HTTPS requests with encrypted-at-rest token caching.

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
   - Primary: `#c4996c` (golden crema) / Hover: `#d8b18a`.
   - Secondary: `#8da882` (matcha herbal accent).
   - Text Primary: `#fbf6f0` (froth cream, 100% sharp contrast).
   - Text Secondary: `#d1c3b7` (steamed milk foam).

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
