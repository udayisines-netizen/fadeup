# R4 — Worker V2 Core & Acquisition Engine

Status: **Complete (2026-08-28).** Applied to the live database, worker
deployed, verified against real discovery.

---

## 1. What R4 was actually for

Constitution §5.1 states the acquisition pipeline as:

```
SOURCE → SOURCE OBSERVATION → NORMALIZED CANDIDATE → CANONICAL PROSPECT
       → PUBLIC ELIGIBILITY → EXTERNAL UNCLAIMED PROFILE → CLAIM
       → CLAIMED PROFESSIONAL / BUSINESS
```

Everything **before** PUBLIC ELIGIBILITY shipped in August and is production
quality: the Worker's six sources, its normalizers, identity resolution,
enrichment, competitor detection, feature engineering and two scores. R4 changed
none of it, exactly as the roadmap required.

Everything **after** it shipped in R1B: `create_external_professional` mints an
unclaimed identity, `professional_claims` lets a real person take it over.

PUBLIC ELIGIBILITY did not exist anywhere. Nothing decided *which* canonical
prospects deserve a durable FadeUp identity. The R1B report says so plainly —
"the RPC and its grants exist; nothing calls it yet" — which means the only
thing standing between one scrape and a permanent, claimable, public-facing
FadeUp identity was that no code had reached the RPC.

**That is not a safe default. It is an unexercised one**, and it is what R4
closed.

R4 also wired the two acquisition analytics contracts R3 wrote and deferred,
built the two operator screens the decisions require, deployed the Worker for
the first time, and — by actually running it — found and fixed a defect in the
discovery core that had been silently fabricating empty search results.

---

## 2. What shipped

| Artefact | What it is |
| --- | --- |
| `20260828100000_prospect_publication_eligibility.sql` | The live gate, the cached verdict, the refresh RPC and the Worker sweep |
| `20260828100100_external_profile_publication.sql` | The enforcement trigger, the operator's front door, the queue view, the new job type |
| `20260828100200_acquisition_analytics_events.sql` | `prospect_discovered` / `prospect_enriched` wired; the funnel gains its head |
| `20260828100300_r4_privilege_hardening.sql` | Revokes, re-grants by name, and eight assertions that refuse to commit if the posture is wrong |
| `src/jobs/publication-evaluation.ts` | The Worker job that evaluates and cannot publish |
| `src/sources/osm.ts`, `src/retry.ts` | The silent-zero fix (§7) |
| `platform-acquisition-publication-page.tsx` | The publication review queue |
| `platform-acquisition-claims-page.tsx` | The claim review queue R1B never had |
| `VERIFY_R4_…`, `SEED_R4_…`, `MASTER_R4_…`, `generate-master-r4.sh` | 101 PASS / 0 FAIL upgrade path, 94 / 0 fresh |

One new table. One new column. One new view. Five new functions. Three new
triggers. One rewritten CHECK constraint.

---

## 3. The gate

`public.publication_block_reason(uuid)` returns the **first** blocking reason as
text, or NULL when publishable. It mirrors `public.outreach_block_reason`
deliberately, down to the single-reason return: the operator screen shows one
reason and one remedy, and a list invites arguing with the least important
entry.

It is **strictly more conservative** than the outreach gate beside it, and the
reason is not caution for its own sake. Outreach asks "may we CONTACT this
business?" — a message is transient and a person can reply to it. Publication
asks "may we MINT A DURABLE IDENTITY for this business inside FadeUp?" — an
identity persists, is claimable, and is what R10 will eventually make publicly
visible.

The eleven reasons, in the order they are evaluated:

| Reason | Why |
| --- | --- |
| `prospect_not_found` | |
| `do_not_contact` | A business that opted out of contact has not consented to being catalogued either. A shop that opted out and then found its own name minted as a FadeUp identity would be right to consider the opt-out a lie. |
| `suppressed_prospect` / `_phone` / `_email` / `_domain` | Outreach suppression reused as publication suppression, for the same reason. |
| `already_converted` | A converted business gets its identity from its own account. A second unclaimed one would compete with the real thing. |
| `already_customer` | Same. |
| `entity_kind_not_publishable` | A `group_parent` is a chain umbrella, not a person or shop anyone can claim. Its locations are the publishable entities. |
| `already_published` | Checked before the evidence rules, so a re-run reports the honest reason rather than re-litigating evidence already accepted. |
| `name_not_publishable` | `create_external_professional` copies `canonical_name` straight onto `display_name`. Two characters of actual letters is a low bar that still rejects `—`, `42`, a lone punctuation run. |
| `unresolved_duplicate` | Constitution §5.3. Checked in **both** directions of the candidate pair — otherwise two people could each claim half of one real business. |
| `insufficient_source_evidence` | Constitution §5.1's "never one scraper result = one professional", enforced rather than merely measured: **two independent sources, or one verified registry.** |
| `no_corroborating_location` | Needs a `prospect_locations` row or a website domain. `prospects.country` is NOT NULL and is therefore evidence of nothing. |

### 3.1 Trust anchors are data

`prospect_sources.is_identity_trust_anchor` decides which single source is
sufficient on its own. Seeded true for `sirene` only: a SIRET is a verified
legal identity, whereas OSM, Geoapify, Google Places, the website crawler and
Instagram are observations of a *presence*, which is a weaker claim.

It is a column rather than a hardcoded key because "which sources are
registries" is an operator fact that changes as sources are added, and adding
one should be a data change somebody can see rather than a migration nobody
re-reads. Default `false`: a new source earns this deliberately, never by
arriving.

### 3.2 What the gate deliberately does NOT consult

Not one of the eleven reasons reads `fadeup_fit_score`, `migration_potential`,
`current_score` or any segment. **"Is this a real business we can name
correctly" and "is this a good sales lead" are different questions**, and
publication asks only the first. The operator screen shows no score either, for
the same reason — putting one next to a Publish button pushes somebody towards
publishing the high-scoring one.

---

## 4. The wall, and why it is not the RPC

The guarantee is a `BEFORE INSERT` trigger on `prospect_professionals`, not a
check inside `publish_external_professional`.

Every path that could mint an external identity passes through that INSERT. So
the gate cannot be bypassed by choosing a different function, a different role,
or a direct session. There is **no role exemption**, including for platform
administrators, `service_role` and `postgres` — which owns the table and holds
`BYPASSRLS`, meaning no RLS policy could refuse it and the trigger does anyway.

VERIFY §3.3 is the load-bearing test: a direct `INSERT` as `postgres` is
refused, with the reason named in the message. It was also run against the
**live** database after deployment, on a real scraped prospect, and refused.

`publish_external_professional` is the door in that wall: platform-admin only,
re-checks the gate first so the caller gets a named reason instead of a trigger
exception, locks the prospect row so a double-clicked Approve produces one
identity rather than a 23505, writes `platform_audit_log` with the name **as
published**, and refreshes the cache so the queue reflects the decision at once.

> The door without the wall is a suggestion. The wall without the door is a
> wall with no door.

### 4.1 The cache is not the guarantee

`prospect_publication_eligibility` is a refreshed **copy** of the gate's verdict,
existing so the operator queue can page candidates without running an
eleven-branch plpgsql function per row over the whole `prospects` table.

It can go stale between Worker sweeps, and that is tolerable **precisely
because** the trigger consults the live function. A stale cache can therefore
show an operator a candidate that turns out to be blocked; it can never let a
blocked prospect be published.

The table has **no** INSERT/UPDATE/DELETE policy for any role — including
`prospect_worker`, which writes every other acquisition table directly. A forged
`is_eligible = true` would not actually permit a publication, but it would put a
lie in front of the administrator who approves one, and **their judgement is the
control this lot rests on**.

---

## 5. The machine evaluates; a human decides

`prospect_worker` has EXECUTE on the gate and the sweep, and is explicitly
**revoked** from `publish_external_professional` — asserted inside the migration
itself, so a later lot that wants a bounded auto-publish lane has to delete an
assertion somebody wrote down on purpose.

The `publication_evaluation` job holds no copy of the eligibility rules. A second
implementation in TypeScript would be a second answer to "may this be
published", and the one that matters is the one the trigger consults. Its tests
assert the **absence** of behaviour: no code path, in any mode, issues a
publishing statement.

The sweep re-evaluates **blocked** prospects too. Almost every interesting
transition is blocked → eligible: a duplicate gets reviewed, a second source
lands, a crawl finds the website that satisfies corroboration. None of those
touch the eligibility row, so a sweep that only looked at unevaluated prospects
would fill the queue once and then go quiet while real candidates piled up
behind stale verdicts.

### 5.1 What R4 deliberately did not build

* **No auto-publication of any kind.** R10 owns discovery at scale and may add a
  bounded auto-publish lane *on top of* this gate; it must not replace it.
* **No manual eligibility override.** There is no column an operator can set to
  force a prospect eligible, because the gate's whole value is that its answer
  is derived from evidence. An operator who disagrees should fix the evidence —
  resolve the duplicate, add the second source — not overrule it.
* **No changes to discovery, enrichment, dedupe, scoring or outreach**, beyond
  the defect fix in §7.

---

## 6. The funnel gains its head

R3 wrote `prospect_discovered` and `prospect_enriched` and marked them
`deferred`, which by construction cannot emit a single row. So the funnel R3
documented started three stages in, at `external_profile_created`: it could
report how many identities FadeUp published, not how many businesses had to be
found to publish them.

Both are now `wired`, and both are emitted by AFTER triggers on tables the
Worker already writes — **not** by granting the Worker the analytics emitter.
R3 §11.3 refused that grant on the grounds that a scraping worker is the
highest-risk credential in the system, and R1A had already removed a broader
grant from the same role. That reasoning has not changed, so R4 did not change
the grant. The Worker gets its events by doing its job, not by holding a
capability.

**`prospect_discovered` hangs on `prospect_source_records`, not on `prospects`.**
The prospect row is inserted *before* its provenance — the Worker resolves
identity, inserts or links the canonical prospect, and only then records which
source saw it. A trigger on `prospects` would fire at the one moment when
"which channel found this business" does not yet exist, and would attribute
every discovery to NULL. This is the same decision R3 made for
`external_profile_created`, for the same reason.

The dedupe key is the **prospect**, so a business found by four sources produces
four provenance rows and exactly one discovery. Attribution is **first-touch**:
the question acquisition asks is which channel found a business nobody had, and
a later re-observation by a second source found nothing.

`prospect_enriched` is deliberately **not** idempotent, per R3's own contract:
re-enrichment is legitimate and each pass is a real event, so its key is scoped
to the enrichment timestamp rather than to the prospect. Its properties are
booleans about what a pass established — `gained_website`, `gained_contact` —
never the values found, because R3 §10.1 refuses contact data in payloads and an
enrichment count does not need the phone number to record that one was found.

`get_platform_analytics_funnel` gained `prospects_discovered` and
`prospects_enriched`. Discoveries are counted as DISTINCT prospects, restating
the emitter's guarantee at read time so neither end can inflate the funnel
alone; enrichment counts **passes**, because re-enrichment is what the metric is
for and collapsing it would report a re-crawled table as idle.

Three of R3's five deferred contracts remain: `claim_started`, `passport_viewed`,
`entitlement_blocked_action`.

---

## 7. The defect deploying it found

R4 is the first lot to actually run the Worker. A bounded discovery job over
central Lyon completed cleanly:

```
status = completed, candidates_found = 0, error = null
```

OSM holds **367** hairdressers inside that radius.

Overpass does not return 429 or 503 under load. It returns **HTTP 200** with
`{"elements": [], "remark": "runtime error: Query timed out in \"query\" at line
5 after 27 seconds."}`. The adapter parsed that as an empty result, and every
layer beneath faithfully recorded a successful sweep that found nothing.

This is the failure `acquisition-intelligence.md`'s first rule exists to
forbid — *"a website crawl that timed out tells us NOTHING… recording that as
FALSE would manufacture a signal out of an infrastructure failure"* — one stage
earlier than the rule was written about. And the consequence is worse here than
a wrong tribool: `prospect_job_sources.candidates_found` feeds the search
planner's saturation and yield-guard arithmetic, so **a timed-out geographic
cell looks exhausted and is never revisited**. The discovery would not merely be
missing; it would be recorded as already done.

Two changes:

1. A `remark` whose wording means the query did not run raises
   `OverpassRuntimeError`, classified retryable **by name** rather than by the
   unclassified default, so `prospect_jobs.last_error` reads "upstream query
   engine overloaded" instead of nothing. Advisory remarks — the attribution
   notice, truncation warnings — are still tolerated, because the field's
   presence is not itself a failure.

2. The three clauses became two requests. `node[shop=beauty][name~barber,i]` is
   a case-insensitive regex over every beauty shop in the radius and is what
   exhausts the server-side budget — line 5 of the union is exactly what the
   remark named. Overpass evaluates a union as one statement, so that
   **speculative low-confidence fallback was taking the high-confidence primary
   result down with it**. Split, a fallback failure costs the handful of
   loosely-tagged independents it might have found and is logged; it can no
   longer erase everything else. A failure in the *primary* query still fails
   the source, and a test pins each direction.

After redeploying, the identical search returned **15 candidates and created 15
prospects**.

---

## 8. The operator screens

**`/platform/acquisition/publication`** — a work queue, not a dashboard. It
shows the gate's own evidence (how many independent sources; whether one is a
verified registry) and no lead score, for the reason in §3.2.

The **blocked** tab is the useful one on most days, because nearly every
candidate that becomes eligible does so by leaving it. Each blocked row names
its reason *and the remedy*: `insufficient_source_evidence` tells an operator
nothing they can act on, "needs two independent sources, or one verified
business registry" does. A **Re-check** action runs the live gate for one
prospect, because after resolving a duplicate the queue would otherwise keep
showing the old answer until the next sweep.

Publishing is behind a confirmation that states what will be created, not a
button in a row a mis-tap could hit.

**`/platform/acquisition/claims`** — the review queue R1B never had. R1B shipped
submit, withdraw and review as database functions and no interface at all, so a
claim filed by a real barber has had nowhere to be seen.

It is the plainest screen in the section on purpose. Approving is the only path
that moves an identity to `claimed`, and R1B made the reverse unrepresentable,
so Approve opens a confirmation that says in words that the decision is final
and that **FadeUp verifies nothing on the reviewer's behalf** — R1B deliberately
built no verification engine, and a reviewer who assumes one exists is the
precise failure this screen must prevent. There is no bulk approve: a queue that
can be cleared in one gesture is a queue nobody reads.

Both decision notes are labelled as readable **by the subject**, because
`professional_claims` deliberately has no internal note. R1A had to close exactly
that leak on `professional_applications.internal_note`, and the way to not have
that bug is for nobody to type a private assessment into the box.

Publish and Approve render only for `platform_owner` / `platform_admin`; the
RPCs enforce it regardless, and the tests assert `platform_support` can read
every candidate and act on none. State is always carried by a word, never by
colour or an icon alone.

---

## 9. Corrections to closed lots

Three earlier suites needed fixture corrections, each commented in place. None
weakens a guarantee.

**R1B's mint fixtures** created bare prospects with no provenance and minted from
them, matching a world in which nothing gated minting. They now fail on
`insufficient_source_evidence`, correctly. The fixtures were given real
provenance rather than exempted from the gate — the same move the Service Mode
lot made when its admission rules invalidated R1A's unentitled fixture. **A test
that has to route around a guarantee is testing the wrong thing.** One fixture
also had to apply its conversion *after* minting rather than in the INSERT,
because R4 refuses to mint for a business that has already converted.

**R3's check 4.04** asserted `>= 4` deferred contracts, which was R3's own count
rather than an invariant, so it decayed the moment a later lot wired one. It was
restated as what it was actually for: deferred contracts still exist **and** —
the part that matters — no deferred contract has ever emitted a row. That
clause does not decay as lots wire their events.

**R1A's public-table allow-list** names the one new table.

### 9.1 An R1B observation, deliberately NOT "corrected"

R1B creates a platform-staff SELECT policy on `prospect_professionals` and also
revokes ALL from `authenticated`, including SELECT. Postgres checks the grant
before it consults any policy, so **that policy can never match a row** — even
for a platform administrator.

R4 initially treated this as a defect and granted three columns so the policy
could run, in order to give the publication queue a `professional_id` and an
exact `is_published`. Running the full regression caught it: R1B's VERIFY §8.16
asserts by name that *"an ordinary account cannot SELECT acquisition provenance
either"*, and that check went from PASS to FAIL.

The check was right and the framing was wrong. The revoke and the policy are
**belt and braces**: the policy alone would already return zero rows to an
ordinary account, so the absent grant is a second, independent layer. The
policy is redundant, not broken — and trading away one of two layers to
populate a column the screen does not even display would have been a bad deal.

The grant was reverted. `prospect_publication_queue` no longer joins the
linkage table at all and derives `is_published` from the cached
`block_reason = 'already_published'` instead. That is as fresh as the cache,
which is exact immediately after a publication — `publish_external_professional`
refreshes the row in the same transaction — and the screen offers a Re-check
action for every other case. VERIFY §11.2b now asserts that R4 re-granted
**nothing** on `prospect_professionals`.

Worth recording as a process note: this was caught by re-running every closed
lot's suite after a late change, not by review. The change looked entirely
reasonable and was accompanied by a confident explanation of why it was safe.

### 9.2 An unrelated harness fix

`scripts/disposable-db-test.sh` wrote its VERIFY output to a fixed `/tmp` path.
That file is unwritable once another user on the box has run the script, and
`tee` failing there is silent — the PASS/FAIL summary and **the exit code every
caller trusts** would then be counting a stale file from someone else's run. It
now uses a per-run `mktemp`.

---

## 10. Validation

| | Result |
| --- | --- |
| `VERIFY_R4` fresh database | 94 PASS / 0 FAIL / 1 INFO |
| `VERIFY_R4` upgrade over populated pre-R4 database | 101 PASS / 0 FAIL / 1 INFO |
| `VERIFY_R1A` | 70 PASS / 0 FAIL |
| `VERIFY_R1B` | 161 PASS / 0 FAIL |
| `VERIFY_R2` | 197 PASS / 0 FAIL |
| `VERIFY_SERVICE_MODE` | 172 PASS / 0 FAIL |
| `VERIFY_R3` | 126 PASS / 0 FAIL |
| `VERIFY_ORGANIZATION_FOLLOWS` | 32 PASS / 0 FAIL |
| `VERIFY_CUSTOMER_API_FREEZE` | 0 FAIL |
| `VERIFY_WORKER_V2_ACQUISITION` | 280 PASS / 0 FAIL |

All nine re-run against the final state of the branch, not against the state
each was written for.
| Worker suite | 247 tests pass, typecheck + build clean |
| Web suite | 722 tests pass, typecheck + production build clean |
| `generate-master-r4.sh` | all safety assertions pass |

### 10.1 The upgrade test proves preservation by fingerprint

`SEED_R4` seeds prospects that are deliberately **ineligible** under the new
rules — one source each, one of them already linked to an identity minted before
any gate existed — and **asserts** that they are ineligible. Without that
assertion the retroactivity test would still pass and would be proving nothing,
because there would be no rule for the gate to fail to apply backwards.

VERIFY recomputes the seed's **own** fingerprint function and asserts byte
equality across prospects, source records, linkage, identities, sources and
jobs. Sharing the one implementation is the point: a VERIFY that re-implemented
the projection could drift and produce two different queries agreeing about
nothing, which looks exactly like a passing test.

### 10.2 The gate guards the door; it does not audit the building

The trigger fires on INSERT. Identities that already exist are **not**
re-validated, and most would fail if they were — nothing previously required two
independent sources. That is deliberate: people may already have claimed those
identities, and retroactively invalidating a claimed profile is a far worse
error than having published it.

### 10.3 Live verification

Applied to the live database (backup: `backups/pre-r4-live-20260828-001028.dump`).
All eight hardening assertions passed on apply. Then, against production data:

* the Worker container was deployed for the first time, healthy, on
  `fadeup-supabase_default` only, with no published ports;
* a bounded OSM discovery over Lyon created 15 prospects;
* `prospect_discovered` fired once per distinct prospect, first-touch
  attributed, with **zero** ingestion rejections;
* a `publication_evaluation` job evaluated 23 prospects — 3 eligible, 20 blocked
  on `insufficient_source_evidence`, which is correct for prospects a single
  source found;
* a direct `INSERT` into `prospect_professionals` as `postgres` was **refused**
  by the gate, and left zero rows behind.

**No external identity was published.** The three eligible candidates are real
businesses awaiting a human decision, which is the entire point of the lot.

---

## 11. What R4 leaves open

* **Auto-publication at scale** is R10's, on top of this gate.
* **The professional merge path** remains R17's hard prerequisite: approving a
  claim from someone who already holds an identity still fails closed.
* **`barbers.professional_id NOT NULL`** is still open, still an identity
  decision rather than a pricing or acquisition one.
* **DB type codegen and the `Database` generic** remain open and still worth
  doing; the two new query modules are hand-typed like every other.
* **The six booking email templates have no copy.** R1A's fix made
  `renderEmail` fail closed rather than deliver application-rejection wording
  for a confirmed booking — correct, but it means that once SMTP is enabled
  every booking email hard-fails to `failed` instead of sending. Writing that
  copy belongs to whichever lot turns SMTP on.
* **`prospect_enriched` fires only from `website_enrichment`**, the one handler
  that writes `last_enriched_at`. Other enrichment passes are silent until they
  write it too.
