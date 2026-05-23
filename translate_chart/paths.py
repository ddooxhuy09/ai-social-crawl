from pathlib import Path

_BASE = Path(__file__).resolve().parent.parent
TERMINOLOGY_PATH = Path(__file__).resolve().parent / "terminology.json"
PROJECTS_ROOT = _BASE / "history" / "translate-chart"
PROJECTS_ROOT.mkdir(parents=True, exist_ok=True)
