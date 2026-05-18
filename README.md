# TauTracker 🎓
<img width="2116" height="1504" alt="image" src="https://github.com/user-attachments/assets/3726823e-ad0e-42a6-a823-657a75e705c8" />
<img width="2116" height="1504" alt="image" src="https://github.com/user-attachments/assets/3864fbe3-c34e-40f2-a219-649eaf243581" />

TauTracker is an automated daemon that synchronizes your Tel Aviv University Moodle assignments and Panopto lecture recordings into a fully organised Dashboard in your Google Spreadsheet with Google Tasks integration. 

It runs completely in the cloud using **GitHub Actions**, requiring zero background resources on your local machine!

## Features
- **Moodle Sync**: Automatically fetches all pending assignments and syncs them to your Google Tasks and Spreadsheet.
- **Panopto Sync**: Scrapes your course Panopto recordings and intelligently deduplicates recitations. **Note - this feature is incomplete and may require manual deletion of some records**
- **Auto-Sorting**: Automatically sorts your Google Spreadsheet by Course Name, Resource Type, and Date.
- **Serverless**: Designed to run automatically on GitHub Actions.

## Setup Guide

To get this running automatically, follow these steps:
### 0. Set up your personal spreadsheet
Duplicate this [template](https://docs.google.com/spreadsheets/d/10IeOF4tFtYgwKkr2GlD1g_RhY9b7P4HoSE9LW_XQpH0/edit?usp=sharing). This is where you'll see all of your data, name the spreadsheet however you like. You can also edit course name colours by clicking on the pencil icon:
<img width="1452" height="625" alt="image" src="https://github.com/user-attachments/assets/7e0806ec-114a-4037-839a-c052a319f781" />
Finally, you can open the dashboard by clicking on the canvas menu - StudyFlow Academic Dashboard.
<img width="675" height="320" alt="image" src="https://github.com/user-attachments/assets/9ac5a11d-2e09-41e8-92b5-89b8bc9e737b" />

**Note - Dashboard currently cannot load sheets dynamically, meaning its locked to a single spreadsheet. At the moment the selected spreadsheet is Year1-SemesterB.**
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
TauTracker uses the top-right cell `I1` (e.g., `Last Sync: 05/17/2026 10:00:00`) as its database to remember when it last ran - **DO NOT ALTER IT**.
If you manually delete a row from your Google Spreadsheet, it will **not** be re-inserted as long as its creation/publication date is older than that timestamp.
