import os
import zipfile

root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
output_zip = os.path.join(root_dir, 'apps', 'extension', 'noodle-source-code.zip')

if os.path.exists(output_zip):
    os.remove(output_zip)

# Paths and directories to include
include_files = [
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'turbo.json',
    'README.md',
]

include_dirs = [
    os.path.join('packages', 'moodle-client'),
    os.path.join('apps', 'extension'),
]

exclude_dirs = {
    'node_modules',
    'dist',
    '.git',
    '.turbo',
    '__pycache__',
    '.idea',
    '.vscode',
}

exclude_extensions = {
    '.zip',
    '.log',
}

with zipfile.ZipFile(output_zip, 'w', zipfile.ZIP_DEFLATED) as zipf:
    # 1. Add root files
    for rel_file in include_files:
        full_path = os.path.join(root_dir, rel_file)
        if os.path.exists(full_path):
            arcname = rel_file.replace('\\', '/')
            zipf.write(full_path, arcname)

    # 2. Add included directories
    for rel_dir in include_dirs:
        full_dir = os.path.join(root_dir, rel_dir)
        for root, dirs, files in os.walk(full_dir):
            # Prune excluded directories
            dirs[:] = [d for d in dirs if d not in exclude_dirs]
            
            for file in files:
                if any(file.endswith(ext) for ext in exclude_extensions):
                    continue
                file_path = os.path.join(root, file)
                rel_path = os.path.relpath(file_path, root_dir).replace('\\', '/')
                zipf.write(file_path, rel_path)

    # 3. Add instructions file for AMO reviewers
    instructions = """# Noodle Extension - Build Instructions for AMO Reviewers

## Prerequisites
- Node.js >= 20.x
- pnpm >= 10.x
- Python >= 3.10 (used for the zip packaging step)

## How to Build the Extension
1. Install dependencies from the repository root:
   ```bash
   pnpm install
   ```

2. Build the shared Moodle client package:
   ```bash
   pnpm --filter @tautracker/moodle-client run build
   ```

3. Build the extension package:
   ```bash
   pnpm --filter extension run build
   ```

4. The built distribution files will be located in:
   `apps/extension/dist/`

## How to Package the Extension ZIP
To generate the final extension zip (`noodle-firefox.zip`):
```bash
cd apps/extension
pnpm run build:zip
```
"""
    zipf.writestr('BUILD.md', instructions)

print(f"Successfully generated source archive at: {output_zip}")
with zipfile.ZipFile(output_zip, 'r') as check_zip:
    print(f"Total files in source archive: {len(check_zip.namelist())}")
    for name in sorted(check_zip.namelist())[:15]:
        print(f"  - {name}")
    if len(check_zip.namelist()) > 15:
        print(f"  ... and {len(check_zip.namelist()) - 15} more files.")
