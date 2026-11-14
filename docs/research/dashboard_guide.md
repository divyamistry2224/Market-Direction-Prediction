# Using the research workbench

The dashboard has four distinct screens. Changing tabs replaces the workspace
header and content; the overview introduction is not repeated on every screen.
All displayed outcomes come from the committed prediction artifacts. The
controls recalculate historical scenarios, not model training.

## Overview

Choose a sample and model. The return, balanced accuracy, Sharpe, drawdown and
equity curve all refer to that same selection. Open that exact setup in the
builder, or choose a question card to jump into a relevant working view.
Click a chart date to inspect the session's probability, decision and costs.

## Strategy builder

Choose a model, period, initial capital, probability threshold and per-side
cost. Presets load research defaults, higher costs, higher confidence, or
greater participation. All metrics, charts, monthly cells and ledger entries
recalculate together.

- Switch between portfolio value, drawdown and daily net returns.
- Toggle benchmark lines to inspect the strategy alone.
- Click a monthly cell for its sessions, then click a session for its details.
- Filter the ledger to long positions or cash sessions.
- Export a CSV of the current scenario, including probabilities, positions,
  costs, net returns and dollar equity.
- Copy a scenario link to reopen the same sample, model, period, threshold,
  costs and capital. The link does not include personal or account data.

Every active session is a separate next-open-to-close round trip. Initial
capital changes dollar values, not percentage returns. Presets are scenarios,
not new independent tests or trading recommendations.

## Model arena

Filter by sample and family, and change the ranking metric. Select a model row
to update its direction confusion matrix, probability reliability chart,
confidence distribution and recorded training importance. Click a confidence
bar to inspect the count and actual up-session frequency in that band.

Importance that was not saved for a particular fit is explicitly marked as
unavailable; the dashboard does not substitute a different model's bars.
Sorting by historical returns does not change the recorded validation winner.
The ablation buttons compare the original CatBoost and Random Forest folds.

## Data explorer

Choose SPY price, news sentiment, VIX, the yield curve, policy rate, CPI inflation
or unemployment. Move the date slider or click the chart to replay the selected
signal session. Values, source notes, assumed availability dates, and the
observation table update together. Export downloads the visible observations.

The explorer uses `docs/data/explorer.json`, generated from the actual
time-aligned feature frames by `python scripts/export_explorer.py`. These are
latest-vintage downloads; the availability assumptions do not eliminate
revisions or establish point-in-time tradability.

## Accessibility and checks

Metric help buttons explain terms in plain language. The How to use button
opens a guided tour. Dialogs support Escape and focus containment. Model rows
work with Enter or Space; chart points support arrow keys and Enter. Browser
Back/Forward restores the workspace tab. Tables scroll within their cards on
narrow screens, and reduced-motion preferences are respected.

Run the interaction checks with:

```bash
pip install playwright==1.62.0
python -m playwright install chromium
python scripts/check_dashboard.py
```

Checks cover live scenario calculations and CSV accounting, scenario-link
replay, model-specific diagnostics, data replay/export, dialogs, keyboard and
history navigation, and desktop/mobile overflow. GitHub Actions runs these
checks alongside the research integrity tests.
