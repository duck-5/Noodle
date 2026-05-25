import requests
import json
from config import MOODLE_URL, MOODLE_TOKEN

def test_get_blocks():
    # Let's test with course ID 321110001 or 321110401
    course_id = 321110401 # Introduction to Thermodynamics
    params = {
        "wstoken": MOODLE_TOKEN,
        "wsfunction": "core_block_get_course_blocks",
        "moodlewsrestformat": "json",
        "courseid": course_id,
        "returncontents": 1
    }
    
    try:
        response = requests.get(MOODLE_URL, params=params)
        response.raise_for_status()
        data = response.json()
        with open("course_blocks.json", "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print("Successfully wrote blocks response to course_blocks.json")
    except Exception as e:
        print("Failed:", e)

if __name__ == "__main__":
    test_get_blocks()
