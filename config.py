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
WORKSHEET_NAME = os.getenv("WORKSHEET_NAME", "Year1-SemesterB")
CREDENTIALS_FILE = "credentials.json" # Downloaded from Google Cloud Console

# Panopto Configuration
PANOPTO_URL = os.getenv("PANOPTO_URL")
PANOPTO_USER = os.getenv("PANOPTO_USER")
PANOPTO_PASS = os.getenv("PANOPTO_PASS")
PANOPTO_PID = os.getenv("PANOPTO_PID")

# Extract all course links dynamically from .env
PANOPTO_COURSES = {k: v for k, v in os.environ.items() if k.startswith('PANOPTO_COURSE_')}

# Timezone
TIMEZONE = 'Asia/Jerusalem'