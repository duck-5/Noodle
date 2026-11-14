import argparse
import json
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path


def run_command(args, cwd):
    """Runs a subprocess portably across Linux, macOS, and Windows."""
    resolved = list(args)
    if resolved and resolved[0] == "pnpm":
        pnpm_path = shutil.which("pnpm")
        if pnpm_path:
            resolved[0] = pnpm_path
    subprocess.run(resolved, cwd=cwd, check=True, shell=(os.name == "nt"))


def create_zip_from_dir(source_dir, output_zip, strip_manifest_key=False):
    with zipfile.ZipFile(output_zip, "w", zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(source_dir):
            dirs[:] = [d for d in dirs if d != "_metadata"]
            for file in files:
                if file.endswith(".pem"):
                    continue
                file_path = os.path.join(root, file)
                # Enforce forward slashes for cross-platform compatibility (especially AMO)
                arcname = os.path.relpath(file_path, source_dir).replace("\\", "/")
                if strip_manifest_key and arcname == "manifest.json":
                    with open(file_path, "r", encoding="utf-8") as mf:
                        manifest_data = json.load(mf)
                    manifest_data.pop("key", None)
                    zipf.writestr(arcname, json.dumps(manifest_data, indent=2))
                else:
                    zipf.write(file_path, arcname)


def verify_zip_manifest(zip_path, browser):
    with zipfile.ZipFile(zip_path, "r") as zf:
        if "manifest.json" not in zf.namelist():
            raise RuntimeError(f"Release archive {zip_path} is missing manifest.json")
        manifest = json.loads(zf.read("manifest.json").decode("utf-8"))

    if "key" in manifest:
        raise RuntimeError(f"Release archive {zip_path} still contains manifest.key")

    bg = manifest.get("background") or {}
    if browser == "chrome":
        if not bg.get("service_worker"):
            raise RuntimeError(f"Chrome archive {zip_path} missing background.service_worker")
    elif browser == "firefox":
        if not isinstance(bg.get("scripts"), list) or not bg["scripts"]:
            raise RuntimeError(f"Firefox archive {zip_path} missing background.scripts")
        gecko_id = (manifest.get("browser_specific_settings") or {}).get("gecko", {}).get("id")
        if gecko_id != "noodle@tau":
            raise RuntimeError(f"Firefox archive {zip_path} expected gecko.id 'noodle@tau', got {gecko_id!r}")


def parse_args():
    parser = argparse.ArgumentParser(description="Build and package Noodle extension release archives.")
    parser.add_argument(
        "-v",
        "--version",
        help="Optional release version (e.g. 4.0.3 or v4.0.3) to embed in output archive filenames.",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    version_suffix = ""
    if args.version:
        clean_version = args.version.strip().lstrip("v")
        version_suffix = f"-v{clean_version}"

    root_dir = Path(__file__).parent.parent.resolve()
    extension_dir = root_dir / "apps" / "extension"
    dist_dir = extension_dir / "dist"
    firefox_dist_dir = extension_dir / "dist-firefox"
    releases_dir = root_dir / "releases"

    print("--- Cleaning up previous builds ---")
    if releases_dir.exists():
        shutil.rmtree(releases_dir)
    releases_dir.mkdir(parents=True, exist_ok=True)

    # Remove old zips from extension folder to keep things clean
    for old_zip in extension_dir.glob("*.zip"):
        old_zip.unlink()

    print("\n--- Building Shared Moodle Client ---")
    run_command(["pnpm", "run", "build:moodle-client"], cwd=root_dir)

    print("\n--- Building Chrome Extension ---")
    run_command(["pnpm", "run", "build:chrome"], cwd=extension_dir)
    chrome_zip = releases_dir / f"noodle{version_suffix}-chrome.zip"
    create_zip_from_dir(dist_dir, chrome_zip, strip_manifest_key=True)
    verify_zip_manifest(chrome_zip, "chrome")
    print(f"[SUCCESS] Chrome build packaged: {chrome_zip}")

    print("\n--- Building Firefox Extension ---")
    run_command(["pnpm", "run", "build:firefox"], cwd=extension_dir)
    firefox_zip = releases_dir / f"noodle{version_suffix}-firefox.zip"
    create_zip_from_dir(firefox_dist_dir, firefox_zip, strip_manifest_key=True)
    verify_zip_manifest(firefox_zip, "firefox")
    print(f"[SUCCESS] Firefox build packaged: {firefox_zip}")

    print("\n--- Packaging Source Code for AMO ---")
    package_source_script = root_dir / "scripts" / "package-source.py"
    if package_source_script.exists():
        run_command([sys.executable, str(package_source_script)], cwd=root_dir)
        source_zip = extension_dir / "noodle-source-code.zip"
        if source_zip.exists():
            target_source_zip = releases_dir / f"noodle{version_suffix}-source-code.zip"
            shutil.move(str(source_zip), str(target_source_zip))
            print(f"[SUCCESS] Source code packaged: {target_source_zip}")

    print("\n[SUCCESS] All release packages are ready in the 'releases/' directory!")


if __name__ == "__main__":
    main()
