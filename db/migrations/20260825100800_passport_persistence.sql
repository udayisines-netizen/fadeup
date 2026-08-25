-- FadeUp — R1A: a Fade Passport cannot be made to not exist
--
-- PRODUCT_CONSTITUTION §2.2: "Every registered customer owns exactly one Fade
-- Passport... It is not something a customer creates, opts into, or can be
-- missing."
--
-- customer_passports_delete currently lets the customer delete their own
-- Passport row. Nothing reissues it — so the invariant is violable today by a
-- single DELETE, and would stay violable after R1B adds automatic issuance,
-- because that trigger fires on customer_profiles INSERT, which has already
-- happened by then.
--
-- The DELETE policy is removed. Nothing else changes: the customer keeps full
-- SELECT/INSERT/UPDATE on their own Passport, so they can still clear every
-- field. What they cannot do is destroy the row that the product guarantees
-- exists.
--
-- Erasure is unaffected: customer_passports.user_id references auth.users ON
-- DELETE CASCADE, so deleting the account still removes the Passport with it.
-- This closes the "delete it while keeping the account" path, not erasure.
--
-- NOT DONE HERE: automatic issuance, passport_number, issued_at. Those are
-- R1B — this migration only stops the invariant being broken in the meantime.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

drop policy if exists customer_passports_delete on public.customer_passports;

revoke delete on public.customer_passports from authenticated, anon;

comment on table public.customer_passports is
  'The customer-owned, portable Fade Passport. One row per auth.users account. No field here is ever shop/staff-internal data — customer-visible by construction, not by a later filter. The row itself cannot be deleted by the customer (PRODUCT_CONSTITUTION 2.2: a Passport can never be missing); it is removed only when the account itself is erased, by cascade.';
