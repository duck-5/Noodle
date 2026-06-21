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
*   **Header**: Scaled Noodle Logo (`576px` responsive, transitions to `40px` when collapsed) and "Noodle" application title.
*   **Navigation Menu Items**:
    - **Dashboard**: Chronological tasks list.
    - **Courses**: Course personalized settings.
    - **Files**: Resources browser.
    - **Settings**: Configuration settings.
    - **About**: Credits and application details.
*   **Sidebar Collapse Toggle**:
    - Flat button at the bottom of the sidebar with an arrow icon.
    - Clicking toggles width state (`240px` expanded vs `72px` collapsed).
    - (Mobile only) Clicking anywhere not on the sidebar collapses it
    - *Collapsed state styling*: Hides text labels, scales the logo to `40px` circular bounds, and formats navigation items as centered square buttons.
*   **Footer**:
    - **Disconnect Button**: Shorthand power plug icon (`🔌`) that triggers log out.
    - (Mobile only) The disconnect logo will appear only when the sidebar is expended

---

## 3. Dashboard Tab (Home View)

### A. Header Section
*   **Search Bar**: Real-time filter input field. Filters matching items across Assignments, Courses, and Files.
*   **Quick Stats Widget**: Horizontal row of 3 stat cards:
    1.  **Pending Assignments**: Count of untracked incomplete deadlines.
    2.  **Completed Assignments**: Count of submitted tasks.
    3.  **Impending Deadline**: Relative countdown to the closest pending assignment.

### B. Next Assignment Banner
*   High-priority card anchored at the top of the dashboard page.
*   **Content**:
    - Prominent countdown timer (e.g. `12 hours, 4 minutes remaining`).
    - Assignment Name.
    - Course Name (with custom nickname and color tag).
*   **Interactions**: Pressing/clicking this banner automatically expands the course section inline on the dashboard to reveal other related files.

### C. Assignments Feed
*   **Chronological Section Headers**:
    - **Overdue**: Overdue tasks (status not submitted).
    - **Today**: Deadlines within 24 hours.
    - **This Week**: Deadlines within 7 days.
    - **Later**: Future deadlines.
*   **Assignment Card Component**:
    - **Status Indicator**: Round badge colored by submission state:
        - *Submitted*: Green checkbox.
        - *Pending*: Yellow (safe) or Red (urgent).
        - *Overdue*: Dark Red outline.
    - **Course Tag**: Rounded colored tag utilizing the custom course color and displaying the course nickname.
    - **Assignment Title**: Text name.
    - **Due Date Label**: Absolute deadline timestamp.
    - **Remaining Time Label**: Dynamic text indicating remaining time (e.g., `2 hours remaining`, `6 days left`).
    - **Accordion Expand Indicator**: Chevron arrow representing expand status.
*   **Inline Course Section accordion**:
    - Slides down on clicking the assignment card using height and opacity transitions.
    - Lists related course resources:
        - **Files**: PDF slides or links to downloads.
        - **Zoom Link**: Clickable button to join lecture.
        - **Go to Course Button**: Jumps to the Course Detail view for the parent course.

---

## 4. Courses Tab

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
*   **Course Resources Tabs**:
    1.  **Assignments**: List of assignments specific to this course.
    2.  **Lectures & Zoom**: Live session schedule containing:
        - Zoom link button.
        - Zoom meeting ID & passcode text fields with quick copy buttons.
    3.  **Files**: Folder structure organizing downloaded and online PDF/PPT course documents.

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
*   **Theme Selection**: Radio buttons/toggle for `Dark Mode` and `Noodle Theme` (warm coffee color scheme).
*   **Language Selection**: Radio buttons/toggle for `עברית` (Hebrew) and `English` (English).

### B. Synchronization Integrations
*   **Google Tasks Sync**:
    - Toggle switch to enable/disable.
    - OAuth Log In button (visible if unauthorized).
    - Status labels: Task List ID name, and "Last Synced" timestamp.
    - **Sync Now Button**: Triggers manual sync on demand. Displays spinner during sync.

### C. Notification Configurations
*   **Push Alerts**: Toggle switch to enable/disable deadline reminders.
*   **Alert Windows**: Numeric input selectors to schedule alerts (e.g. "Remind me 24 hours before", "Remind me 3 days before").

### D. Backup & Session Management
*   **Export Configuration**: Button to download a backup file (`noodle_config.json`).
*   **Import Configuration**: Button to upload and parse a backup file.
*   **Account Card**: Displays User ID, Full Name, and Moodle connection state.
*   **Disconnect Button**: Destructive button labeled "Disconnect from Moodle" that wipes all tokens, logs, local databases, and cookie records.

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
