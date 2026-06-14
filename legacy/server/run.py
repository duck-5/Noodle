"""
TauTracker Server — Entry point.

Usage:
    python -m server.run
    # or
    python server/run.py
"""

import uvicorn
from server.config import SERVER_HOST, SERVER_PORT, DEBUG

if __name__ == "__main__":
    uvicorn.run(
        "server.app:app",
        host=SERVER_HOST,
        port=SERVER_PORT,
        reload=DEBUG,
    )
