# TauTracker

TauTracker is a custom, modern, dark-themed replacement for the Tel Aviv University Moodle platform. It bypasses the traditional Moodle UI and provides a fast, offline-capable, and premium frontend experience.

## Features

- **Modern Dashboard**: Track your upcoming deadlines, recent grades, and live Zoom meetings at a glance.
- **Fast, Offline-first architecture**: Data is synced from Moodle and stored locally in CSV files for lightning-fast retrieval without waiting for Moodle to load.
- **Secure Multi-user Support**: Uses JWT authentication. Multiple students can use the same instance with their own isolated data.
- **Panopto Video Syncing**: Connect your SSO credentials to securely fetch and track your Panopto lecture recordings.
- **Zoom Meeting Detection**: Automatically parses your Moodle course contents to find and present Zoom links.
- **Grade Transparency**: Shows your real grade percentages and calculates class averages.

## Installation & Setup

1. Install requirements:
   ```bash
   pip install -r requirements.txt
   ```

2. Run the server:
   ```bash
   python run.py
   ```
   Or using uvicorn directly:
   ```bash
   uvicorn server.app:app --reload
   ```

3. Open the UI:
   Navigate to `http://localhost:8000` in your web browser.

4. Register an account and configure your settings!

## Development

- Frontend uses vanilla HTML/JS/CSS with ES6 modules (no build step required).
- Backend is powered by FastAPI.
- Data is stored in `server/db/*.csv`.

## Stages Completed
- Stage 1: Backend Foundation & Authentication
- Stage 2: Moodle API Wrappers
- Stage 3: Web Frontend & Core UI
- Stage 4: Polish & Documentation
