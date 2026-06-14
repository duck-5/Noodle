# TauTracker — Core Idea

TauTracker is a modern, privacy-first, productivity-focused dashboard designed specifically for students at Tel Aviv University (TAU). It serves as a custom front-end replacement for the university's Moodle learning management system, enhancing the student experience with a unified workspace, task management, and seamless integrations.

---

## 1. The Core Problem

The default university Moodle platform is functional but presents several usability and productivity limitations:
*   **Cluttered and Fragmented UI:** Students must navigate multiple course pages, tabs, and menus to find deadlines, check grades, or download slides.
*   **Lack of Unified Task Management:** There is no centralized, interactive dashboard showing a clean chronological checklist of upcoming assignments.
*   **No Native Integrations:** Students cannot easily sync their academic deadlines to external task managers like Google Tasks or calendar systems.
*   **Poor Mobile Experience:** The web interface is not optimized for quick on-the-go interactions, and the default Moodle mobile app can feel generic and slow.

---

## 2. The Solution: TauTracker

TauTracker consolidates a student's academic life into a single, cohesive, and visually stunning workspace available as:
1.  **A Browser Extension** (`apps/extension`): A Manifest V3 Chrome extension providing a quick-access popup and a full-page options dashboard.
2.  **A Mobile Application** (`apps/mobile`): A native React Native app (built with Expo) for iOS and Android.

### Key Value Propositions
*   **Unified Dashboard:** A single chronological timeline of all pending assignments across all enrolled courses, complete with real-time deadline countdowns.
*   **Configurable Tracking:** Students can choose which courses to track, rename them locally for readability, and assign colors to keep their workspace organized.
*   **Integrated File & Zoom Browsing:** Course materials and live lecture links are extracted and organized logically by week/section, making it easy to download files or join Zoom calls.
*   **Seamless Google Sync:** One-way synchronization from Moodle assignments to Google Tasks, ensuring academic deadlines automatically populate the student's personal calendars and checklists.
*   **Local Transcript & GPA:** A local grades view that aggregates course grades, computes course averages, and estimates overall GPA.

---

## 3. Why We Are Doing It: The Client-Side Pivot

Historically, TauTracker (v2.0.0) was built as a traditional client-server application with a centralized Python server, a shared CSV/SQLite database, and a centralized sync worker. 

To ensure the long-term sustainability, privacy, and reliability of the project, the architecture has transitioned to a **fully decentralized, client-only model**.

### Rationale for the Pivot

1.  **Eliminating IP Blocking Risk**
    A centralized server initiating thousands of Moodle API sync requests per day on behalf of hundreds of users will eventually trigger security firewalls. Moodle's infrastructure is highly likely to flag and block the server's IP. By shifting the sync engine to the client-side, every request originates from the student's own cellular, Wi-Fi, or home network IP, matching the traffic patterns of the official Moodle app.
    
2.  **Zero-Trust Security & Privacy Compliance**
    Storing Moodle API keys (`wstoken`) and SSO credentials (username, password, and Israeli national ID) on a centralized server creates a severe security and privacy liability under Israeli privacy laws (Hok HaHagana Al Nitunim Isiyim) and GDPR. In the decentralized architecture, sensitive credentials **never leave the user's device**. They are encrypted locally using OS-level secure storage (Keychain on iOS, Keystore on Android, and Chrome local storage encryption).

3.  **Operational Sustainability**
    Maintaining a production-grade database, managing encryption key rotation, running a selenium/playwright scraping farm, and paying for hosting servers adds operational overhead. A client-side app requires zero server infrastructure, reducing costs to zero and ensuring the app can run indefinitely without active maintenance.
