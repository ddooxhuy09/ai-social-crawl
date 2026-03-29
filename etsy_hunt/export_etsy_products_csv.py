"""
Export product_last_results.json → CSV vào history/hunt/.

Chạy:
  python etsy_hunt/export_etsy_products_csv.py
  python etsy_hunt/export_etsy_products_csv.py --out my_products.csv
"""

import argparse
import csv
import json
import sys
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
RESULTS_FILE = BASE_DIR / "product_last_results.json"
HISTORY_DIR = BASE_DIR.parent / "history" / "hunt" / "product"

PRODUCT_COLUMNS = [
    "product_id", "title", "logo_url", "product_url", "price", "currency_code",
    "release_time", "sales_total", "monthly_sales", "reviews",
    "favorites", "is_pick", "is_bestsell", "hightlights",
    "ships_from", "store_name", "tags", "store_rating", "reviews_weekly",
    "favorites_weekly", "reviews_month", "favorites_month", "total_sales",
]


def export_csv(results_file: Path, out_path: Path | None = None) -> Path:
    if not results_file.exists():
        sys.exit(f"[ERROR] Không tìm thấy file kết quả: {results_file}")

    data = json.loads(results_file.read_text(encoding="utf-8"))
    items = data.get("list", [])
    search_key = data.get("search_key", "unknown").replace(" ", "_")

    if out_path is None:
        HISTORY_DIR.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        out_path = HISTORY_DIR / f"etsy_products_{search_key}_{timestamp}.csv"

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=PRODUCT_COLUMNS)
        writer.writeheader()
        for item in items:
            row = {
                col: (
                    "|".join(str(t) for t in item[col])
                    if isinstance(item.get(col), list)
                    else item.get(col, "")
                )
                for col in PRODUCT_COLUMNS
            }
            writer.writerow(row)

    print(f"Đã ghi {len(items)} sản phẩm → {out_path}")
    return out_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Export HEnull product results to CSV")
    parser.add_argument(
        "--input",
        default=str(RESULTS_FILE),
        help=f"File JSON đầu vào (default: {RESULTS_FILE})",
    )
    parser.add_argument("--out", default=None, help="Đường dẫn file CSV đầu ra (tùy chọn)")
    args = parser.parse_args()

    export_csv(
        results_file=Path(args.input),
        out_path=Path(args.out) if args.out else None,
    )


if __name__ == "__main__":
    main()
