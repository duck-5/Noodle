import json

def search():
    path = r"C:\Users\Yuval Mantin\.gemini\antigravity\brain\c469cb7a-9ec1-40bf-a2d4-13dbfc68537e\.system_generated\logs\transcript.jsonl"
    try:
        with open(path, "r", encoding="utf-8") as f:
            for i, line in enumerate(f):
                if "folderID" in line or "folderid" in line:
                    try:
                        obj = json.loads(line)
                        content = obj.get("content", "")
                        # Let's print the line index and a slice of content
                        print(f"Line {i}: {line[:200]}")
                        if "tau.cloud.panopto.eu" in line:
                            print(f"  Matches panopto server! Full text length: {len(line)}")
                            # Let's print anything with folderID
                            import re
                            urls = re.findall(r'https://tau\.cloud\.panopto\.eu/Panopto/Pages/Sessions/List\.aspx[^\s"\'\}]*', line)
                            if urls:
                                print("  FOUND PANOPTO URLS:", urls)
                    except Exception as e:
                        pass
    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    search()
