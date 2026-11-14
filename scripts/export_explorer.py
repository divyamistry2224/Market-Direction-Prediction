"""Export actual time-aligned feature observations for the interactive explorer.

No model is refitted and no performance result is changed.
"""
import json
from pathlib import Path

import pandas as pd

from market_direction.features import build
from market_direction.extension import V2

ROOT = Path(__file__).resolve().parents[1]
METRICS = ["close", "news_sentiment", "vix", "yield_curve", "fed_funds", "inflation_yoy", "unemployment"]


def export():
    result = {}
    for name, root, start, end in [("original", ROOT, "2022-01-01", "2025-12-31"), ("extension", V2, "2026-01-01", "2026-10-30")]:
        frame = build(root)
        frame = frame.loc[frame.trade_date.between(start, end)]
        rows = []
        for _, record in frame.iterrows():
            row = {"date": record.signal_date.strftime("%Y-%m-%d"), "trade_date": record.trade_date.strftime("%Y-%m-%d")}
            for metric in METRICS:
                row[metric] = round(float(record[metric]), 7)
                available = record.get(f"{metric}_available_date", record.signal_date)
                row[f"{metric}_available_date"] = pd.Timestamp(available).strftime("%Y-%m-%d")
            rows.append(row)
        result[name] = rows
    target = ROOT / "docs/data/explorer.json"
    target.write_text(json.dumps(result, separators=(",", ":"), allow_nan=False) + "\n")
    print(f"Exported {sum(map(len, result.values()))} actual feature observations to {target}")


if __name__ == "__main__": export()
