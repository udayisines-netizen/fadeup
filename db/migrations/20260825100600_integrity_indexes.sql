-- FadeUp — R1A: the two indexes today's queries actually need
--
-- Only indexes justified by a query that exists or by a foreign-key action
-- introduced in R1A. No speculative social indexes: the tables they would
-- serve do not exist, and an index without a query is a write-path cost.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

-- 1. "Which shops does this person work at?"
--
-- staff_profiles has indexes on organization_id and location_id, and a unique
-- on (organization_id, user_id) whose LEADING column is organization_id — so a
-- predicate on user_id alone cannot use it. Confirmed by EXPLAIN: Seq Scan.
-- That is the foundational cross-organization identity lookup, and it is also
-- what private.is_own_barber and get_my_access resolve through.
create index if not exists staff_profiles_user_id_idx
  on public.staff_profiles (user_id) where user_id is not null;

-- 2. "Which customers has this professional served?"
--
-- The only usable index today is (barber_id, starts_at): it is not selective
-- on status and does not carry customer_id, so every candidate row is a heap
-- fetch. This is the hot path for any client list or reputation surface.
--
-- Partial on the terminal state, so it stays small and is not disturbed by the
-- churn of pending/confirmed rows.
create index if not exists appointments_barber_customer_completed_idx
  on public.appointments (barber_id, customer_id)
  where status = 'completed';
