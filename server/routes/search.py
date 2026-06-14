from fastapi import APIRouter, Depends, Query
from typing import Dict, List, Any
from server.auth.dependencies import get_current_user
from server.db.stores import user_courses_store, assignments_store

router = APIRouter()

@router.get("/")
def global_search(
    q: str = Query(..., min_length=1),
    current_user: dict = Depends(get_current_user)
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Search courses, assignments, and settings/navigation pages for the current user matching the query `q`.
    Matches are case-insensitive.
    """
    user_id = current_user["user_id"]
    query_lower = q.lower()

    # Page / Navigation matches
    matched_pages = []
    navigation_items = [
        {"id": "settings", "name": "Settings / הגדרות", "hash": "#/settings", "keywords": ["settings", "token", "sso", "credentials", "password", "profile", "moodle token", "sso credentials", "הגדרות", "טוקן", "ססו", "אסימון", "סיסמה", "פרופיל", "פרטי התחברות"]},
        {"id": "grades", "name": "Grades / ציונים", "hash": "#/grades", "keywords": ["grades", "gpa", "average", "transcript", "score", "scores", "ציונים", "גיליון ציונים", "ממוצע", "ציון"]},
        {"id": "files", "name": "Files / קבצים", "hash": "#/files", "keywords": ["files", "downloads", "documents", "course files", "קבצים", "מסמכים", "הורדות"]},
        {"id": "recordings", "name": "Recordings / הקלטות", "hash": "#/recordings", "keywords": ["recordings", "panopto", "lectures", "videos", "watch lectures", "הקלטות", "פנופטו", "הרצאות", "סרטונים", "וידאו"]},
        {"id": "meetings", "name": "Meetings / פגישות זום", "hash": "#/meetings", "keywords": ["meetings", "zoom", "live class", "active zoom", "פגישות", "זום", "שיעור חי", "מפגשים"]},
        {"id": "dashboard", "name": "Dashboard / לוח בקרה", "hash": "#/dashboard", "keywords": ["dashboard", "overview", "home", "stats", "לוח בקרה", "דשבורד", "ראשי", "בית"]},
        {"id": "courses", "name": "Courses / קורסים", "hash": "#/courses", "keywords": ["courses", "track courses", "enrolled courses", "קורסים", "מעקב", "מעקב קורסים"]},
        {"id": "assignments", "name": "Assignments / מטלות", "hash": "#/assignments", "keywords": ["assignments", "tasks", "deadlines", "due dates", "מטלות", "הגשות", "משימות", "עבודות"]}
    ]

    for item in navigation_items:
        if any(query_lower in kw for kw in item["keywords"]):
            matched_pages.append({
                "id": item["id"],
                "name": item["name"],
                "hash": item["hash"],
                "type": "page"
            })

    # Get user courses
    all_courses = user_courses_store.query({"user_id": user_id})
    matched_courses = []
    for course in all_courses:
        c_name = course.get("course_name", "")
        if query_lower in c_name.lower():
            matched_courses.append({
                "id": course.get("course_id") or course.get("id"),
                "name": c_name,
                "type": "course"
            })
            if len(matched_courses) >= 10:
                break

    # Get user assignments
    all_assignments = assignments_store.query({"user_id": user_id})
    matched_tasks = []
    for assign in all_assignments:
        a_name = assign.get("assignment_name", "")
        c_name = assign.get("course_name", "")
        if query_lower in a_name.lower() or query_lower in c_name.lower():
            matched_tasks.append({
                "id": assign.get("id"),
                "name": a_name,
                "course_name": c_name,
                "type": "task"
            })
            if len(matched_tasks) >= 10:
                break

    return {
        "courses": matched_courses,
        "tasks": matched_tasks,
        "pages": matched_pages
    }

