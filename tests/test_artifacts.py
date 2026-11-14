"""Verify committed measured results and prevent accidental metric drift."""
import json

import numpy as np
import pandas as pd
import pytest

from market_direction.data import ROOT, verify
from market_direction.evaluation import classification, finance, returns_for
from market_direction.extension import V2, candidates, enhanced


def test_original_selection_uses_validation_not_test_return():
    r = json.loads((ROOT / "reports/metrics.json").read_text())
    selected = max(r["models"], key=lambda m: (m["cv_balanced_accuracy"], m["cv_roc_auc"]))
    assert r["selected_model"] == selected["id"]
    assert r["benchmarks"]["buy_and_hold_close_to_close"]["round_trips"] == 1


def test_prediction_accounting_matches_published_metrics():
    r = json.loads((ROOT / "reports/metrics.json").read_text())
    predictions = pd.read_csv(ROOT / "reports/predictions.csv")
    assert not predictions[["model", "date"]].duplicated().any()
    for model in r["models"]:
        rows = predictions.loc[predictions.model == model["id"]]
        assert len(rows) == r["holdout"]["rows"]
        position, net = returns_for(rows.probability_up, rows.market_return, .55, 2.)
        np.testing.assert_allclose(net, rows.net_return, atol=1e-8)
        assert finance(net, position)["total_return"] == pytest.approx(model["strategy"]["total_return"], abs=1e-6)


def test_extension_sources_and_feature_timing():
    verify(V2)
    frame = enhanced()
    assert (frame.trade_date > frame.signal_date).all()
    for col in frame.filter(like="_available_date"):
        assert (frame[col] <= frame.signal_date).all()
    assert frame.trade_date.max() <= pd.Timestamp("2026-10-30")


def test_extension_winner_matches_frozen_development_selection():
    r = json.loads((V2 / "reports/metrics.json").read_text())
    selection = json.loads((V2 / "reports/development_selection.json").read_text())
    assert len(candidates()) == r["candidate_count"] == len(selection["candidates"]) == 32
    best = max(selection["candidates"], key=lambda s: (s["cv_balanced_accuracy"], s["cv_auc"]))
    assert r["selected"] == best == selection["selected"]
    assert r["trade_threshold"] == pytest.approx(r["selected"]["threshold"] + .03)


def test_extension_probabilities_and_labels_reproduce_metrics():
    r = json.loads((V2 / "reports/metrics.json").read_text())
    p = pd.read_csv(V2 / "reports/predictions.csv")
    assert (pd.to_datetime(p.signal_date) < pd.to_datetime(p.date)).all()
    assert pd.to_datetime(p.date).min() > pd.Timestamp(r["development"]["train_end"])
    score = classification(p.actual_up, p.probability_up, r["selected"]["threshold"])
    assert score["balanced_accuracy"] == pytest.approx(r["classification"]["balanced_accuracy"])
    position, net = returns_for(p.probability_up, p.market_return, r["trade_threshold"], 2.)
    assert finance(net, position)["total_return"] == pytest.approx(r["strategy"]["total_return"], abs=1e-7)


def test_profit_focused_selection_is_not_best_test_return():
    r = json.loads((ROOT / "reports/profitability.json").read_text())
    assert r["selected_on_validation"] == max(r["models"], key=lambda m: m["cv_net_sharpe"])["id"]


def test_browser_bundle_matches_canonical_predictions():
    bundle = json.loads((ROOT / "docs/data/research.json").read_text())
    canonical = pd.read_csv(ROOT / "reports/predictions.csv")
    for model, probabilities in bundle["probabilities"].items():
        np.testing.assert_allclose(probabilities, canonical.loc[canonical.model == model, "probability_up"], atol=1e-7)
    assert len(bundle["observations"]) == bundle["report"]["holdout"]["rows"]


def test_data_explorer_exports_actual_available_features():
    from market_direction.features import build
    exported = json.loads((ROOT / "docs/data/explorer.json").read_text())
    for sample, root, start, end in [("original", ROOT, "2022-01-01", "2025-12-31"), ("extension", V2, "2026-01-01", "2026-10-30")]:
        frame = build(root)
        frame = frame.loc[frame.trade_date.between(start, end)].reset_index(drop=True)
        rows = exported[sample]
        assert len(rows) == len(frame)
        for index in [0, len(rows) // 2, len(rows) - 1]:
            row = rows[index]
            assert row["date"] == str(frame.signal_date.iloc[index].date())
            for field in ["close", "news_sentiment", "vix", "yield_curve", "fed_funds", "inflation_yoy", "unemployment"]:
                assert row[field] == pytest.approx(frame[field].iloc[index], abs=1e-7)
                assert row[field + "_available_date"] <= row["date"]
