-- FadeUp — B1: neutralising fixture residue left in production.
--
-- WHAT HAPPENED, PLAINLY. While establishing a before/after baseline for the
-- "/platform is intact" acceptance criterion, B1 ran the existing
-- db/tests/verify_*.sql suite against the PRODUCTION database. Several of
-- those scripts COMMIT their fixtures and then try to delete them, and the
-- delete is refused by reject_commercial_history_mutation:
--
--   ERROR: commercial_plan_changes is append-only: DELETE is not permitted
--
-- so their cleanup fails and the fixtures stay. 31 organizations, 27
-- locations, 30 staff profiles, 13 professional identities, 4 customers and 5
-- prospects were created at 2026-09-04 15:49 UTC this way. That was B1's
-- mistake: verify_b1.sql is written to roll back for exactly this reason, and
-- the older scripts should have been run against the restore database only.
--
-- WHAT THE DAMAGE ACTUALLY WAS. Exactly one row reached the public: the
-- organization `wave1-boundary-a`, which the boundary fixture creates
-- marketplace_visible = true, and which therefore appeared as the tenth result
-- of search_public_professionals(). Everything else was created invisible. No
-- appointment, no queue entry and no auth user was created; none of the 13
-- professional identities is public.
--
-- WHY THIS FILE DOES NOT DELETE. It cannot. commercial_plan_changes is
-- append-only by a trigger whose own comment says there is "no role exemption,
-- on purpose — an audit trail that the most powerful role can rewrite is a
-- log, not an audit trail". An organization row can never be removed once
-- created. B1 does not weaken that guarantee to tidy up after itself.
--
-- So this follows the precedent already visible in the data: seven organizations
-- from an earlier lot carry the name "ZZ dead R5R1A fixture (undeletable:
-- append-only commercial history)" and are invisible and inactive. The 31 new
-- rows are given the same treatment, so the next person reading the table sees
-- immediately what they are.
--
-- IDEMPOTENT and re-runnable. Run with:
--   docker exec -i fadeup-supabase-db psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < db/seeds/b1_fixture_residue_cleanup.sql

set lock_timeout = '5s';

begin;

create temporary table b1_residue on commit drop as
select id from public.organizations
where created_at >= timestamptz '2026-09-04 15:49:00+00'
  and created_at <  timestamptz '2026-09-04 15:51:00+00'
  and slug in (
    'jacks-barbers-lot7','jacks-barbers-lot8','jacks-barbers-lot9','jacks-barbers-lot10',
    'jacks-barbers-lot11','jacks-barbers-lot12','jacks-barbers-lot12p','jacks-barbers-lot13',
    'jacks-barbers-lot14','jacks-barbers-lot15b',
    'unrelated-org-lot6','unrelated-org-lot7','unrelated-org-lot8','unrelated-org-lot10',
    'unrelated-org-lot12','unrelated-org-lot12p','unrelated-org-lot13','unrelated-org-lot14',
    'franks-fades-lot3','henrys-cuts-lot6','pcc-test-shop','proapp-existing-shop',
    'maison-fade','pw2-test-shop','alices-barbershop','bobs-barbershop',
    'wave1-ownership-shop','wave1-app-shop','wave1-identity-shop',
    'wave1-boundary-a','wave1-boundary-b'
  );

-- 1. Out of the marketplace. This is the only line that changes anything a
--    customer could have seen.
update public.organizations
set marketplace_visible = false
where id in (select id from b1_residue) and marketplace_visible;

-- 2. Inactive establishments, so no search, availability or queue path can
--    reach them even if visibility were flipped back by accident.
update public.locations
set is_active = false
where organization_id in (select id from b1_residue) and is_active;

-- 3. Named for what they are, following the convention the earlier lot's
--    residue already carries.
update public.organizations
set name = 'ZZ dead B1 verify fixture (undeletable: append-only commercial history)'
where id in (select id from b1_residue)
  and name not like 'ZZ dead%';

-- 4. The five fixture prospects are fictional businesses. The acquisition
--    Worker must never enrich, score or contact them, and do_not_contact is
--    the flag the pipeline already honours — publication_block_reason returns
--    'do_not_contact' for them, so they can also never be published.
update public.prospects
set do_not_contact = true
where created_at >= timestamptz '2026-09-04 15:49:00+00'
  and created_at <  timestamptz '2026-09-04 15:51:00+00'
  and canonical_name in ('Wave1 Boundary Prospect Shop', 'Le Barbier de Paris', 'Barbier de Paris')
  and not do_not_contact;

commit;
