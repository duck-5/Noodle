import json

def search():
    try:
        with open("site_info.json", "r", encoding="utf-8") as f:
            data = json.load(f)
            functions = [f.get("name") for f in data.get("functions", [])]
            for kw in ["block", "lti", "external", "tool", "url"]:
                matches = [f for f in functions if kw in f.lower()]
                print(f"Functions with '{kw}':", matches)
    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    search()
