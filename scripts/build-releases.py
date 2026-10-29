import os
import shutil
import zipfile
import subprocess
import json
from pathlib import Path

def create_zip_from_dir(source_dir, output_zip, strip_manifest_key=False):
    with zipfile.ZipFile(output_zip, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(source_dir):
            dirs[:] = [d for d in dirs if d != '_metadata']
            for file in files:
                if file.endswith('.pem'):
                    continue
                file_path = os.path.join(root, file)
                # Enforce forward slashes for cross-platform compatibility (especially AMO)
                arcname = os.path.relpath(file_path, source_dir).replace('\\', '/')
                if strip_manifest_key and arcname == 'manifest.json':
                    with open(file_path, 'r', encoding='utf-8') as mf:
                        manifest_data = json.load(mf)
                    manifest_data.pop('key', None)
                    zipf.writestr(arcname, json.dumps(manifest_data, indent=2))
                else:
                    zipf.write(file_path, arcname)

def main():
    root_dir = Path(__file__).parent.parent.resolve()
    extension_dir = root_dir / 'apps' / 'extension'
    dist_dir = extension_dir / 'dist'
    firefox_dist_dir = extension_dir / 'dist-firefox'
    releases_dir = root_dir / 'releases'

    print("--- Cleaning up previous builds ---")
    if releases_dir.exists():
        shutil.rmtree(releases_dir)
    releases_dir.mkdir(parents=True, exist_ok=True)
    
    # Remove old zips from extension folder to keep things clean
    for old_zip in extension_dir.glob("*.zip"):
        old_zip.unlink()

    print("\n--- Building Shared Moodle Client ---")
    subprocess.run(["pnpm", "run", "build:moodle-client"], cwd=root_dir, check=True, shell=True)

    print("\n--- Building Chrome Extension ---")
    subprocess.run(["pnpm", "run", "build:chrome"], cwd=extension_dir, check=True, shell=True)
    chrome_zip = releases_dir / 'noodle-chrome.zip'
    create_zip_from_dir(dist_dir, chrome_zip, strip_manifest_key=True)
    print(f"[SUCCESS] Chrome build packaged: {chrome_zip}")

    print("\n--- Building Firefox Extension ---")
    subprocess.run(["pnpm", "run", "build:firefox"], cwd=extension_dir, check=True, shell=True)
    firefox_zip = releases_dir / 'noodle-firefox.zip'
    create_zip_from_dir(firefox_dist_dir, firefox_zip)
    print(f"[SUCCESS] Firefox build packaged: {firefox_zip}")

    print("\n--- Packaging Source Code for AMO ---")
    package_source_script = root_dir / 'scripts' / 'package-source.py'
    if package_source_script.exists():
        subprocess.run(["python", str(package_source_script)], cwd=root_dir, check=True, shell=True)
        # Move it to releases folder if it generated in extension folder
        source_zip = extension_dir / 'noodle-source-code.zip'
        if source_zip.exists():
            shutil.move(str(source_zip), str(releases_dir / 'noodle-source-code.zip'))
            print(f"[SUCCESS] Source code packaged: {releases_dir / 'noodle-source-code.zip'}")
            
    print("\n[SUCCESS] All release packages are ready in the 'releases/' directory!")

if __name__ == "__main__":
    main()
