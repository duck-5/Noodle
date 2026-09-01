import os
import zipfile

dist_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'dist'))
zip_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'noodle-firefox.zip'))

if os.path.exists(zip_path):
    os.remove(zip_path)

with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
    for root, dirs, files in os.walk(dist_dir):
        for file in files:
            file_path = os.path.join(root, file)
            # Crucial: arcname MUST use forward slashes (/) for Firefox AMO validator
            arcname = os.path.relpath(file_path, dist_dir).replace('\\', '/')
            zipf.write(file_path, arcname)

print(f"Successfully packaged {zip_path}")
with zipfile.ZipFile(zip_path, 'r') as check_zip:
    print("Archive entry paths:")
    for info in check_zip.infolist():
        print(f"  - {info.filename}")
