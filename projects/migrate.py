import json
import os
from pathlib import Path

def migrate():
    projects_file = Path("projects/projects.json")
    if not projects_file.exists():
        print("No projects.json found to migrate.")
        return

    try:
        data = json.loads(projects_file.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"Error reading projects.json: {e}")
        return
        
    count = 0
    for p in data:
        pid = p.get("id")
        if not pid:
            continue
        out_path = Path(f"projects/{pid}.json")
        out_path.write_text(json.dumps(p, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Migrated project {pid}")
        count += 1
        
    print(f"Migration complete. Extracted {count} projects.")
    try:
        os.rename("projects/projects.json", "projects/projects.json.bak")
        print("Renamed projects.json to projects.json.bak")
    except Exception as e:
        print(f"Could not rename projects.json: {e}")

if __name__ == "__main__":
    migrate()
