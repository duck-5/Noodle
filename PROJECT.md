# Project: TauTracker UX and Productivity Features
# Scope: Global Implementation

## Architecture
- Backend: Python server using Flask/FastAPI (need to verify) with Google API and Moodle integrations. SQLite or similar DB.
- Frontend: HTML/CSS/JS in `server/static`.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Onboarding & Empty States | Add walkthrough component, update UI for zero tasks/courses. | none | PLANNED |
| 2 | Error Handling & Tooltips | Improve Moodle token errors, add tooltips to technical terms, inline course name editing. | none | PLANNED |
| 3 | Task Management & Calendar | "Marked as Done" toggle (DB & UI), override by "Submitted", add text notes to tasks, Google Tasks integration. | none | PLANNED |
| 4 | Dashboard & Navigation | Widget reordering (persist to DB), course colors (persist to DB), course progress bars, English/Hebrew global search. | none | PLANNED |
| 5 | E2E Testing Suite | Comprehensive test suite driven by requirements. | none | PLANNED |

## Interface Contracts
### Frontend ↔ Backend
- UI state (widgets, colors, notes, marked as done) needs new or updated REST/GraphQL endpoints.
- Error handling needs standard API error formats.
- Google Tasks API requires OAuth flows via `clients/google_client.py` or `auth/`.

## Code Layout
- Backend routes: `server/routes/`
- Backend DB models: `server/db/`
- Frontend code: `server/static/`
- Clients: `clients/`
