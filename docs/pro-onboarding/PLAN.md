# Auth separation + professional registration approval — plan

## 1. Audit findings (what already exists)

**Auth.** One Supabase Auth system. `SignupForm` writes `signup_intent: 'pro'|'customer'` into `raw_user_meta_data` — a *routing hint only*, explicitly not authorization. `WorkspaceSelectorPage` (`/workspace`) is the central post-login router: platform role → `/platform`, one membership → `/app`, several → picker, zero memberships → `/onboarding` or `/app/customer` depending on `signup_intent`.

**Routes today.** `/customer/login`, `/customer/signup`, `/pro/login`, `/pro/signup`, `/platform/login`. `/login` and `/signup` are *compatibility redirects to the pro pages*. There is no `/register` and no `/pro/register`.

**Authorization.** `memberships` (enum `membership_role`: owner|manager|receptionist|barber) for tenants; `platform_members` (enum `platform_role`: platform_owner|platform_admin|platform_support) for platform. Resolved through SECURITY DEFINER helpers in `private` (`is_org_member`, `has_org_role`, `is_platform_admin`, `is_platform_owner`, `has_platform_role`).

**Org creation.** `complete_organization_onboarding(name, slug, location_name, tz)` → `create_organization` → `organizations` insert → **`on_organization_created` trigger inserts an owner membership for `auth.uid()`**.

**Audit.** `platform_audit_log(actor_user_id, action, target_type, target_id, metadata, created_at)`, written directly by platform RPCs. Surfaced at `/platform/audit`.

**Notifications.** None. No table, no bell, nothing.

**Email.** None at application level. SMTP is configured but only GoTrue (auth emails) uses it. Edge Functions infra exists (Deno, self-hosted, `main` router + 2 functions). `prospect-worker-v2` is a Node worker already running in Docker with direct `pg` access and a PostgreSQL-backed job queue — the natural host for a dispatcher.

**Realtime.** Already used via `postgres_changes` in `lib/queries/queue.ts`.

**i18n.** 10 locales, namespaces `common`/`marketplace`/`customer-app`/`passport`, `NAMESPACES` array in `i18n/index.ts`, RTL handled by `document.documentElement.dir`.

## 2. Two security problems the audit surfaced

1. **`on_organization_created` binds ownership to `auth.uid()`.** If the approval RPC simply inserts an organization, the *reviewing platform owner* becomes the shop's owner. That is precisely the PRO OWNER ≠ PLATFORM OWNER violation. Fix: a session-local suppression GUC the trigger honours, then insert the applicant's owner membership explicitly.

2. **Any authenticated user can call `complete_organization_onboarding` and make themselves a tenant owner.** Without a guard, a pending or rejected applicant just calls the RPC from the console and self-activates, bypassing review entirely. Fix: refuse org creation when the caller's latest application is `pending_review` or `rejected`. Users with no application (invited staff, pre-existing accounts) are unaffected.

## 3. Route architecture

| Route | Purpose |
| --- | --- |
| `/login` | customer sign-in (canonical) |
| `/register` | customer sign-up (canonical) |
| `/customer/login`, `/customer/signup` | compatibility redirects → above |
| `/pro/login` | professional sign-in (preserved, improved) |
| `/pro/register` | professional application (new, canonical) |
| `/pro/signup` | compatibility redirect → `/pro/register` |
| `/pro/application` | applicant status screen (pending / approved / rejected) |
| `/platform/applications` | review queue |
| `/platform/applications/:id` | review detail with Call / Approve / Refuse |

This inverts today's `/login → /pro/login` redirect. Every in-app link to `/customer/login` keeps working through the compatibility redirect, so nothing breaks while the canonical URLs become the ones the spec asks for.

## 4. Data model (only what is missing)

- enum `professional_application_status` = `pending_review | approved | rejected`.
  Deliberately **not** `draft`/`submitted`: no draft is ever persisted in this product (the form submits in one step) and "submitted" and "pending review" are the same observable state. Dead enum values invite dead branches.
- enum `professional_type` = `barbershop | independent_barber | private_studio | mobile_barber`.
- `professional_applications` — one row per submission, `user_id` → `auth.users`, contact + business fields, review fields, timestamps.
  Partial unique index on `user_id where status in ('pending_review','approved')`: one live application per account, but a rejected applicant may reapply.
- `platform_notifications` — `recipient_user_id`, `type`, `title`, `body`, `target_type`, `target_id`, `read_at`. Fanned out to every platform member on submission.
- `email_outbox` — `to_email`, `template`, `payload`, `status queued|sent|failed`, `attempts`, `last_error`, `next_attempt_at`. Enqueued inside the review transaction; delivery is a separate, retryable side effect so a mail outage can never roll back an approval.

## 5. Server-side authorization

- `submit_professional_application(...)` — authenticated; writes the application, fans out notifications, audits. Applicant cannot set status/reviewer.
- `review_professional_application(id, decision, public_reason, internal_note)` — **platform admin only**, `for update` lock, idempotent, does the whole activation transaction, audits, enqueues email. Never touches `platform_members`.
- RLS: applicant reads only their own row and may update only contact fields while pending; platform admins read/write all. Status, `reviewed_by`, `reviewed_at` are unreachable from the client — the update policy uses a trigger that rejects privileged column changes from non-admins.
- `platform_notifications`: recipient-only reads; no client insert.
- `email_outbox`: no client access at all.

## 6. Definition of done

Flows A–F from the brief, each exercised: customer register/login untouched by the pro workflow; pro register → pending page → blocked from `/app`; platform owner notified → reviews → calls → approves → org+membership created, audit written, email queued; approved pro reaches the app; refused pro sees a clear status page and stays blocked; and customer / tenant owner / pending pro all fail to reach the platform queue.
