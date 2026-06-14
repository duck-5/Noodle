"""
TauTracker — FastAPI Application Factory.

This is the main FastAPI application entry point. It configures:
- CORS for browser access
- Static file serving for the frontend SPA
- All API route registrations
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
import os

from server.config import DEBUG


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title="TauTracker API",
        description="Multi-user Moodle replacement backend for Tel Aviv University",
        version="2.0.0",
        docs_url="/docs" if DEBUG else None,
        redoc_url="/redoc" if DEBUG else None,
    )

    # --- CORS ---
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # Tighten in production
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # --- Global exception handler ---
    @app.exception_handler(Exception)
    async def global_exception_handler(request, exc):
        return JSONResponse(
            status_code=500,
            content={"error": str(exc), "code": 500},
        )

    # --- Health check ---
    @app.get("/api/health", tags=["system"])
    async def health_check():
        return {"status": "ok", "version": "2.0.0"}

    # --- Register API routers ---
    from server.routes import auth, settings, courses, assignments, grades, files, recordings, meetings, sync
    app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
    app.include_router(settings.router, prefix="/api/settings", tags=["settings"])
    app.include_router(courses.router, prefix="/api/courses", tags=["courses"])
    app.include_router(assignments.router, prefix="/api/assignments", tags=["assignments"])
    app.include_router(grades.router, prefix="/api/grades", tags=["grades"])
    app.include_router(files.router, prefix="/api/files", tags=["files"])
    app.include_router(recordings.router, prefix="/api/recordings", tags=["recordings"])
    app.include_router(meetings.router, prefix="/api/meetings", tags=["meetings"])
    app.include_router(sync.router, prefix="/api/sync", tags=["sync"])

    # --- Static files (SPA frontend) — must be last ---
    static_dir = os.path.join(os.path.dirname(__file__), "static")
    if os.path.isdir(static_dir):
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")

    return app


app = create_app()
