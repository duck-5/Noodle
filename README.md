# TauTracker 🎓

TauTracker is an automated daemon that synchronizes your Tel Aviv University Moodle assignments and Panopto lecture recordings into a fully organised Dashboard in yourGoogle Spreadsheet with Google Tasks integration. 

It runs completely in the cloud using **GitHub Actions**, requiring zero background resources on your local machine!

## Features
- **Moodle Sync**: Automatically fetches all pending assignments and syncs them to your Google Tasks and Spreadsheet.
- **Panopto Sync**: Scrapes your course Panopto recordings and intelligently deduplicates recitations.
- **Auto-Sorting**: Automatically sorts your Google Spreadsheet by Course Name, Resource Type, and Date.
- **Serverless**: Designed to run automatically on GitHub Actions.

## Setup Guide

To get this running automatically, follow these steps:

### 1. Fork the Repository
Click the **Fork** button at the top right of this page to create your own copy of the repository.

### 2. Configure Google Cloud Credentials
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project.
3. Enable the following APIs:
   - **Google Sheets API**
   - **Google Tasks API**
   - **Google Drive API**
4. Go to **APIs & Services > OAuth consent screen**. 
   - Choose **External**.
   - Fill in the required app details.
   - Under **Scopes**, add `.../auth/spreadsheets`, `.../auth/drive`, and `.../auth/tasks`.
   - **IMPORTANT**: Click **Publish App** to push it to production (this ensures your tokens won't expire in 7 days).
5. Go to **Credentials**. Create a new **OAuth client ID** (Application type: Desktop App).
6. Download the JSON and rename it to `credentials.json`.

### 3. Generate Your Access Token (Locally Once)
Because this runs headlessly in the cloud, you need to authorize the app once on your computer to generate a `token.json` file.
1. Clone your fork to your local machine.
2. Place `credentials.json` in the root folder.
3. Create your `.env` file (see `.env.example` format).
4. Run the script once locally:
   ```bash
   pip install -r requirements.txt
   python main.py
   ```
5. A browser window will open. Log in to your Google Account and accept the permissions. 
6. A `token.json` file will be generated in your folder.

### 4. Setup GitHub Secrets
Now that you have your configuration files, you need to provide them to GitHub Actions.
1. Go to your GitHub repository on the web.
2. Go to **Settings > Secrets and variables > Actions**.
3. Create the following **New repository secrets**:
   - `GOOGLE_CREDENTIALS_JSON`: Paste the entire contents of your `credentials.json` file.
   - `GOOGLE_TOKEN_JSON`: Paste the entire contents of your `token.json` file.
   - `ENV_FILE`: Paste the entire contents of your `.env` file.

### 5. Enable the Workflow
1. Go to the **Actions** tab in your GitHub repository.
2. Click **I understand my workflows, go ahead and enable them**.
3. You can click on the "TauTracker Sync" workflow and select **Run workflow** to test it immediately!
4. The script will now run automatically every 12 hours.

## Deleting Rows from the Spreadsheet
TauTracker uses the top-right cell `I1` (e.g., `Last Sync: 05/17/2026 10:00:00`) as its database to remember when it last ran.
If you manually delete a row from your Google Spreadsheet, it will **not** be re-inserted as long as its creation/publication date is older than that timestamp.
