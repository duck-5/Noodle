# TauTracker v2.0.0 Architecture & Design Specifications

This document defines the system design, data isolation model, API structure, and future scaling plans for TauTracker. It serves as a guide for developers extending the platform or building mobile applications against the REST API.

---

## 1. System Architecture Overview

TauTracker uses a lightweight, decoupled architecture optimized for low resource utilization and server performance.

```
┌─────────────────────────────────────────────────────────────┐
│                      FRONTEND (Web UI)                      │
│   HTML5/Vanilla CSS/ES6 Javascript  •  Glassmorphic SPA     │
│       (Future React Native / Flutter apps consume API)      │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP REST + Bearer JWT Token
┌──────────────────────────▼──────────────────────────────────┐
│                   BACKEND (FastAPI Server)                  │
│  - JWT Verification & Auth Router                           │
│  - Moodle API Service Wrapper (Stateless Requests)          │
│  - Async Panopto Scraper (Playwright)                       │
└────┬──────────────┬───────────────┬─────────────────────────┘
     │              │               │
┌────▼────┐   ┌─────▼─────┐   ┌────▼────────┐
│ CSV DB  │   │ Moodle WS │   │ Panopto     │
│ (local) │   │ (REST)    │   │ (SSO Login) │
└─────────┘   └───────────┘   └─────────────┘
```

*   **Frontend**: Single Page Application (SPA) built using vanilla HTML/CSS/JS (no framework bundle). Serves directly from the FastAPI static mount. Highly responsive, uses curated dark mode CSS tokens and glassmorphism.
*   **Backend**: FastAPI server. Serves as a REST gateway. Orchestrates authentication, caching, proxying, and background synchronization tasks.
*   **Database**: Thread-safe CSV-backed file stores located in the `db/` directory.

---

## 2. Multi-User Isolation & Security

User security and data isolation are fundamental pillars of TauTracker.

### User Isolation Model
*   Each user operates in strict isolation. All queries to the CSV database stores must pass through the `get_current_user` dependency, which fetches the active `user_id` from the JWT token.
*   All queries filter by the current `user_id` before performing operations. There are **zero** cross-user lookups or endpoints.

### Cryptography (At Rest)
*   Moodle Web Service tokens and SSO credentials (username, password, student ID) are **encrypted at rest** using Fernet symmetric encryption (`cryptography` library).
*   The encryption key is generated based on a server-side environment variable `SERVER_SECRET`. If `SERVER_SECRET` is changed, all tokens will become invalid, protecting credentials from local breaches.

---

## 3. Swappable Database Interface

The data storage uses a generic `CSVStore` class (`server/db/csv_store.py`) backed by `threading.Lock` to ensure thread-safety during concurrent background runs.

### Migration path (CSV → SQL)
To transition the system to a relational database (e.g., SQLite or PostgreSQL) as the user base expands:
1.  Replace instantiations in `server/db/stores.py` with SQLAlchemy/SQLModel database schemas matching the columns.
2.  Implement the CRUD methods (`read_all`, `read_by_key`, `query`, `insert`, `update`, `delete`, `upsert`) on a new SQLStore class using SQLAlchemy sessions.
3.  Because the route handlers interact exclusively with the store instances through these CRUD methods, zero code modifications will be needed on the routing or controller layers.

---

## 4. REST API & Mobile Client Integration

All server functionalities are exposed via JSON endpoints utilizing standard HTTP verbs:
*   `POST /api/auth/register` & `POST /api/auth/login` (Auth Portal)
*   `GET /api/auth/me` & `PUT /api/auth/me` (Profile configuration)
*   `GET /api/courses/` & `POST /api/courses/` (Tracking config)
*   `GET /api/assignments/` (Task browser)
*   `GET /api/grades/` & `GET /api/grades/summary` (Transcript GPA summary)
*   `GET /api/files/course/{id}` & `GET /api/files/download?url=...` (Proxy downloads)
*   `GET /api/recordings/` & `PUT /api/recordings/{id}/status` (Panopto viewer)

### Mobile App Integration
Because the API uses stateless JSON and Bearer JWT tokens stored in request headers, **any Android or iOS application (such as React Native or Flutter) can consume this backend directly** without changes to the authentication or business logic.

---

## 5. Future Upgrade Roadmap

### A. Multi-Institution / Custom Moodle URLs
Currently, `MOODLE_URL` is set globally in the `.env` file. To support custom university Moodle instances:
1.  Add a `moodle_url` column to the `users` CSV store.
2.  Allow users to configure their specific Moodle domain in `POST /api/settings/moodle-token`.
3.  Modify the Moodle client calls in route handlers to pass the user's stored `moodle_url` instead of using the global `config.MOODLE_URL` fallback.

### B. File Uploads > 10MB
For submissions smaller than 10MB, the backend uploads base64 file payloads directly via `core_files_upload` Web Service API. To lift this limitation for larger submissions:
1.  Implement chunked file uploading using the standard Moodle REST upload endpoint `/webservice/upload.php`.
2.  Transmit multipart multipart form chunks from the frontend and pipe them directly to Moodle, bypassing the memory-heavy base64 string conversions.

### C. Live Push Notifications
Currently, data refreshes are triggered on-demand via the dashboard's Refresh button. To support notifications on deadlines or grades:
1.  Implement a periodic CRON daemon on the server that loops through all users and triggers sync tasks.
2.  Integrate Firebase Cloud Messaging (FCM) to trigger background push notifications on the user's phone when new assignments are registered or grades are updated.
