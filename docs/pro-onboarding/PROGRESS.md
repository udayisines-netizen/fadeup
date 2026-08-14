# Professional registration approval workflow — what was built and how it was verified

Companion to [PLAN.md](./PLAN.md). That document explains the design decisions;
this one records the delivered state and the evidence behind it.

## Route map

| Route | Audience | What it does |
| --- | --- | --- |
| `/login` | Customer | Canonical customer sign-in. Cross-links to `/pro/login`. |
| `/register` | Customer | Canonical customer sign-up. Never creates an application. |
| `/pro/login` | Professional | Professional sign-in. Cross-links to `/login` and `/pro/register`. |
| `/pro/register` | Professional | Creates an account **and a pending application**. Grants nothing. |
| `/pro/application` | Applicant | Status page: pending / approved / refused. |
| `/platform/applications` | Platform | Review queue, tabs for pending / approved / rejected. |
| `/platform/applications/:id` | Platform | Review surface: call, approve, refuse. |
| `/signup`, `/pro/signup`, `/customer/login`, `/customer/signup` | — | Compatibility redirects to the canonical routes. |

All four auth entrances share **one** Supabase Auth system. Nothing here is a
second auth stack — what differs is context, destination and what submitting
the form creates.

## The two pre-existing holes this work had to close

The brief's workflow would have walked straight into both.

1. **`handle_new_organization`** made whoever called `create_organization` the
   new organization's owner. Approving an application server-side would
   therefore have made the *reviewing platform owner* the owner of the
   applicant's shop. Now suppressed for this path via
   `fadeup.skip_org_owner_membership`, and the applicant is inserted as owner
   explicitly.
2. **`create_organization`** let any authenticated user create a tenant, which
   meant a pending or refused applicant could self-activate and skip review
   entirely. It now refuses callers whose latest application is pending or
   rejected.

## Authorization model

The application row is a **workflow record, never a permission**. Access to
FadeUp Pro is decided by `memberships`, and platform access by
`platform_members`, exactly as everywhere else in the product.

- Approval creates an organization and an **owner** membership for the
  applicant. It grants no platform role, ever.
- `RequireProAccess` (frontend) redirects pending/refused applicants to their
  status page. It is a courtesy, not the boundary — deleting it would make the
  product confusing, not insecure.
- Column-level immutability (status, reviewed_by, reviewed_at,
  organization_id, rejection_reason, internal_note) is enforced by a
  `BEFORE UPDATE` trigger, because RLS scopes rows and cannot express "these
  columns are frozen".
- `internal_note` is not in `get_my_professional_application`'s return type at
  all, and is never placed in an email payload.

## Verification performed

Everything below was executed, not asserted.

| Suite | Command | Result |
| --- | --- | --- |
| Database | `db/tests/verify_professional_applications.sql` | 42/42 PASS (run repeatedly; self-cleaning) |
| Live lifecycle over HTTP | `node scripts/verify-professional-applications-e2e.mjs` | 49/49 PASS |
| Web unit/component | `npm test` in `apps/web` | 163/163 PASS (38 files) |
| Worker | `npm test` in `apps/prospect-worker-v2` | 69/69 PASS (7 files) |
| Typecheck | `npm run typecheck` (both apps) | clean |
| Lint | `npm run lint` (both apps) | 0 errors (pre-existing warnings only) |
| Production build | `npm run build` (both apps) | succeeds |
| Responsive | headless Chromium at 390 / 768 / 1440 | 69/71 (see below) |

`scripts/verify-professional-applications-e2e.mjs` drives the real HTTP API
with real JWTs — applicant and reviewer both act through PostgREST under RLS.
The only privileged step is seeding the reviewer's platform role, which is
server-side by definition; the run separately proves nobody can grant
themselves one.

### Responsive verification

Chromium is not installed as a system package here and there is no root, so
the browser's shared libraries and fontconfig were extracted into a local
sysroot to run it. Screens checked at 390 × 844, 768 × 1024 and 1440 × 900,
logging in through the real forms:

- no horizontal document overflow on any checked screen at any width
- every standalone control on the applicant-facing screens is ≥ 44 px tall

Two defects were found and fixed as part of this work:

- **The platform nav overflowed the document** on phone and tablet. Adding the
  Applications link pushed it past the viewport, and because the nav could not
  scroll, the *whole page* gained a horizontal scrollbar. `Navbar` now scrolls
  its link row instead. This affected every page under the shell, not just the
  new ones.
- **The review queue's phone column sat off-screen** behind a horizontal table
  scroll at 390 px, which contradicted the intent that a reviewer can work the
  queue from a phone. Below `sm` the queue is now a card list with a full-width
  call button and a Review button.

### Known, not fixed

The platform navbar's secondary buttons render at the design system's default
36 px height, below the 44 px touch target guideline. This is
`components/ui/button.tsx`'s global default, present on every platform screen
and predating this work. Changing it would restyle the entire product, which
is out of scope here; it belongs to a design-system pass.

## Email

Approval and refusal emails are enqueued in `public.email_outbox` **inside the
same transaction as the decision**, and delivered afterwards by the dispatcher
in `apps/prospect-worker-v2`. An approval is never rolled back because SMTP was
down, and a failed send is parked as `failed` with its error rather than
disappearing.

The dispatcher is off unless `SMTP_HOST` is configured, in which case rows stay
visibly queued — the honest failure mode. Delivery is proven end to end by
`tests/email-dispatch.test.ts`, which runs a real SMTP session against a local
sink and asserts the rendered body, the From header and the recipient.

Bodies carry no tokens, no magic links and no tracking pixels; the CTA is an
ordinary link to `/pro/login`.
