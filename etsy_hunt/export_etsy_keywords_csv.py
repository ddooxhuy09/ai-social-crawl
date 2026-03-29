"""
Export keyword JSON → CSV vào history/hunt/.

Đọc từ etsy_hunt/data.json (mặc định) hoặc file chỉ định.

Chạy:
  python etsy_hunt/export_etsy_keywords_csv.py
  python etsy_hunt/export_etsy_keywords_csv.py --input etsy_hunt/data.json --out my.csv
"""

import argparse
import csv
import json
import sys
from datetime import datetime
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
HISTORY_DIR = BASE_DIR.parent / "history" / "hunt" / "keyword"

FIELD_MAPPING = [
    ("name", "keyword"),
    ("favorites", "favorites"),
    ("competition", "competition"),
    ("sales", "sales"),
    ("favorites_monthly", "favorites_monthly"),
    ("reviews_monthly", "reviews_monthly"),
    ("reviews", "reviews"),
    ("sales_monthly", "sales_monthly"),
    ("views", "views"),
    ("views_monthly", "views_monthly"),
]


def export_csv(data_file: Path, out_path: Path | None = None) -> Path:
    if not data_file.exists():
        sys.exit(f"[ERROR] Không tìm thấy file dữ liệu: {data_file}")

    with data_file.open("r", encoding="utf-8") as f:
        raw = json.load(f)

    items = raw.get("data", {}).get("list", [])
    keyword = raw.get("keyword", "unknown").replace(" ", "_")

    if out_path is None:
        HISTORY_DIR.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        out_path = HISTORY_DIR / f"etsy_keywords_{keyword}_{timestamp}.csv"

    out_path.parent.mkdir(parents=True, exist_ok=True)
    headers = [dest for _, dest in FIELD_MAPPING]
    with out_path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writeheader()
        for item in items:
            row = {dest: item.get(src, "") for src, dest in FIELD_MAPPING}
            writer.writerow(row)

    print(f"Đã ghi {len(items)} dòng → {out_path}")
    return out_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Export HEnull keyword results to CSV")
    parser.add_argument(
        "--input",
        default=str(BASE_DIR / "data.json"),
        help="File JSON đầu vào (default: etsy_hunt/data.json)",
    )
    parser.add_argument("--out", default=None, help="Đường dẫn file CSV đầu ra (tùy chọn)")
    args = parser.parse_args()

    export_csv(
        data_file=Path(args.input),
        out_path=Path(args.out) if args.out else None,
    )


if __name__ == "__main__":
    main()

