"""
TauTracker Server Configuration.

All backend-specific configuration lives here. Environment variables are loaded
from .env at the project root via python-dotenv.
"""

import os
import secrets
from dotenv import load_dotenv

load_dotenv()

# --- Server ---
SERVER_HOST = os.getenv("SERVER_HOST", "0.0.0.0")
SERVER_PORT = int(os.getenv("SERVER_PORT", "8000"))
DEBUG = os.getenv("DEBUG", "1") == "1"

# --- Security ---
# Used for JWT signing and Fernet encryption of Moodle tokens.
# MUST be set to a strong random value in production.
SERVER_SECRET = os.getenv("SERVER_SECRET", secrets.token_urlsafe(32))
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "1440"))  # 24 hours default

# --- Database (CSV) ---
DB_DIR = os.getenv("DB_DIR", os.path.join(os.path.dirname(os.path.dirname(__file__)), "db"))

# --- Moodle (global defaults — TAU only for now) ---
# NOTE: To support other institutions in the future, move MOODLE_URL to
# per-user settings in the database. See docs/ARCHITECTURE.md.
MOODLE_URL = os.getenv("MOODLE_URL", "https://moodle.tau.ac.il/webservice/rest/server.php")

# --- Panopto ---
PANOPTO_URL = os.getenv("PANOPTO_URL", "https://tau.cloud.panopto.eu")

# --- Sync ---
SYNC_COOLDOWN_SECONDS = int(os.getenv("SYNC_COOLDOWN_SECONDS", "300"))  # 5 minutes

# --- File Upload ---
# Max file upload size in bytes (10 MB). Files are base64-encoded for Moodle's
# core_files_upload, which roughly doubles the in-transit size.
# For files > 10MB, upgrade to /webservice/upload.php multipart endpoint.
# See implementation_plan.md Q3 for details.
MAX_UPLOAD_SIZE = int(os.getenv("MAX_UPLOAD_SIZE", str(10 * 1024 * 1024)))

# --- Timezone ---
TIMEZONE = os.getenv("TIMEZONE", "Asia/Jerusalem")
