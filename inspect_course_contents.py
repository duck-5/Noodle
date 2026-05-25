import requests
import json
from config import MOODLE_URL, MOODLE_TOKEN

def test_course_contents():
    course_id = 321110401 # Thermodynamics
    params = {
        "wstoken": MOODLE_TOKEN,
        "wsfunction": "core_course_get_contents",
        "moodlewsrestformat": "json",
        "courseid": course_id
    }
    
    try:
        response = requests.get(MOODLE_URL, params=params)
        response.raise_for_status()
        data = response.json()
        with open("course_contents.json", "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print("Successfully wrote course contents to course_contents.json")
    except Exception as e:
        print("Failed:", e)

if __name__ == "__main__":
    test_course_contents()
