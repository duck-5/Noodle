import requests
import json
from config import MOODLE_URL, MOODLE_TOKEN

def test_site_info():
    params = {
        "wstoken": MOODLE_TOKEN,
        "wsfunction": "core_webservice_get_site_info",
        "moodlewsrestformat": "json"
    }
    
    try:
        response = requests.get(MOODLE_URL, params=params)
        response.raise_for_status()
        data = response.json()
        
        functions = [f.get("name") for f in data.get("functions", [])]
        print(f"Total functions: {len(functions)}")
        panopto_funcs = [f for f in functions if "panopto" in f.lower()]
        print("Panopto functions found:", panopto_funcs)
        
        # Let's save the full site info just in case
        with open("site_info.json", "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            
    except Exception as e:
        print("Failed:", e)

if __name__ == "__main__":
    test_site_info()
