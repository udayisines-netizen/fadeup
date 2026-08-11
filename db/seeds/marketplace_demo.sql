-- FadeUp — Marketplace demo seed (dev/sandbox only)
--
-- NOT part of the migration chain — this is fixture data, not schema, and
-- must never run against a real production database. Creates 5 real
-- organizations (with real locations/services/barbers/hours, geocoded, and
-- marketplace_visible = true) so the new public marketplace search has
-- genuine rows to return end-to-end in this dev sandbox. The 8 auth.users
-- rows these reference (owners + employed barbers) were created separately
-- via the GoTrue admin API (POST /auth/v1/admin/users) — see
-- docs/design-2026/marketplace.md for the exact commands, since this
-- script only inserts into public.* tables.
--
-- Inserting into public.memberships (not staff_profiles directly) is
-- deliberate: on_membership_created (20260809120000_staff_profiles.sql)
-- auto-creates the matching staff_profiles row for us — inserting our own
-- staff_profiles row with a fixed id collides with that trigger's row on
-- the (organization_id, user_id) unique constraint. We UPDATE the
-- trigger-created row afterward instead.
--
-- Safe to re-run: every insert is `on conflict do nothing` keyed on the
-- fixed ids below (or the natural key, for trigger-created rows).
--
-- To remove this seed data entirely:
--   delete from public.organizations where slug like 'demo-%';
--   (cascades to locations/services/barbers/staff_profiles/memberships/etc.)
--   then delete the 8 auth.users rows via the admin API.

begin;

-- Shop 1 — Le Fade Parisien (Le Marais, 3rd arr.) — owner + 1 employed barber
insert into public.organizations (id, name, slug, marketplace_visible)
values ('00000000-0000-4000-8000-000000000101', 'Le Fade Parisien', 'demo-le-fade-parisien', true)
on conflict (id) do nothing;

insert into public.locations (id, organization_id, name, address_line1, city, region, postal_code, country, timezone, latitude, longitude)
values ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000101', 'Le Marais', '12 Rue des Rosiers', 'Paris', 'Île-de-France', '75004', 'FR', 'Europe/Paris', 48.8571, 2.3617)
on conflict (id) do nothing;

insert into public.memberships (organization_id, user_id, role)
values
  ('00000000-0000-4000-8000-000000000101', 'd5fd3b40-356b-4c06-a9fd-6b7551b0fbbb', 'owner'),
  ('00000000-0000-4000-8000-000000000101', 'b8441d3c-e060-47de-90cd-562e213c4a8c', 'barber')
on conflict (organization_id, user_id) do nothing;

update public.staff_profiles set location_id = '00000000-0000-4000-8000-000000000102', display_name = 'Karim Belhadj', title = 'Owner & Master Barber', bio = 'Founded Le Fade Parisien in 2019. Specializes in precision fades and beard sculpting.'
where organization_id = '00000000-0000-4000-8000-000000000101' and user_id = 'd5fd3b40-356b-4c06-a9fd-6b7551b0fbbb';

update public.staff_profiles set location_id = '00000000-0000-4000-8000-000000000102', display_name = 'Malik Cissé', title = 'Barber', bio = 'Skin fades and classic cuts.'
where organization_id = '00000000-0000-4000-8000-000000000101' and user_id = 'b8441d3c-e060-47de-90cd-562e213c4a8c';

insert into public.barbers (organization_id, staff_profile_id, is_bookable)
select sp.organization_id, sp.id, true from public.staff_profiles sp
where sp.organization_id = '00000000-0000-4000-8000-000000000101'
on conflict (staff_profile_id) do nothing;

insert into public.services (id, organization_id, name, description, duration_minutes, price_cents, is_active)
values
  ('00000000-0000-4000-8000-000000000121', '00000000-0000-4000-8000-000000000101', 'Classic Haircut', 'Scissor or clipper cut, wash and style.', 30, 3200, true),
  ('00000000-0000-4000-8000-000000000122', '00000000-0000-4000-8000-000000000101', 'Fade', 'Precision skin or taper fade.', 35, 3800, true),
  ('00000000-0000-4000-8000-000000000123', '00000000-0000-4000-8000-000000000101', 'Beard Trim', 'Shape and line-up with hot towel.', 15, 1600, true),
  ('00000000-0000-4000-8000-000000000124', '00000000-0000-4000-8000-000000000101', 'Haircut + Beard', 'Full haircut and beard service.', 45, 4800, true)
on conflict (id) do nothing;

insert into public.service_locations (organization_id, service_id, location_id)
select '00000000-0000-4000-8000-000000000101', s.id, '00000000-0000-4000-8000-000000000102'
from public.services s where s.organization_id = '00000000-0000-4000-8000-000000000101'
on conflict do nothing;

insert into public.barber_services (organization_id, barber_id, service_id)
select '00000000-0000-4000-8000-000000000101', b.id, s.id
from public.barbers b, public.services s
where b.organization_id = '00000000-0000-4000-8000-000000000101' and s.organization_id = '00000000-0000-4000-8000-000000000101'
on conflict do nothing;

insert into public.location_hours (organization_id, location_id, day_of_week, is_closed, open_time, close_time)
select '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000102', d, (d in (0, 1)), '09:30', '19:00'
from generate_series(0, 6) as d
on conflict (location_id, day_of_week) do nothing;

-- Shop 2 — Barbès Barber Co (18th arr.) — independent, owner-only
insert into public.organizations (id, name, slug, marketplace_visible)
values ('00000000-0000-4000-8000-000000000201', 'Barbès Barber Co', 'demo-barbes-barber-co', true)
on conflict (id) do nothing;

insert into public.locations (id, organization_id, name, address_line1, city, region, postal_code, country, timezone, latitude, longitude)
values ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000201', 'Barbès', '45 Boulevard Barbès', 'Paris', 'Île-de-France', '75018', 'FR', 'Europe/Paris', 48.8839, 2.3502)
on conflict (id) do nothing;

insert into public.memberships (organization_id, user_id, role)
values ('00000000-0000-4000-8000-000000000201', '765f8d6e-1434-4fac-83da-a984112464ea', 'owner')
on conflict (organization_id, user_id) do nothing;

update public.staff_profiles set location_id = '00000000-0000-4000-8000-000000000202', display_name = 'Yanis Duval', title = 'Independent Barber', bio = 'One chair, one barber. Walk-ins welcome.'
where organization_id = '00000000-0000-4000-8000-000000000201' and user_id = '765f8d6e-1434-4fac-83da-a984112464ea';

insert into public.barbers (organization_id, staff_profile_id, is_bookable)
select sp.organization_id, sp.id, true from public.staff_profiles sp
where sp.organization_id = '00000000-0000-4000-8000-000000000201'
on conflict (staff_profile_id) do nothing;

insert into public.services (id, organization_id, name, description, duration_minutes, price_cents, is_active)
values
  ('00000000-0000-4000-8000-000000000221', '00000000-0000-4000-8000-000000000201', 'Classic Haircut', 'Scissor or clipper cut.', 30, 2800, true),
  ('00000000-0000-4000-8000-000000000222', '00000000-0000-4000-8000-000000000201', 'Fade', 'Skin fade with line-up.', 35, 3200, true),
  ('00000000-0000-4000-8000-000000000223', '00000000-0000-4000-8000-000000000201', 'Beard Trim', 'Beard shape and trim.', 15, 1400, true)
on conflict (id) do nothing;

insert into public.service_locations (organization_id, service_id, location_id)
select '00000000-0000-4000-8000-000000000201', s.id, '00000000-0000-4000-8000-000000000202'
from public.services s where s.organization_id = '00000000-0000-4000-8000-000000000201'
on conflict do nothing;

insert into public.barber_services (organization_id, barber_id, service_id)
select '00000000-0000-4000-8000-000000000201', b.id, s.id
from public.barbers b, public.services s
where b.organization_id = '00000000-0000-4000-8000-000000000201' and s.organization_id = '00000000-0000-4000-8000-000000000201'
on conflict do nothing;

insert into public.location_hours (organization_id, location_id, day_of_week, is_closed, open_time, close_time)
select '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000202', d, (d = 0), '10:00', '19:30'
from generate_series(0, 6) as d
on conflict (location_id, day_of_week) do nothing;

-- Shop 3 — Atelier Fade (Saint-Germain, 6th arr.) — owner + 1 employed barber
insert into public.organizations (id, name, slug, marketplace_visible)
values ('00000000-0000-4000-8000-000000000301', 'Atelier Fade', 'demo-atelier-fade', true)
on conflict (id) do nothing;

insert into public.locations (id, organization_id, name, address_line1, city, region, postal_code, country, timezone, latitude, longitude)
values ('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000301', 'Saint-Germain', '8 Rue de Buci', 'Paris', 'Île-de-France', '75006', 'FR', 'Europe/Paris', 48.8539, 2.3387)
on conflict (id) do nothing;

insert into public.memberships (organization_id, user_id, role)
values
  ('00000000-0000-4000-8000-000000000301', '38aec915-8dfd-4a72-b8b4-e73a4660e81d', 'owner'),
  ('00000000-0000-4000-8000-000000000301', '38a15a9c-2527-4256-ba85-86901c0f556b', 'barber')
on conflict (organization_id, user_id) do nothing;

update public.staff_profiles set location_id = '00000000-0000-4000-8000-000000000302', display_name = 'Théo Marchand', title = 'Owner & Barber', bio = 'Modern cuts in a classic setting.'
where organization_id = '00000000-0000-4000-8000-000000000301' and user_id = '38aec915-8dfd-4a72-b8b4-e73a4660e81d';

update public.staff_profiles set location_id = '00000000-0000-4000-8000-000000000302', display_name = 'Rayan Ferreira', title = 'Barber', bio = 'Textured crops and fades.'
where organization_id = '00000000-0000-4000-8000-000000000301' and user_id = '38a15a9c-2527-4256-ba85-86901c0f556b';

insert into public.barbers (organization_id, staff_profile_id, is_bookable)
select sp.organization_id, sp.id, true from public.staff_profiles sp
where sp.organization_id = '00000000-0000-4000-8000-000000000301'
on conflict (staff_profile_id) do nothing;

insert into public.services (id, organization_id, name, description, duration_minutes, price_cents, is_active)
values
  ('00000000-0000-4000-8000-000000000321', '00000000-0000-4000-8000-000000000301', 'Classic Haircut', 'Scissor cut, wash and style.', 30, 3600, true),
  ('00000000-0000-4000-8000-000000000322', '00000000-0000-4000-8000-000000000301', 'Fade', 'Precision fade.', 35, 4200, true),
  ('00000000-0000-4000-8000-000000000323', '00000000-0000-4000-8000-000000000301', 'Beard Trim', 'Beard shape with hot towel.', 20, 1800, true),
  ('00000000-0000-4000-8000-000000000324', '00000000-0000-4000-8000-000000000301', 'Haircut + Beard', 'Full service.', 50, 5200, true)
on conflict (id) do nothing;

insert into public.service_locations (organization_id, service_id, location_id)
select '00000000-0000-4000-8000-000000000301', s.id, '00000000-0000-4000-8000-000000000302'
from public.services s where s.organization_id = '00000000-0000-4000-8000-000000000301'
on conflict do nothing;

insert into public.barber_services (organization_id, barber_id, service_id)
select '00000000-0000-4000-8000-000000000301', b.id, s.id
from public.barbers b, public.services s
where b.organization_id = '00000000-0000-4000-8000-000000000301' and s.organization_id = '00000000-0000-4000-8000-000000000301'
on conflict do nothing;

insert into public.location_hours (organization_id, location_id, day_of_week, is_closed, open_time, close_time)
select '00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000302', d, (d in (0, 1)), '09:00', '19:00'
from generate_series(0, 6) as d
on conflict (location_id, day_of_week) do nothing;

-- Shop 4 — Lyon Fade Club (Presqu'île) — independent, owner-only
insert into public.organizations (id, name, slug, marketplace_visible)
values ('00000000-0000-4000-8000-000000000401', 'Lyon Fade Club', 'demo-lyon-fade-club', true)
on conflict (id) do nothing;

insert into public.locations (id, organization_id, name, address_line1, city, region, postal_code, country, timezone, latitude, longitude)
values ('00000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-000000000401', 'Presqu''île', '20 Rue de la République', 'Lyon', 'Auvergne-Rhône-Alpes', '69002', 'FR', 'Europe/Paris', 45.7640, 4.8357)
on conflict (id) do nothing;

insert into public.memberships (organization_id, user_id, role)
values ('00000000-0000-4000-8000-000000000401', 'd54c77c9-cc74-48d3-b771-d5ca6d561984', 'owner')
on conflict (organization_id, user_id) do nothing;

update public.staff_profiles set location_id = '00000000-0000-4000-8000-000000000402', display_name = 'Sofiane Bouzid', title = 'Owner & Barber', bio = 'Lyon''s fade specialist since 2021.'
where organization_id = '00000000-0000-4000-8000-000000000401' and user_id = 'd54c77c9-cc74-48d3-b771-d5ca6d561984';

insert into public.barbers (organization_id, staff_profile_id, is_bookable)
select sp.organization_id, sp.id, true from public.staff_profiles sp
where sp.organization_id = '00000000-0000-4000-8000-000000000401'
on conflict (staff_profile_id) do nothing;

insert into public.services (id, organization_id, name, description, duration_minutes, price_cents, is_active)
values
  ('00000000-0000-4000-8000-000000000421', '00000000-0000-4000-8000-000000000401', 'Classic Haircut', 'Scissor or clipper cut.', 30, 2600, true),
  ('00000000-0000-4000-8000-000000000422', '00000000-0000-4000-8000-000000000401', 'Fade', 'Skin fade.', 35, 3000, true),
  ('00000000-0000-4000-8000-000000000423', '00000000-0000-4000-8000-000000000401', 'Beard Trim', 'Beard trim and line-up.', 15, 1300, true)
on conflict (id) do nothing;

insert into public.service_locations (organization_id, service_id, location_id)
select '00000000-0000-4000-8000-000000000401', s.id, '00000000-0000-4000-8000-000000000402'
from public.services s where s.organization_id = '00000000-0000-4000-8000-000000000401'
on conflict do nothing;

insert into public.barber_services (organization_id, barber_id, service_id)
select '00000000-0000-4000-8000-000000000401', b.id, s.id
from public.barbers b, public.services s
where b.organization_id = '00000000-0000-4000-8000-000000000401' and s.organization_id = '00000000-0000-4000-8000-000000000401'
on conflict do nothing;

insert into public.location_hours (organization_id, location_id, day_of_week, is_closed, open_time, close_time)
select '00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000402', d, (d in (0, 1)), '09:30', '18:30'
from generate_series(0, 6) as d
on conflict (location_id, day_of_week) do nothing;

-- Shop 5 — Marseille Barber House (Vieux-Port) — owner + 1 employed barber
insert into public.organizations (id, name, slug, marketplace_visible)
values ('00000000-0000-4000-8000-000000000501', 'Marseille Barber House', 'demo-marseille-barber-house', true)
on conflict (id) do nothing;

insert into public.locations (id, organization_id, name, address_line1, city, region, postal_code, country, timezone, latitude, longitude)
values ('00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000501', 'Vieux-Port', '5 Quai des Belges', 'Marseille', 'Provence-Alpes-Côte d''Azur', '13001', 'FR', 'Europe/Paris', 43.2951, 5.3739)
on conflict (id) do nothing;

insert into public.memberships (organization_id, user_id, role)
values
  ('00000000-0000-4000-8000-000000000501', '87ff588d-1c4c-4709-885c-8c3d4a56e8e3', 'owner'),
  ('00000000-0000-4000-8000-000000000501', 'abee07c0-4a0d-4e4d-8c38-2bae333310c8', 'barber')
on conflict (organization_id, user_id) do nothing;

update public.staff_profiles set location_id = '00000000-0000-4000-8000-000000000502', display_name = 'Enzo Rinaldi', title = 'Owner & Barber', bio = 'Overlooking the Vieux-Port since 2020.'
where organization_id = '00000000-0000-4000-8000-000000000501' and user_id = '87ff588d-1c4c-4709-885c-8c3d4a56e8e3';

update public.staff_profiles set location_id = '00000000-0000-4000-8000-000000000502', display_name = 'Adam Lopez', title = 'Barber', bio = 'Classic cuts and beard work.'
where organization_id = '00000000-0000-4000-8000-000000000501' and user_id = 'abee07c0-4a0d-4e4d-8c38-2bae333310c8';

insert into public.barbers (organization_id, staff_profile_id, is_bookable)
select sp.organization_id, sp.id, true from public.staff_profiles sp
where sp.organization_id = '00000000-0000-4000-8000-000000000501'
on conflict (staff_profile_id) do nothing;

insert into public.services (id, organization_id, name, description, duration_minutes, price_cents, is_active)
values
  ('00000000-0000-4000-8000-000000000521', '00000000-0000-4000-8000-000000000501', 'Classic Haircut', 'Scissor or clipper cut.', 30, 2700, true),
  ('00000000-0000-4000-8000-000000000522', '00000000-0000-4000-8000-000000000501', 'Fade', 'Skin fade with line-up.', 35, 3100, true),
  ('00000000-0000-4000-8000-000000000523', '00000000-0000-4000-8000-000000000501', 'Beard Trim', 'Beard trim and shape.', 15, 1400, true),
  ('00000000-0000-4000-8000-000000000524', '00000000-0000-4000-8000-000000000501', 'Haircut + Beard', 'Full service.', 45, 4000, true)
on conflict (id) do nothing;

insert into public.service_locations (organization_id, service_id, location_id)
select '00000000-0000-4000-8000-000000000501', s.id, '00000000-0000-4000-8000-000000000502'
from public.services s where s.organization_id = '00000000-0000-4000-8000-000000000501'
on conflict do nothing;

insert into public.barber_services (organization_id, barber_id, service_id)
select '00000000-0000-4000-8000-000000000501', b.id, s.id
from public.barbers b, public.services s
where b.organization_id = '00000000-0000-4000-8000-000000000501' and s.organization_id = '00000000-0000-4000-8000-000000000501'
on conflict do nothing;

insert into public.location_hours (organization_id, location_id, day_of_week, is_closed, open_time, close_time)
select '00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000502', d, (d = 0), '09:00', '19:30'
from generate_series(0, 6) as d
on conflict (location_id, day_of_week) do nothing;

-- Live queue demo — a couple of real 'waiting' queue_entries at shop 1 and
-- shop 3, so the marketplace's real-time "queue waiting" differentiator
-- (spec section 11) has genuine data to show, not a fabricated number.
insert into public.queue_entries (organization_id, location_id, barber_id, customer_name, status)
values
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000102', null, 'Walk-in — L.', 'waiting'),
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000102', null, 'Walk-in — N.', 'waiting'),
  ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000302', null, 'Walk-in — R.', 'waiting')
on conflict do nothing;

commit;
