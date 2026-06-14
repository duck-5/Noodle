# TauTracker QA Test Plan

This document outlines the core features that must be verified to ensure TauTracker functions correctly end-to-end.

## Stage 1: High-Level Features
These features cover the core use cases: logging in, syncing data, and viewing the primary content modules.

### 1. Authentication & Session Management
- **Registration:** Users can create a new account using a username, email, and password.
- **Login:** Users can log in with their credentials and receive a JWT token.
- **Logout:** Logging out clears the session and redirects to the login screen.

### 2. Data Synchronization
- **Trigger Sync:** Users can trigger a manual sync via the Dashboard "Refresh Moodle Data" button.
- **Background Processing:** The sync runs in the background without blocking the UI.
- **Progress Tracking:** The UI polls the sync status and alerts the user upon success or failure.

### 3. Dashboard Features
- **Statistics Summary:** Displays counts for tracked courses, pending tasks, upcoming deadlines, and overall average.
- **Upcoming Deadlines:** Lists assignments due within the next 7 days.
- **Recent Grades:** Shows the 5 most recent grades posted with visual indicators (green for >80%, red for <65%).
- **Active Zoom Meetings:** Displays immediate links to active course Zoom sessions.
- **Recent Recordings:** Shows newly published Panopto recordings.

### 4. Modules Verification
- **Courses:** Lists all currently enrolled courses.
- **Assignments:** Displays tasks split by pending vs. submitted status.
- **Grades:** Provides a full academic transcript.
- **Files:** Displays course resources (PDFs, PPTs) with working download links.
- **Recordings:** Displays a list of lecture recordings, properly categorized by type (Lecture vs. Recitation).
- **Meetings:** Lists extracted Zoom URLs from the Moodle platform.

## Stage 2: Super-Specific Features
These features cover user configurations, specific state mutations, and persistence behaviors.

### 1. User Configurations
- **Moodle Setup:** Users can configure their Moodle credentials (username and password).
- **Panopto Setup (Optional):** Users can configure SSO credentials for Panopto syncing.
- **Validation:** Credentials can be validated successfully.

### 2. Course Customizations
- **Course Aliases:** Users can change the display name (alias) of a course.
- **Panopto URLs:** Users can set a specific Panopto Folder URL for a course to override automatic discovery.

### 3. Internationalization (i18n) & Layout
- **Language Toggle:** Users can switch between English and Hebrew from the Settings page.
- **RTL Support:** The entire layout accurately mirrors (Right-to-Left) when Hebrew is selected.
- **Persistence:** The language preference persists across reloads.

### 4. Cross-Session State Persistence
- **Session Rehydration:** Closing the tab or reloading preserves the logged-in user state.
- **Configuration Persistence:** Updating course aliases and language preferences remains saved after logging out and logging back into the same account.
