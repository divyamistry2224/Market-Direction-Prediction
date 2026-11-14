"""Exercise real dashboard interactions against a local static server.

Install `pip install playwright==1.62.0`, then `playwright install chromium`.
An existing system Chromium is used when available. No external data or model
downloads are needed by the dashboard checks.
"""
import argparse
import csv
import functools
import http.server
import io
import json
import math
import os
from pathlib import Path
import shutil
import tempfile
import threading

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_): pass


def run(screenshots=None):
    handler = functools.partial(QuietHandler, directory=str(ROOT / "docs"))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}/"
    original = json.loads((ROOT / "docs/data/research.json").read_text())
    explorer = json.loads((ROOT / "docs/data/explorer.json").read_text())
    try:
        with sync_playwright() as p, tempfile.TemporaryDirectory() as temporary:
            executable = os.environ.get("BROWSER_EXECUTABLE") or shutil.which("chromium")
            browser = p.chromium.launch(headless=True, args=["--no-sandbox"], **({"executable_path": executable} if executable else {}))
            context = browser.new_context(viewport={"width": 1440, "height": 1050}, accept_downloads=True, permissions=["clipboard-read", "clipboard-write"])
            page = context.new_page()
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(base)
            page.locator("#research").wait_for(state="visible")
            assert "+12.1%" in page.locator("#overview-kpis").inner_text()
            page.locator("#overview-model").select_option("catboost__market_macro")
            assert "+37.3%" in page.locator("#overview-kpis").inner_text()
            page.locator("#overview-dataset").select_option("extension")
            assert "53.5%" in page.locator("#overview-kpis").inner_text()
            assert "-0.4%" in page.locator("#overview-kpis").inner_text()
            page.locator("#open-snapshot").click()
            assert page.locator("#overview").is_hidden()
            assert page.locator("#page-title").inner_text() == "Build your strategy."
            assert page.locator("#dataset").input_value() == "extension"
            assert "21 long positions" in page.locator("#lab-kpis").inner_text()

            page.locator("#dataset").select_option("original")
            page.locator("#model").select_option("catboost__market_macro")
            assert "+37.3%" in page.locator("#lab-kpis").inner_text()
            page.locator("#capital").fill("20000")
            page.locator("#capital").dispatch_event("change")
            page.locator("#period").select_option("2023")
            before = page.locator("#lab-kpis").inner_text()
            page.locator('[data-preset="cost"]').click()
            assert page.locator("#lab-kpis").inner_text() != before
            assert "10.0 bps" in page.locator("#cost-value").inner_text()
            page.locator('[data-chart="drawdown"]').click()
            assert page.locator("#lab-chart-title").inner_text() == "Distance from the peak"
            page.locator("#show-benchmarks").uncheck()
            assert page.locator("#lab-chart svg path").count() == 1
            page.locator('[data-chart="daily"]').click()
            assert page.locator("#lab-chart-title").inner_text() == "Daily net returns"

            page.locator("[data-month]").first.click()
            assert page.locator("#detail-dialog").is_visible()
            page.locator("[data-dialog-session]").first.click()
            assert "Signal observed after close" in page.locator("#dialog-body").inner_text()
            page.keyboard.press("Escape")
            assert page.locator("#detail-dialog").is_hidden()
            page.locator("#ledger-filter").select_option("active")
            page.locator("tr[data-session]").first.click()
            assert "20.0 bps" in page.locator("#dialog-body").inner_text()
            page.locator("#close-dialog").click()
            with page.expect_download() as download:
                page.locator("#download-scenario").click()
            csv_path = Path(temporary) / "scenario.csv"
            download.value.save_as(csv_path)
            rows = list(csv.DictReader(io.StringIO(csv_path.read_text())))
            assert len(rows) == len([row for row in original["observations"] if row["date"].startswith("2023")])
            wealth = 20000.
            for row in rows:
                expected = float(row["position"]) * (float(row["market_return"]) - .002)
                assert math.isclose(float(row["net_return"]), expected, abs_tol=1e-12)
                wealth *= 1 + expected
                assert math.isclose(float(row["equity_usd"]), wealth, rel_tol=1e-10)
            page.locator("#share-scenario").click()
            page.wait_for_function("document.querySelector('#toast').textContent.includes('Scenario link copied') || document.querySelector('.share-input')")
            shared = page.locator(".share-input").input_value() if page.locator(".share-input").count() else page.evaluate("navigator.clipboard.readText()")
            shared_page = context.new_page()
            shared_page.goto(shared)
            shared_page.locator("#research").wait_for(state="visible")
            assert shared_page.locator("#page-title").inner_text() == "Build your strategy."
            assert shared_page.evaluate("window.researchState().capital") == 20000
            assert shared_page.locator("#cost").input_value() == "10"
            assert shared_page.locator("#period").input_value() == "2023"
            assert shared_page.locator("#model").input_value() == "catboost__market_macro"
            shared_page.close()
            if page.locator("#detail-dialog").is_visible(): page.keyboard.press("Escape")

            page.locator('[data-tab="validation"]').click()
            page.locator('tr[data-model="catboost__market_macro"]').click()
            assert page.locator("#arena-detail-title").inner_text() == "CatBoost"
            assert sum(map(int, page.locator("#confusion b").all_text_contents())) == 1003
            page.locator('[data-prob-bin="5"]').click()
            assert "50–60% predicted probability" in page.locator("#dialog-title").inner_text()
            assert "Observed up-session frequency" in page.locator("#dialog-body").inner_text()
            page.keyboard.press("Escape")
            first_importance = page.locator("#importance").inner_text()
            first_calibration = page.locator("#calibration").inner_html()
            page.locator('tr[data-model="random_forest__full"]').click()
            assert page.locator("#arena-detail-title").inner_text() == "Random Forest"
            assert page.locator("#importance").inner_text() != first_importance
            assert page.locator("#calibration").inner_html() != first_calibration
            page.locator('tr[data-model="extra_trees__full"]').click()
            assert "not exported" in page.locator("#importance").inner_text()
            page.locator("#arena-family").select_option("CatBoost")
            assert page.locator("tr[data-model]").count() == 4
            page.locator("#arena-sort").select_option("return")
            assert page.locator("tr[data-model]").first.get_attribute("data-model") == "catboost__market_macro"
            page.locator("#arena-dataset").select_option("extension")
            assert page.locator("tr[data-model]").count() == 2
            page.locator('tr[data-model="reference"]').focus()
            page.keyboard.press("Enter")
            assert page.locator("#arena-detail-title").inner_text() == "Logistic"
            page.locator("#arena-family").select_option("Histogram GB")
            assert "No models from this family" in page.locator("#model-table").inner_text()
            page.locator("#arena-family").select_option("all")
            page.locator('[data-ablation="Random Forest"]').click()
            assert "Random Forest" in page.locator("#ablation").inner_text()

            page.locator('[data-tab="data"]').click()
            page.locator('[data-source="news_sentiment"]').click()
            previous = page.locator("#data-value").inner_text()
            page.locator("#data-date").fill("42")
            page.locator("#data-date").dispatch_event("input")
            assert page.locator("#data-date-label").inner_text() == explorer["original"][42]["date"]
            assert page.locator("#data-value").inner_text() != previous
            assert "FRANCISCO" in page.locator("#data-provider").inner_text()
            page.locator("#data-dataset").select_option("extension")
            assert page.locator("#data-date-label").inner_text() == explorer["extension"][-1]["date"]
            page.locator('[data-source="close"]').click()
            assert "SPY closing price" in page.locator("#data-title").inner_text()
            with page.expect_download() as download:
                page.locator("#download-data").click()
            data_path = Path(temporary) / "series.csv"
            download.value.save_as(data_path)
            data_rows = list(csv.DictReader(io.StringIO(data_path.read_text())))
            assert len(data_rows) == 120
            assert float(data_rows[-1]["close"]) == explorer["extension"][-1]["close"]
            page.locator("#open-guide").click()
            assert page.locator("#detail-dialog").is_visible()
            page.locator('#detail-dialog [data-go="lab"]').click()
            assert page.locator("#detail-dialog").is_hidden()
            assert page.locator("#page-title").inner_text() == "Build your strategy."
            page.locator('[data-tab="validation"]').click()
            page.locator('[data-tab="data"]').click()
            page.go_back()
            page.wait_for_function("document.querySelector('#page-title').textContent === 'Meet the models.'")

            for width, height in [(1440, 1050), (390, 844)]:
                page.set_viewport_size({"width": width, "height": height})
                for tab in ["overview", "lab", "validation", "data"]:
                    page.locator(f'[data-tab="{tab}"]').click()
                    page.wait_for_timeout(450)
                    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), (width, tab)
                    if screenshots:
                        directory = Path(screenshots); directory.mkdir(parents=True, exist_ok=True)
                        page.screenshot(path=str(directory / f"{tab}-{width}.png"), full_page=True)
            assert not errors, errors
            browser.close()
            print("PASS: tab-specific views; model/sample updates; costs, capital and chart views; monthly/session dialogs; scenario CSV and share-link replay; model diagnostics; actual data replay/export; keyboard/history; desktop/mobile layout")
    finally:
        server.shutdown();server.server_close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--screenshots", type=Path)
    run(parser.parse_args().screenshots)
