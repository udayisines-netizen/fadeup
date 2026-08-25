# R1A — Legal Appointment & Queue Transition Matrix

**This document is Condition A.** No transition-guard SQL may be written until
it exists, because a guard built from a one-line description would break
reschedule and the bulk no-show sweep — the two subsystems
`PRODUCT_CONSTITUTION.md` §10 names explicitly.

Derived by reading **every** SQL site that writes `appointments.status` or
`queue_entries.status`, not by inferring from the enum. Each row cites its
source.

---

## 1. `appointment_status` — the enum

`pending, confirmed, completed, cancelled, no_show`
(`20260809140000_appointments.sql:33`)

## 2. Entry points — how a row is born

| TO | WHO | CALLER | REASON |
| --- | --- | --- | --- |
| `confirmed` | anon or authenticated | `book_public_appointment` (`20260819210000:297`) | **Auto-confirm.** The shop already answered by publishing the slot. `decided_at`/`decided_by` stay NULL *on purpose* — that is what distinguishes auto-confirm from a human decision. |
| `pending` | owner/manager/receptionist | direct INSERT under `appointments_insert` | Legacy request flow; still supported. |
| `confirmed` | owner/manager/receptionist | direct INSERT | Staff booking a known customer. |
| `completed` | owner/manager/receptionist | direct INSERT | **Reachable today.** A back-dated walk-in entered after the fact. The guard must not forbid it at INSERT. |

## 3. Legal transitions

| FROM | TO | WHO | CALLER | REASON |
| --- | --- | --- | --- | --- |
| `pending` | `confirmed` | can_manage_appointments | `confirm_booking_request` (`20260819100000:496`) | Shop accepts a request. Idempotent; refuses if expired. |
| `pending` | `cancelled` (+`resolution='declined'`) | can_manage_appointments | `decline_booking_request` (`:549`) | Shop declines. |
| `pending` | `cancelled` (+`resolution='expired'`) | **`fadeup_scheduler`** | `expire_pending_appointments` (`:847`) | **Bulk sweep**, `FOR UPDATE SKIP LOCKED`, re-checked under lock. |
| `pending` \| `confirmed` | `cancelled` (+`cancelled_by_business`) | can_manage_appointments | `cancel_appointment_as_business` (`:601`) | Explicitly `not in ('pending','confirmed')` → refuse. |
| `pending` \| `confirmed` | `cancelled` (+`cancelled_by_customer`) | the owning customer | `cancel_my_appointment` (`:663`) | Same precondition, customer side. |
| `confirmed` | `completed` | can_manage_appointments **or** `is_own_barber` | `complete_appointment` (`20260819200000:1011`) | Row-locked, idempotent, `<> 'confirmed'` → `22023`. Stamps `decided_at`/`decided_by`. |
| `confirmed` | `no_show` | can_manage_appointments **or** `is_own_barber` | `mark_appointment_no_show` (`:1057`) | Same shape. |
| `confirmed` | `no_show` | owner/manager/receptionist | **`apply_appointment_no_show_rule`** (`20260810100000:182`) | **BULK sweep**, `SECURITY INVOKER`, `where status='confirmed' and ends_at < now() - 30min`. Sets **no** `decided_at`. |
| `confirmed` | **`pending`** | the **customer** | `reschedule_appointment` (`20260819100000:784`) | **The transition most likely to be missed.** `v_new_status := case when v_is_business then v_appointment.status else 'pending' end` — a customer move re-opens the decision. Sets GUC `fadeup.appointment_reschedule`. |
| `pending` | `pending` | customer | same | Customer reschedules an already-pending request. |
| `confirmed` | `confirmed` | business | same | Business reschedule **preserves** status. |
| *any* | *same* | any | idempotent RPC returns | Every RPC above returns early when already in the target state. A no-op must not raise. |

## 4. Transitions that are NOT legal

| FROM | TO | Why |
| --- | --- | --- |
| `completed` | anything | Terminal. A completed service is a business record. |
| `cancelled` | anything | Terminal. |
| `no_show` | anything | Terminal. |
| `pending` | `completed` | Skips confirmation. `complete_appointment` already refuses this; the guard must refuse it for **every** caller. |
| `pending` | `no_show` | Same. |
| `confirmed` | `pending` **by staff** | Only the *customer* reschedule path re-opens a decision. |

> **Proven today, and the reason this matrix exists:** the assigned barber can
> `PATCH` `pending → completed` and `completed → pending` directly, and
> owner/manager/receptionist are **wholly exempt** from
> `restrict_appointment_self_update()` — it returns early for them. Every one of
> the "not legal" rows above currently succeeds.

## 5. Implementation constraints

1. **A separate trigger function.** It must **not** be folded into
   `restrict_appointment_self_update()`, which begins by exempting
   owner/manager/receptionist. Folding it in silently inherits that exemption
   and leaves the manager-side forgery path open.
2. **No role bypass for impossible transitions.** Authorization decides *who may
   act*; this guard decides *what states may follow what*. A manager may cancel;
   no one may resurrect a completed appointment.
3. **Server-side paths must still pass.** `auth.uid()` is NULL for the scheduler
   sweep; the guard must judge the *edge*, not the caller.
4. **The reschedule GUC already exists** (`fadeup.appointment_reschedule`) and is
   the sanctioned signal for `confirmed → pending`.
5. **INSERT is not UPDATE.** The guard covers UPDATE only; §2 shows `completed`
   is a legal initial state.
6. **`completed_at` is stamped by the same trigger** on entry to `completed`, so
   it cannot disagree with the status.

---

## 6. Queue lifecycle

`queue_status`: `waiting, called, in_service, completed, cancelled, no_show`

| FROM | TO | Timestamp stamped |
| --- | --- | --- |
| — | `waiting` | `created_at` |
| `waiting` | `called` | `called_at` |
| `called` | `in_service` | `service_started_at` |
| `in_service` | `completed` | `completed_at` |
| `waiting`\|`called`\|`in_service` | `cancelled` \| `no_show` | — |

Terminal: `completed`, `cancelled`, `no_show`.

**Required monotonicity:** `created_at ≤ called_at ≤ service_started_at ≤
completed_at`, enforced by CHECK.

> **Proven today:** a single `UPDATE` by the assigned barber set `completed_at`
> **before** `service_started_at` **before** `called_at`, backdated ten days,
> **and reassigned `customer_id`** — accepted without error.
> `restrict_queue_entry_self_update()` explicitly permits "status, timestamps
> and notes."

**Implementation:** the server stamps the timestamp on the state change and
**overwrites** any client-supplied value.
`apps/web/src/lib/queries/queue.ts:183-206` sends them today, so the columns
stay writable for compatibility — the value is simply not trusted.
`customer_id` must be frozen once the row reaches `called`.

---

## 7. Test obligation

Every edge in §3 must have a passing test; every edge in §4 must have a test
asserting refusal **with the expected SQLSTATE** — not a catch-all — for each of
owner, manager, receptionist and barber. Both bulk sweeps and both reschedule
directions must be exercised end to end.
