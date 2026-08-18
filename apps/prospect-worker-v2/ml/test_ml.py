"""Tests for the ML pipeline that need no database.

Covers the two properties that would be most damaging to get wrong:
leakage detection and the phase gate. Both are checked against synthetic
data so they run anywhere, including CI with no Postgres.

Run:
    cd apps/prospect-worker-v2 && python -m pytest ml/test_ml.py -q
    (or, with no pytest available)  python ml/test_ml.py
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from dataset import (
    CATEGORICAL_COLUMNS,
    Dataset,
    LeakageError,
    assert_no_leakage,
    encode_features,
    tribool_to_float,
)
from train import (
    MIN_POSITIVE_LABELS,
    MIN_TOTAL_ROWS,
    assess_phase,
    evaluate,
    train_model,
)


FORBIDDEN = ["replied", "positive_reply", "delivered", "read", "claimed", "activated", "paid"]


def make_dataset(*, rows: int, positive_rate: float, templates: int = 3, seed: int = 7) -> Dataset:
    """Synthetic but structurally realistic: a genuine signal plus noise."""
    rng = np.random.default_rng(seed)

    frame = pd.DataFrame(
        {
            "country": rng.choice(["FR", "GB"], size=rows),
            "shop_type": rng.choice(["barbershop", "independent_barber"], size=rows),
            "booking_provider": rng.choice(["PLANITY", "BOOKSY", "NO_BOOKING"], size=rows),
            "template_key": rng.choice([f"tmpl_{i}" for i in range(templates)], size=rows),
            "sales_angle": rng.choice(["ONLINE_BOOKING", "COMPETITOR_MIGRATION"], size=rows),
            "locale": rng.choice(["fr-FR", "en-GB"], size=rows),
            "send_weekday": rng.integers(0, 7, size=rows),
            "rating": rng.uniform(3.0, 5.0, size=rows),
            "review_count": rng.integers(0, 500, size=rows),
            "estimated_barber_count": rng.integers(1, 8, size=rows),
            "fadeup_fit_score": rng.integers(0, 100, size=rows),
            "migration_potential_score": rng.integers(0, 100, size=rows),
            "competitor_tenure_days": rng.uniform(0, 900, size=rows),
            "website_quality_score": rng.integers(0, 100, size=rows),
            "digital_gap_score": rng.integers(0, 100, size=rows),
            "send_hour": rng.integers(8, 20, size=rows),
            "has_website": rng.choice(["TRUE", "FALSE", "UNKNOWN"], size=rows),
            "mobile_ready": rng.choice(["TRUE", "FALSE", "UNKNOWN"], size=rows),
            "booking_detected": rng.choice(["TRUE", "FALSE", "UNKNOWN"], size=rows),
            "instagram_presence": rng.choice(["TRUE", "FALSE", "UNKNOWN"], size=rows),
            "multi_barber": rng.choice(["TRUE", "FALSE", "UNKNOWN"], size=rows),
        }
    )

    X = encode_features(frame)

    # A real (if modest) relationship, so a model has something to find.
    logit = -3.0 + 0.02 * frame["fadeup_fit_score"] + 0.9 * (frame["template_key"] == "tmpl_0")
    probability = 1 / (1 + np.exp(-logit))
    probability = probability * (positive_rate / probability.mean())
    y = pd.Series((rng.uniform(size=rows) < probability.clip(0, 1)).astype(int))

    return Dataset(
        version="ds-test",
        target="positive_reply",
        feature_schema_version="fs-v1",
        X=X,
        y=y,
        identifiers=pd.DataFrame(index=X.index),
        snapshot_from=None,
        snapshot_to=pd.Timestamp.now("UTC").to_pydatetime(),
        random_seed=seed,
    )


def test_tribool_unknown_is_nan_not_zero() -> None:
    assert tribool_to_float("TRUE") == 1.0
    assert tribool_to_float("FALSE") == 0.0
    # The whole point: UNKNOWN must not collapse onto FALSE.
    assert np.isnan(tribool_to_float("UNKNOWN"))
    assert np.isnan(tribool_to_float("NOT_APPLICABLE"))
    assert np.isnan(tribool_to_float(None))


def test_encode_features_produces_inference_compatible_names() -> None:
    frame = pd.DataFrame({"country": ["FR"], "template_key": ["no_booking_fr_v1"], "rating": [4.5]})
    X = encode_features(frame)
    # These names must match buildFeatureMap() in src/ml/inference.ts.
    assert "country=FR" in X.columns
    assert "template_key=no_booking_fr_v1" in X.columns
    assert "rating" in X.columns


def test_assert_no_leakage_accepts_clean_matrix() -> None:
    dataset = make_dataset(rows=50, positive_rate=0.2)
    assert_no_leakage(dataset.X, FORBIDDEN)


def test_assert_no_leakage_rejects_outcome_column() -> None:
    dataset = make_dataset(rows=50, positive_rate=0.2)
    leaked = dataset.X.copy()
    leaked["replied"] = 1.0

    try:
        assert_no_leakage(leaked, FORBIDDEN)
    except LeakageError as error:
        assert "replied" in str(error)
    else:
        raise AssertionError("expected LeakageError for a post-outcome feature")


def test_assert_no_leakage_rejects_one_hot_derived_from_outcome() -> None:
    """A one-hot of a forbidden column is still leakage, under a different name."""
    dataset = make_dataset(rows=50, positive_rate=0.2)
    leaked = dataset.X.copy()
    leaked["replied=True"] = 1.0

    try:
        assert_no_leakage(leaked, FORBIDDEN)
    except LeakageError as error:
        assert "replied=True" in str(error)
    else:
        raise AssertionError("expected LeakageError for a one-hot encoded outcome")


def test_phase_gate_refuses_empty_dataset() -> None:
    dataset = make_dataset(rows=0, positive_rate=0.0)
    verdict = assess_phase(dataset)
    assert not verdict.can_train
    assert verdict.phase == "PHASE_0_RULES"


def test_phase_gate_refuses_small_dataset() -> None:
    dataset = make_dataset(rows=MIN_TOTAL_ROWS - 50, positive_rate=0.3)
    verdict = assess_phase(dataset)
    assert not verdict.can_train
    assert verdict.phase == "PHASE_0_RULES"


def test_phase_gate_refuses_too_few_positives() -> None:
    dataset = make_dataset(rows=MIN_TOTAL_ROWS + 300, positive_rate=0.01)
    verdict = assess_phase(dataset)
    if dataset.positive_count < MIN_POSITIVE_LABELS:
        assert not verdict.can_train
        assert verdict.phase == "PHASE_1_AB_TESTING"


def test_phase_gate_refuses_single_template() -> None:
    dataset = make_dataset(rows=800, positive_rate=0.25, templates=1)
    verdict = assess_phase(dataset)
    assert not verdict.can_train
    assert "template" in verdict.reason.lower()


def test_phase_gate_allows_sufficient_data() -> None:
    dataset = make_dataset(rows=1200, positive_rate=0.25, templates=3)
    verdict = assess_phase(dataset)
    assert verdict.can_train
    assert verdict.phase == "PHASE_3_SUPERVISED_ML"


def test_evaluate_reports_ranking_metrics_not_accuracy() -> None:
    y_true = np.array([0, 0, 0, 1, 0, 1, 0, 0, 1, 0])
    y_prob = np.array([0.1, 0.2, 0.15, 0.9, 0.3, 0.8, 0.05, 0.25, 0.7, 0.1])
    metrics = evaluate(y_true, y_prob)

    assert "roc_auc" in metrics
    assert "pr_auc" in metrics
    assert "lift_at_10pct" in metrics
    assert "brier_score" in metrics
    # Accuracy is deliberately not reported: at a 4% base rate it is
    # actively misleading (spec §35).
    assert "accuracy" not in metrics
    assert metrics["roc_auc"] > 0.9


def test_evaluate_handles_single_class_split() -> None:
    metrics = evaluate(np.array([0, 0, 0]), np.array([0.1, 0.2, 0.3]))
    assert metrics == {"undefined_single_class": 1.0}


def test_train_model_exports_loadable_artifact(tmp_path=None) -> None:
    import json
    import tempfile
    from pathlib import Path

    directory = Path(tmp_path) if tmp_path else Path(tempfile.mkdtemp())
    dataset = make_dataset(rows=1200, positive_rate=0.25, templates=3)

    outcome = train_model(
        dataset,
        model_type="logistic_regression",
        artifact_dir=directory,
        model_key="template_selector",
        model_version="test-v1",
    )

    assert outcome.trained
    assert outcome.artifact_path is not None
    assert outcome.validation_metrics is not None
    assert outcome.baseline_metrics is not None

    artifact = json.loads(Path(outcome.artifact_path).read_text())

    # The shape src/ml/inference.ts validates before it will use a model.
    assert artifact["modelType"] == "logistic_regression"
    for key in ("featureNames", "coefficients", "featureMeans", "featureScales", "featureImputations"):
        assert len(artifact[key]) == len(artifact["featureNames"])
    assert isinstance(artifact["intercept"], float)
    assert artifact["datasetFingerprint"]


def test_train_model_refuses_when_phase_gate_fails() -> None:
    import tempfile
    from pathlib import Path

    dataset = make_dataset(rows=20, positive_rate=0.3)
    outcome = train_model(
        dataset,
        model_type="logistic_regression",
        artifact_dir=Path(tempfile.mkdtemp()),
        model_key="template_selector",
        model_version="test-v2",
    )

    assert not outcome.trained
    assert outcome.artifact_path is None
    assert "deterministic" in outcome.reason.lower() or "rule" in outcome.reason.lower()


def _run_all() -> int:
    """Minimal runner so the file works without pytest installed."""
    failures = 0
    for name, function in sorted(globals().items()):
        if not name.startswith("test_") or not callable(function):
            continue
        try:
            function()
            print(f"  PASS  {name}")
        except Exception as error:  # noqa: BLE001 - a test runner must catch everything
            failures += 1
            print(f"  FAIL  {name}: {type(error).__name__}: {error}")
    print(f"\n{'FAILED' if failures else 'OK'} — {failures} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(_run_all())
