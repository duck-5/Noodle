import os
from dotenv import load_dotenv

load_dotenv()

VERSION = "1.0.0"

MOODLE_URL = "https://moodle.tau.ac.il/webservice/rest/server.php"
MOODLE_TOKEN = os.getenv("MOODLE_TOKEN")

# Moodle Courses Filter
MOODLE_COURSES_ENV = os.getenv("MOODLE_COURSES", "")
MOODLE_COURSES_LIST = [c.strip() for c in MOODLE_COURSES_ENV.split(",")] if MOODLE_COURSES_ENV else []

# Google Sheets Configuration
SPREADSHEET_NAME = os.getenv("SPREADSHEET_NAME", "University Tracker")
WORKSHEET_NAME = os.getenv("WORKSHEET_NAME", "2025-SemesterB")
CREDENTIALS_FILE = "credentials.json" # Downloaded from Google Cloud Console

# Google Tasks Configuration
GOOGLE_TASKS_LIST = os.getenv("GOOGLE_TASKS_LIST", "General")

# Panopto Configuration
PANOPTO_URL = os.getenv("PANOPTO_URL")
PANOPTO_USER = os.getenv("UNIVERSITY_USERNAME")
PANOPTO_PASS = os.getenv("UNIVERSITY_PASSWORD")
PANOPTO_PID = os.getenv("STUDENT_ID")
SCRAPE_PANOPTO = os.getenv("SCRAPE_PANOPTO", "0") == "1"

# Extract all course links dynamically from .env
PANOPTO_COURSES = {k: v for k, v in os.environ.items() if k.startswith('PANOPTO_COURSE_')}

# Human-readable course names keyed by course ID: COURSE_{id} -> name
# e.g. COURSE_321110401=Introduction to Thermodynamics
COURSE_NAMES = {k.replace('COURSE_', ''): v for k, v in os.environ.items() if k.startswith('COURSE_') and not k.startswith('COURSE_NAMES')}

# Timezone
TIMEZONE = 'Asia/Jerusalem'