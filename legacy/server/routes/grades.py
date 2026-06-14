from fastapi import APIRouter, Depends, HTTPException
from typing import List
from server.auth.dependencies import get_current_user
from server.db.stores import assignments_store

router = APIRouter()

def _format_grade_entry(a: dict):
    grade_val = a.get("grade")
    grade_max_val = a.get("grade_max")
    
    percentage = None
    g_num = None
    gm_num = None
    try:
        if grade_val not in (None, "-", "", "None"):
            g_num = float(grade_val)
        if grade_max_val not in (None, "-", "", "None"):
            gm_num = float(grade_max_val)
        else:
            gm_num = 100.0
            
        if g_num is not None and gm_num > 0:
            percentage = round((g_num / gm_num) * 100, 2)
    except ValueError:
        pass
        
    return {
        "assignment_id": a.get("id"),
        "course_id": a.get("course_id"),
        "course_name": a.get("course_name"),
        "assignment_name": a.get("assignment_name"),
        "grade": g_num if g_num is not None else grade_val,
        "grade_max": gm_num if gm_num is not None else grade_max_val,
        "percentage": percentage,
        "is_hidden": str(a.get("grade_is_hidden", "false")).lower() == "true"
    }

@router.get("/")
def get_all_grades(current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    assignments = assignments_store.query({"user_id": user_id})
    
    # Only return items that have a grade
    graded = [a for a in assignments if a.get("grade") and a.get("grade") != "-"]
    
    results = [_format_grade_entry(a) for a in graded]
    # Sort by course name
    results.sort(key=lambda x: x.get("course_name", ""))
    return results

@router.get("/course/{course_id}")
def get_course_grades(course_id: str, current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    assignments = assignments_store.query({"user_id": user_id, "course_id": course_id})
    
    graded = [a for a in assignments if a.get("grade") and a.get("grade") != "-"]
    results = [_format_grade_entry(a) for a in graded]
    
    return results

@router.get("/summary")
def get_grades_summary(current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    assignments = assignments_store.query({"user_id": user_id})
    
    # Group by course
    courses = {}
    for a in assignments:
        cid = a.get("course_id")
        if not cid:
            continue
        if cid not in courses:
            courses[cid] = {
                "course_id": cid,
                "course_name": a.get("course_name"),
                "total_assignments": 0,
                "graded_assignments": 0,
                "sum_percentages": 0.0
            }
        
        courses[cid]["total_assignments"] += 1
        
        entry = _format_grade_entry(a)
        if entry["percentage"] is not None:
            courses[cid]["graded_assignments"] += 1
            courses[cid]["sum_percentages"] += entry["percentage"]
            
    # Calculate averages
    summary = []
    for cid, data in courses.items():
        avg = None
        if data["graded_assignments"] > 0:
            avg = round(data["sum_percentages"] / data["graded_assignments"], 2)
            
        summary.append({
            "course_id": data["course_id"],
            "course_name": data["course_name"],
            "total_assignments": data["total_assignments"],
            "graded_assignments": data["graded_assignments"],
            "average_percentage": avg
        })
        
    return summary
