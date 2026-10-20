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
*   **Footer Action Bar**:
    *   **Start Tracking Button**: Prominent primary button displaying: "Start Tracking (X Courses)" where X is the count of selected courses. Disabled if X = 0.
    *   **Import Configuration Button**: Secondary button/file picker icon to restore profile configurations from a JSON backup.

---

## 2. Navigation Layout & Shell

### A. Navigation Sidebar (Desktop Options Page)
*   **Header**: Scaled Noodle Logo (`72px` expanded, transitions to `44px` when collapsed) and "Noodle" application title (`1.45rem` bold font).
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
   - High-contrast card spotlighting the single nearest pending deadline.
   - Non-stressful header badge with countdown timer and course tag.
   - Clicking the card expands/collapses inline details without navigating away from the dashboard.
   - Attachment preview chips with direct green `Open ↗` and SVG `Download ↓` links.
   - Expandable inline details drawer showing subject topic and assignment actions.
   - Primary "Go to Course" and "Submit ↗" quick actions.
2. **Upcoming To-Do Queue ("תור משימות קרובות")**:
   - Secondary vertical card listing imminent tasks.
   - **Exclusion & Sorting Filters**: Automatically excludes completed tasks (both Moodle-submitted and manually marked done) as well as hidden assignments.
   - Tasks are partitioned: future-dated tasks $\rightarrow$ tasks without deadlines $\rightarrow$ overdue tasks. Tasks without a deadline are explicitly included in the queue so students never miss un-dated coursework.
   - Each item is an interactive card with a quick checkmark button to mark complete, due badge, and expand drawer containing topic pill and attachment downloads.

### B. Live Session & Progress Bar
* **Multi-Zoom Active Strip**: When one or more courses have live sessions running (`● פעיל כעת`), a prominent live meeting strip appears directly beneath the hero strip, supporting multiple simultaneous meetings.
* **Semester Progress**: Visual progress bar tracking overall completion percentage across all assignments in tracked courses (`X/Y (Z%)`).

### C. My Tracked Courses ("הקורסים שלי")
* **Deterministic Course Order**: Manual reordering arrows are removed for a predictable, clean list.
* **Manage Courses Modal Trigger**: "⚙️ ניהול קורסים" button opens a centered frosted-glass modal partitioned into semester groups, with course code/full name, display nickname text inputs, native color pickers, and tracking checkboxes.
* **Interactive Course Rows**:
   - Course color indicator dot, customized nickname, and course code.
   - Mini progress bar reflecting per-course completion.
   - Next task indicator for that course with deadline badge.
   - Direct "Assignments" filter and "Go to Course" buttons.
   - **Smooth Row Expansion**: Clicking anywhere on the course row smoothly expands an inline drawer revealing:
     - **Zoom Links with Re-visibility**: All meetings configured for this course, displaying `<EyeIcon />` for visible and `<EyeOffIcon />` for hidden so hidden meetings can be unhidden at any time.
     - **Next 5 Assignments**: Up to 5 upcoming assignments rendered as full, interactive assignment cards that can be expanded in place to view materials and actions.

---

## 4. Dedicated Assignments Tab ("מטלות")

A dedicated full-page assignment feed providing comprehensive management of all academic tasks:
* **Filter Bar**:
  - **Full Text Search**: Immediate debounced filter by assignment or course name.
  - **Filter Checkboxes**: Real-time filters for Pending ("לביצוע"), Past ("עברו"), Completed ("הושלמו"), and Hidden ("מוסתרים").
* **Course Filter Banner**:
  - Appears when navigating from a course row's "מטלות" button: `מסנן לפי קורס: [Course Name]`.
  - Includes an inline "הצג את כל הקורסים ✕" button to easily clear the filter and return to the complete assignments feed.
* **Compact / Minimized Cards**:
  - Collapsed by default to maximize visible density.
  - Shows course dot, course display name, task title, manual completion tag ("סומן כהושלם") or submission tag ("הוגש"), proximity deadline badge, direct Moodle submission link, and expansion chevron.
* **Smooth Accordion Drawer**:
  - **Subject Files ("קבצי הנושא")**: Section files matching the assignment's course ID and topic section, displayed with green "פתח ↗" link and SVG "הורדה ↓" button.
  - **Attachments**: Assignment prompt/instruction files with green "פתח ↗" and SVG "הורדה ↓" buttons.
  - **Submitted Files**: Files uploaded by the student with checkmark indicator and green "פתח ↗" / SVG "הורדה ↓" buttons.
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
*   **Personalization Editor**:
    - **Nickname Field**: Real-time editable text input. Saving changes re-labels the course everywhere.
    - **Color Palette Picker**: A grid of selectable colored circles (min. 8 options). Selecting a circle updates the course's primary accent color.
*   **Course-Level Assignment Actions**:
    - **Hide All Assignments Button**: "הסתר את כל המטלות" / "בטל הסתרת הכל" button to bulk-hide or unhide all assignments in this course.
*   **Course Resources Tabs**:
    1.  **Assignments**: List of assignments specific to this course with compact `.btn-xs` action buttons, unframed subject metadata text, "סומן כהושלם" status tags for manual completions, and expanded drawers displaying topic/subject files (`קבצי הנושא`), attachments, and submitted files.
    2.  **Lectures & Zoom**: Live session schedule containing:
        - Active live meeting highlights.
        - "הצג את כל המפגשים" toggle button to show and unhide hidden Zoom meetings.
        - Zoom link button, meeting ID & passcode text fields with quick copy buttons.
    3.  **Files**: Folder structure organizing PDF/PPT course documents, with each file item equipped with a green "פתח ↗" direct open button and an SVG "הורדה ↓" download button with the `download` attribute.

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
    - OAuth Log In button (visible if unauthorized).
    - Status labels: Task List ID name, and "Last Synced" timestamp.
    - **Sync Now Button**: Triggers manual sync on demand. Displays spinner during sync.

### D. Notification Configurations
*   **Push Alerts**: Toggle switch to enable/disable deadline reminders.
*   **Alert Windows**: Numeric input selectors to schedule alerts (e.g. "Remind me 24 hours before", "Remind me 3 days before").

### E. Backup & Session Management
*   **Export Configuration**: Button to download a backup file (`noodle_config.json`).
*   **Import Configuration**: Button to upload and parse a backup file.
*   **Account Card**: Displays User ID, Full Name, and Moodle connection state.
*   **Disconnect Button**: Destructive button labeled "Disconnect from Moodle" that wipes all tokens, logs, local databases, and cookie records.

### E. Web Scraping Configuration (Fallback)
*   **Moodle Web Scraping (Fallback)** (`#scraping-enabled-toggle`):
    - Switch toggle to enable or disable HTML web scraping fallback.
    - Default state: **OFF** (`scrapingEnabled: false`).
    - Bilingual Description: "Scrape Moodle web pages for archived assignments, Zoom links, and files unavailable via the standard API. Default: Off (may slow down sync)." / "סריקת עמודי Moodle לאיתור מטלות בארכיון, קישורי Zoom וקבצים שאינם זמינים ב-API הרגיל. ברירת מחדל: כבוי (עשוי להאט את הסנכרון)."
    - When disabled, synchronization strictly utilizes pure Moodle REST and AJAX endpoints for high-speed performance and minimal resource consumption.


---

## 7. About Tab

*   **Credits Section**: Project details, developer credentials, and links to source code repositories.
*   **Version Label**: Current version (e.g., `Version Beta-0.4`).

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
1. **Interest Toggle**: Each Zoom card features a toggle button (eye icon `👁` / `👁‍🗨`). Toggling it adds/removes the meeting's ID from the user's `interestedMeetings` storage list.
2. **Show All Filter**:
   - **Show All = OFF (Default)**: Uninterested Zoom links are hidden from the dashboard entirely.
   - **Show All = ON**: All Zoom links are shown, but uninterested links are rendered in a faded/transparent state with a slashed eye icon.

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
   - High-contrast, warm dark mocha palette where cards and panels are visually lighter than the deep roast background.
   - Background: `#1e1612` (dark roast espresso).
   - Card panels: `rgba(44, 34, 27, 0.94)` (warm roasted mocha glassmorphism).
   - Card borders: `rgba(226, 135, 67, 0.22)` (caramel amber stroke).
   - Primary: `#e28743` (caramel crema) / Secondary: `#a6c48a` (soft sage).
   - Text Primary: `#fff8f0` (milk froth cream, 100% sharp contrast).
   - Text Secondary: `#d6c7b2` (subtle warm tan).
