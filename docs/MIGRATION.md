# Migration Guide

This guide explains how to migrate from TauTracker `v1.0.0` to the current latest version with zero friction.

## Summary of Changes
The latest version introduces several major improvements including:
- Panopto auto-discovery using Moodle SSO.
- Dynamic syncing of assignment grades directly from the Moodle gradebook into the spreadsheet.
- Configurable Google Tasks target lists.
- Better security and handling of university credentials.

## Step-by-Step Migration

### 1. Run the Setup Wizard (Recommended)
The absolute easiest way to migrate is to simply run the updated setup wizard. It will automatically detect your old `.env` variables, migrate them to the new format, and prompt you for any missing settings (like enabling Panopto scraping).

Run the following command in your terminal:
```bash
python startup.py
```

### 2. Manual `.env` Migration (If you skipped Step 1)
If you prefer not to use the wizard, you must manually update your `.env` file to reflect the new architecture:

**Renamed SSO Credentials**
The tracker now uses your university SSO credentials for both Panopto and Moodle login automation. You must rename your old `PANOPTO_` keys:
- Rename `PANOPTO_USER` to `UNIVERSITY_USERNAME`
- Rename `PANOPTO_PASS` to `UNIVERSITY_PASSWORD`
- Rename `PANOPTO_PID` to `STUDENT_ID`

**New: Panopto Scraping Flag**
Panopto scraping (which requires Playwright and a headless browser) is now **opt-in**.
If you want the tracker to automatically fetch your new lectures, add this to your `.env`:
```ini
SCRAPE_PANOPTO=1
```
If you omit this, or set it to `0`, lecture fetching will be skipped.

**New: Google Tasks Target List**
You can now specify exactly which Google Tasks list assignments should be synced to. By default, it will use a list named `General`.
To customize this, add:
```ini
GOOGLE_TASKS_LIST=Your Custom List Name
```

### 3. Spreadsheet Updates
Because the new version natively fetches assignment grades from the Moodle gradebook, it expects an 8th column in your Google Sheet for grades. 
- If you let `google_client.py` create a *new* worksheet for a semester, it will create the column automatically.
- If you are reusing an existing worksheet, simply add a column header named **Grade** at the end of your table (usually Column H). The tracker will populate it automatically on the next run.

### 4. Cleanup Stale Scripts (Optional)
The following developer diagnostic scripts were removed in this release as they are no longer needed. You can safely delete them from your local directory if they are still present:
- `inspect_blocks.py`
- `inspect_course_contents.py`
- `inspect_functions.py`
- `search_moodle_functions.py`
- `search_transcript.py`

Once you have completed these steps, your TauTracker is fully upgraded! You can test it by running:
```bash
python main.py
```
