# FadeUp — Roadmap to Usable V1

**Date:** 2026-08-17 (revised with live-database evidence) · **Commit:** `fa87b18`
**Derived exclusively from** `FADEUP_FULL_AUDIT_2026-08.md`. Every task cites its finding.
Complexity: XS/S/M/L/XL — **no calendar estimates**, no velocity data available.

---

## Guiding principle

The audit's central result is that **the backend is provably correct and the product has never been switched on.**

Proven at runtime: zero migration drift · 54/54 tables with `FORCE ROW LEVEL SECURITY` · zero rows leaked to anonymous across 20 sensitive tables · tenant isolation demonstrated live · 70/70 `SECURITY DEFINER` functions with safe `search_path` · the professional-approval workflow passing 49/49 end-to-end assertions.

Also proven at runtime: `services = 0`, `appointments = 0`, `customers = 0`, `storage.objects = 0`, `audit_logs = 0`, `SITE_URL = http://127.0.0.1:15180`, nothing listening on 443.

**Therefore this roadmap contains no rebuilds.** It is configuration, completion, and proof. Anyone proposing to rewrite the schema or the RLS model should read §21 of the audit first — that work is done and verified.

---

# P0 — Launch blockers

| ID | Task | Finding | Cx |
|---|---|---|---|
| **P0-1** | Provision a domain and TLS certificate; bind nginx on 443; redirect 80→443. Replace `PROXY_DOMAIN=your-domain.example.com`. | B-01 / SEC-1 | S |
| **P0-2** | Bind Kong HTTP to `127.0.0.1` instead of `0.0.0.0:18100`; route all API traffic through nginx over TLS. Today the **secure** Kong port (18443) is localhost-only while the **insecure** one is public. | B-01 / SEC-2 | S |
| **P0-3** | Set `SITE_URL` and `ADDITIONAL_REDIRECT_URLS` to the real domain. Currently `http://127.0.0.1:15180` with `ENABLE_EMAIL_AUTOCONFIRM=false`, so **every confirmation and password-reset link is unreachable** — customer signup cannot complete. | **B-02** / A-1 | XS |
| **P0-4** | Create real services for at least one real organization and drive one booking through `book_public_appointment` to a confirmed appointment. **`services = 0` means nothing in the product is bookable today**; every downstream flow is untestable until one row exists. | **B-04** / S-1 | M |
| **P0-5** | Add a `booking_confirmation` email template and enqueue it **inside the booking transaction**, mirroring the approval pattern proven in `dispatcher.ts`. | B-05 / E-2 | M |
| **P0-6** | Add an `invitation` email template and enqueue on invite creation. Without it an owner must hand-copy invite links and cannot onboard staff. | B-06 / E-3 | M |
| **P0-7** | Verify real SMTP delivery. `SMTP_PORT = 2500` is characteristic of a development mail catcher; the e2e run proved the dispatcher can **lease** emails, never that one was **delivered**. Configure SPF/DKIM/DMARC. | E-1 | M |
| **P0-8** | Configure Playwright (`playwright.config.ts` + `e2e/`). It is currently a dependency with no config and no test directory. | B-03 / T-2 | S |
| **P0-9** | E2E **Journey 1**: anonymous → `/search` → barber → service → `book_public_appointment` → account claim → `/app/customer/appointments`. | §37 J1 | M |
| **P0-10** | E2E **Journey 2**: walk-in → `join_public_queue` → live position via realtime → served. | §37 J2 | M |
| **P0-11** | E2E **Journey 5**: owner invites → invitee registers → `accept_invitation` → lands in the **same** org and location scope. | §37 J5 | M |
| **P0-12** | Create a `booking` i18n namespace and translate the 4 `public-*` pages across 10 locales. The conversion path is English-only while marketing is fully translated. | B-07 / I18N-1 | M |
| **P0-13** | Add `/terms` and `/privacy` with footer links. GDPR exposure on an EU-first product handling customer PII. | B-13 | S |
| **P0-14** | Remove the **Chair Mode** claim from `pricing-page.tsx:24` and `features-page.tsx:67` — it is sold as a paid plan highlight with zero implementation, contradicting the precedent set by `cb6f90d` for loyalty. | B-18 / PR-1 | XS |

---

# P1 — Required V1 quality

| ID | Task | Finding | Cx |
|---|---|---|---|
| **P1-1** | Add `public.platform_notifications` to the `supabase_realtime` publication. The frontend subscribes to it (`professional-applications.ts:311-318`) but the publication contains **only `queue_entries`**, so the bell is silently dead. One line of SQL. | **B-15 / RT-1** | XS |
| **P1-2** | Add `public.appointments` to the publication and subscribe org-scoped, following `queue.ts:101`. Prevents a stale shop-floor screen. | B-09 / RT-2 | M |
| **P1-3** | Introduce a migration ledger (`supabase_migrations.schema_migrations` or equivalent). Drift is zero **today by discipline alone** — nothing records what ran, and nothing structurally prevents divergence. | **B-11 / M-2** | M |
| **P1-4** | Add assertions to the 18 non-assertive `verify_*.sql` scripts, or reclassify them as reports. They print output for a human and **cannot fail**, so they protect against nothing. | **B-12 / T-1** | L |
| **P1-5** | Make the DB scripts CI-safe: wrap in transactions that roll back, or enable `ON_ERROR_STOP`. They currently seed→commit→clean with error-stop off; a mid-run failure leaves fixtures behind. | T-3 | M |
| **P1-6** | Create an `app` (pro) i18n namespace; translate all 12 `app-*` pages. Barbers operate in English regardless of locale. | B-08 / I18N-2 | L |
| **P1-7** | Build `/app/settings` and differentiate the owner surface from the barber surface using `memberships.role`. | §37 J6 | L |
| **P1-8** | Implement a tenant `audit_logs` writer. Table, indexes and RLS exist; **live count is 0** and `…100900:185` says no feature emits events. | B-10 / S-2 | M |
| **P1-9** | Generate TypeScript types from the database; replace hand-written Row interfaces. Today a column rename yields a runtime `undefined`, not a compile error. | B-19 / D-1 | M |
| **P1-10** | Stand up CI: `vitest`, `tsc -b`, `oxlint`, Playwright, and the DB scripts (after P1-5). None of this is automated today. | Debt #6 | M |
| **P1-11** | Device/browser responsive pass at 375/390/430/768/1024/1440/1920; give `table.tsx` a mobile card fallback. Platform and Pro are table-heavy and unverified. | §9 | L |
| **P1-12** | Complete the 3 un-overridden dark tokens; remove the single hardcoded color in `business-landing-page.tsx`; mount `ThemeToggle` outside Platform so customers and barbers can reach the dark palette. | B-21, B-22 / T-1..3 | S |
| **P1-13** | Prove or fix component-level RTL for Arabic — only `mode-selector.tsx:37` is direction-aware. | B-14 / A11Y-1 | M |
| **P1-14** | Add `Checkbox`, `Radio`, `PageHeader` to `components/ui/`. Their absence guarantees per-page drift. | B-23 | S |
| **P1-15** | Create avatar / barber-portfolio / shop-media buckets modeled on `passport-photos` (private, per-owner folder policies). A discovery marketplace currently **can display no photographs of anything**. | B-24 / ST-1 | L |
| **P1-16** | Fix the `.env.example` / `.env.local` key mismatch (`VITE_SUPABASE_PUBLISHABLE_KEY` vs `VITE_SUPABASE_ANON_KEY`). | B-17 / A-2 | XS |
| **P1-17** | Rotate or set the invalid acquisition source API credential — a job is parked `failed` with *"invalid credentials for source API"*. | B-16 | XS |
| **P1-18** | Disable `ENABLE_PHONE_SIGNUP` (currently `true` with no SMS provider) and scope `FUNCTIONS_VERIFY_JWT` per-function rather than globally `false`. | B-25, B-26 | XS |
| **P1-19** | Auto-forward `/workspace` when exactly one destination exists; add a role-switch affordance for dual-role users. | B-20 / UX-1, UX-2 | S |
| **P1-20** | Add session-expiry interception and offline/reconnect states. | B-28 / A-4 | M |
| **P1-21** | Adopt a date/time library and consolidate `lib/timezone.ts`. Hand-rolled DST logic in a booking product is a correctness trap. | B-27 / DEP-1 | M |

---

# P2 — Post-launch

| ID | Task | Finding | Cx |
|---|---|---|---|
| **P2-1** | Translate the Platform surface (22 remaining pages). | §11 | L |
| **P2-2** | Configure the reverse-proxy `X-Country-Code` header to activate `locale-detect`. The function is written, deployed, returns HTTP 200 — and is inert. | §12 | S |
| **P2-3** | Build Platform users, system-health and support surfaces — deliberately deferred per `platform-layout.tsx:16-19`. | §4.6 | L |
| **P2-4** | Implement a reception role and surface. | §36 | L |
| **P2-5** | Queue-turn notifications (push/SMS) so customers need not hold a tab open. | §37 J2 | M |
| **P2-6** | Consumer map view; `maplibre-gl` is already a dependency, used only by Platform. | §6 | M |
| **P2-7** | Delete `search_public_organizations` and the `hello` edge function. | B-29, B-30 | XS |
| **P2-8** | Decide and document the `/s/:slug` scheme, or migrate to `/shop/:slug` + `/barber/:slug` with redirects. Opaque URLs are weak for a discovery product. | R-1 | M |
| **P2-9** | Consider consolidating the triple identity model (`profiles`/`customer_profiles`/`customers`) — it produced one account-takeover vector (`610d417`). Now assertion-covered; refactor only with those assertions green. | Debt #2 | L |
| **P2-10** | Build Chair Mode, then restore the pricing claim removed in P0-14. | §7 | XL |
| **P2-11** | Update stale docs: `product-previews.tsx:9`, `docs/wave-1/PROGRESS.md`, `docs/pro-onboarding/PROGRESS.md`. | B-31 | XS |
| **P2-12** | Skip-to-content link, landmark roles, contrast verification. | A11Y-2/3/4 | M |
| **P2-13** | Return work to a canonical branch off `master`; `backup/…` HEAD has diverged from `0cd6fc2`. | B-32 | XS |

---

# Execution Waves

## Wave 1 — "Open the front door"

**Objective:** make the deployment reachable, encrypted, and capable of completing an account. Nothing else can be validated by a real user until this lands.

**Features:** P0-1, P0-2, P0-3, P1-16, P1-18.
**Dependencies:** DNS + certificate.
**Risks:** low and well-understood. P0-3 is a one-line change with outsized impact — it is currently the difference between "users can sign up" and "users cannot".
**Definition of done:** HTTPS serves app and API; only 443/80/22 publicly bound; a real person completes email signup and a password reset on a real device.

## Wave 2 — "Switch the product on"

**Objective:** make one shop genuinely bookable. This is the wave that converts FadeUp from a verified codebase into a working product.

**Features:** P0-4, P0-5, P0-6, P0-7.
**Dependencies:** Wave 1 (email links must resolve).
**Risks:** **highest-uncertainty wave.** The booking path has never executed with data; expect the first real `book_public_appointment` call to surface defects that 260 unit tests could not. SMTP deliverability (SPF/DKIM/DMARC) is unaddressed anywhere in the repo and is a common late surprise.
**Definition of done:** a real customer books a real service at a real shop and receives a confirmation email; an owner invites a barber who receives an email and joins the correct organization.

## Wave 3 — "Prove it stays working"

**Objective:** convert the 33 `IMPLEMENTED_UNVERIFIED` rows into evidence, and stop the 18 fake tests from providing false assurance.

**Features:** P0-8 → P0-11, P1-3, P1-4, P1-5, P1-10.
**Dependencies:** Wave 2 (there must be data to test against).
**Risks:** P1-4 will likely reveal that some of the 18 report-scripts describe behavior that no longer holds — they have never been checked. Budget for real findings, not just mechanical work.
**Definition of done:** Journeys 1, 2, 4 and 5 pass in CI on every push; every DB script either asserts or is relabeled; a migration ledger records what is applied.

## Wave 4 — "Make it usable by the people who use it"

**Objective:** the daily-operator experience — barbers and owners, in their own language, on their own devices.

**Features:** P0-12, P0-13, P0-14, P1-1, P1-2, P1-6, P1-7, P1-11, P1-19, P1-20.
**Dependencies:** Wave 2.
**Risks:** P1-7 (owner surface) is genuine product design, not just implementation — decide how owner and barber roles differ before writing code. P1-11 may surface widespread mobile table failures. P1-1 is an XS quick win that should not wait for the rest of this wave.
**Definition of done:** a barber runs a full day in their own language on a phone; an owner configures the business unaided; the appointments screen and the notification bell both live-update.

## Wave 5 — "Remove the latent defects"

**Objective:** close the sources of future silent breakage.

**Features:** P1-8, P1-9, P1-12, P1-13, P1-14, P1-15, P1-17, P1-21.
**Dependencies:** Wave 3 (CI to enforce type generation).
**Risks:** P1-9 will surface existing silent mismatches between hand-written interfaces and the real schema — desirable, but expect a burst of compile errors.
**Definition of done:** DB types generated in CI; tenant audit writes; theme complete and togglable everywhere; RTL verified; media buckets live and exercised.

## Wave 6 — Post-launch

**Features:** all P2. **Definition of done:** per item.

---

# Minimum Shippable V1

**MUST work:**

- Customer discovery (`/`, `/search`) — *already runtime-verified*
- **Public booking that completes**, with confirmation email, in FR + EN
- Live Queue: walk-in, position, public display
- Customer account: signup that works, appointments, cancel, favorites
- Barber operations in the shop's language
- Shop setup with **real services**
- **Invitations delivered by email**
- Professional approval — *already verified 49/49*
- Basic Platform admin (applications, organizations)
- **TLS everywhere**
- **E2E on all of the above, green in CI**

**Explicitly deferred — do not let these delay the pilot:**

Fade Passport photos and sharing (built, verified, good — but not launch-gating) · memberships · waitlist · no-show automation · acquisition worker (internal tooling) · Platform users / system health / support · Chair Mode · consumer map view · 8 of 10 locales · component-level RTL · tenant audit log · and every FUTURE item — wallet, loyalty, referral, payments, tips, commissions, products, inventory — **none started, none should be.**

---

# What this roadmap deliberately does NOT propose

- **No frontend rewrite.** One clean frontend, 260 passing tests, clean build. `apps/web-v2` does not exist and must not be created.
- **No backend rebuild.** Zero drift, 54/54 FORCE RLS, zero anonymous leakage, tenant isolation proven live, 70/70 safe definer functions. This is the most valuable asset in the repository.
- **No RLS redesign.** It was audited against the running database and found correct. Changing it now would risk a verified-secure system for no benefit.
- **No new product surfaces before Wave 4.** Every P0 and nearly every P1 completes something that already exists.
