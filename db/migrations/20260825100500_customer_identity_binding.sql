-- FadeUp — R1A: a shop cannot decide which account a customer record belongs to
--
-- REPRODUCED BEFORE THIS MIGRATION: as the organization OWNER,
-- `UPDATE customers SET user_id = '<any auth.users id>'` succeeded outright.
-- customers_update's WITH CHECK constrains organization_id and nothing else,
-- and no trigger freezes the column. Cross-tenant ROW relocation is correctly
-- blocked; cross-tenant IDENTITY assertion was not.
--
-- Blast radius today is one shop's own records, which is why this was first
-- filed as MEDIUM. It is HIGH because of what it composes with: chained with
-- contact squatting and completion forgery it gave a single dishonest manager
-- a low-effort path to a complete, internally consistent "this named person
-- was our customer and we served them" record about someone who never was.
--
-- customers.user_id is written legitimately in exactly one place —
-- private.resolve_customer_for_user, which INSERTs a row for the caller keyed
-- on (organization_id, user_id) — and deliberately never re-pointed: the
-- claim-token redemption path was narrowed in 20260813160000 specifically so
-- that it "never mutates customers.user_id on a row it did not create".
--
-- So there is no legitimate client UPDATE of this column, and it is frozen for
-- every ordinary session. Server-side paths (auth.uid() null) and platform
-- admins are still permitted, matching guard_professional_application_update.
--
-- Idempotent: safe to re-run.

set lock_timeout = '5s';

create or replace function public.guard_customers_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is not distinct from old.user_id then
    return new;
  end if;

  if (select auth.uid()) is null or (select private.is_platform_admin()) then
    return new;
  end if;

  raise exception 'customers.user_id identifies the account that owns this record and cannot be reassigned by a shop'
    using errcode = '42501';
end;
$$;

comment on function public.guard_customers_identity() is
  'BEFORE UPDATE on customers: freezes user_id against client sessions. The column is set once, by private.resolve_customer_for_user, for the account that is actually acting; nothing else may re-point it. Server-side paths and platform admins pass, matching the existing application-guard convention.';

drop trigger if exists customers_guard_identity on public.customers;
create trigger customers_guard_identity
  before update on public.customers
  for each row execute function public.guard_customers_identity();
