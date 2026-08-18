# Worker V2 — Data Science

The honest version: **there is currently no trained model, and that is the
correct state.**

---

## The phased strategy

| Phase | When | What runs |
|---|---|---|
| **0 — Rules** | No outreach outcomes yet | Deterministic template ranking: locale, then competitor targeting, then segment targeting, then sales-angle priority |
| **1 — A/B testing** | Some volume, too few labels | Controlled experiments generate the labelled outcomes a model would need |
| **2 — Statistical analysis** | Enough per-arm samples | Read `experiment_results`; `reached_min_sample` guards against calling a winner on four sends |
| **3 — Supervised ML** | ≥200 sent, ≥30 positives, ≥2 templates | Logistic regression or gradient-boosted trees, ranking rule-eligible candidates |
| **4 — Contextual bandit** | Sustained volume | Interfaces exist; deliberately not deployed |

`ml/train.py` enforces the Phase 3 gate **mechanically**. Below the
thresholds it refuses to fit and records a run with
`status = 'skipped_insufficient_data'` and a written reason. That refusal
is a *successful* outcome, not a failure — a model fitted on 12 replies
would be noise wearing a ROC-AUC as a disguise.

Why those numbers: with fewer than ~30 positive examples a validation
split holds single digits of the minority class, and the resulting AUC has
a confidence interval wide enough to contain "no better than random".
Fewer than 2 distinct templates and the model learns *which template we
happened to send*, not which template works.

---

## What ML is allowed to do

**Only rank templates the rules already deemed eligible.**

It cannot introduce a template, override a locale, influence eligibility,
or write copy. Eligibility is SQL; copy is an approved template row. If
inference fails, is slow, or no model is promoted, `selectTemplate()` falls
through to the deterministic rule winner and outreach continues unaffected.

---

## Data leakage

`ml_feature_schemas.forbidden_features` is a machine-checkable denylist:
`replied`, `positive_reply`, `delivered`, `read`, `claimed`, `activated`,
`paid`, and the corresponding timestamps.

`assert_no_leakage()` runs on the **encoded** matrix, because one-hot
encoding turns `replied` into `replied=True` and an exact-name check would
miss it. It also rejects any column whose name merely mentions an outcome.
Structurally, labels and identifiers are dropped before encoding — the
assertion is the belt-and-braces check on top.

One subtle case handled explicitly: `competitor_tenure_days` is computed
as of `sent_at`, not as of today. Using today's date would leak
information from after the prediction moment.

---

## Artifacts are JSON, never pickles

`export_logistic_artifact()` writes coefficients, intercept, scaler
statistics and imputation values as plain JSON.

Unpickling a Python object inside the Worker process would be arbitrary
code execution by design. A JSON coefficient vector cannot execute
anything — and it means inference needs no Python runtime at all
(`src/ml/inference.ts` is a dot product).

`ModelCache` additionally refuses any registry `artifact_path` containing
`..` or falling outside `ML_ARTIFACT_DIR`, because that column is
writable by platform admins.

---

## Metrics

Reported: **ROC-AUC, PR-AUC, log loss, Brier score, calibration MAE, lift
at 10%/20%, precision at 50% recall, base rate.**

**Accuracy is deliberately absent.** At a 4% reply rate, a model that
predicts "never replies" scores 96% accuracy and is completely useless.

Every training run also evaluates a **baseline** that predicts the base
rate for everyone. A model that does not beat that baseline's PR-AUC by
more than 5% is flagged `beats_baseline = false`. Reporting a model's AUC
without this comparison is how meaningless models get promoted.

---

## Promotion is a human act

`ml_model_versions.is_active` requires `promoted_by`, `promoted_at` **and**
`evaluation_notes` — enforced by a CHECK constraint. A freshly-trained
model can never become production by merely existing.

`public.promote_ml_model(id, notes)` refuses a blank note, demotes the
incumbent in the same transaction, and requires the platform admin role.
A partial unique index guarantees at most one active model per
`(model_key, target)`.

`public.retire_ml_model(id)` is the kill switch: retiring the active model
returns selection to the deterministic rules immediately.

---

## Prediction audit trail

`ml_predictions` is append-only — no UPDATE or DELETE grant for anyone,
including the Worker.

Every candidate is stored, not just the winner:

```
prospect X, template A → 0.13
prospect X, template B → 0.21   selected
prospect X, template C → 0.07
```

So a past recommendation stays reconstructable, with its model version and
feature snapshot, indefinitely.

---

## Experiments

Arm assignment is `sha256(assignment_seed + prospect_id)` — no RNG, no
timestamp. The same prospect always lands in the same arm, on any machine,
forever. That is what makes an experiment auditable and prevents a re-run
of campaign preparation from silently re-randomising a cohort mid-flight.

Guards:
- `UNIQUE (experiment_id, prospect_id)` — never re-randomised
- `assert_experiment_exposure_limits()` — respects
  `max_experiments_per_prospect` and `cooldown_days`
- Exploration percentage caps how much of a cohort is experimented on
- An arm's template must be in the rule-eligible candidate set; an
  experiment can choose between valid options, never authorise an invalid
  one
- `assignment_seed` is not exposed to the frontend — reading it would let
  someone predict cohort membership

---

## The objective

The funnel runs to **PAID**, and templates are compared on activation and
paid rate.

Optimising for replies optimises for curiosity. Optimising for read rate
optimises for nothing at all — which is why `ml_model_target` contains no
`delivered` or `read` value, asserted by VERIFY.

---

## Commands

```bash
cd apps/prospect-worker-v2

python3 ml/test_ml.py                                          # 14 tests, no DB
python3 ml/dataset.py --version ds-2026-08-18 --register       # build + register
python3 ml/train.py --version lr-2026-08-18                    # train (may correctly refuse)
python3 ml/train.py --version lr-2026-08-18 --model-type gradient_boosted_trees
```

Training is never run automatically on worker boot. Promotion is never
automatic. Both are deliberate acts.
