-- ============================================================================
-- FadeUp — P1c seed de démonstration
-- ============================================================================
-- OBJET. Huit organisations non revendiquées avec leurs données
-- professionnelles RÉELLES (nom, adresse, services aux prix du métier,
-- horaires, mode de service) — exactement ce que publie le Worker, en plus
-- complet. C'est la matière nécessaire pour juger les compositions /demo.
--
-- LOI PRODUIT (MASTER_SPEC §2) — CE SCRIPT N'INSÈRE JAMAIS :
--   abonnés, likes, avis, notes, clients vérifiés, réservations, demandes,
--   disponibilité, entrées en file, temps d'attente, revenu, analytics.
--   Aucune ligne dans : appointments, queue_entries, professional_follows,
--   organization_follows, customer_*, reviews (n'existe pas), posts
--   (n'existe pas). Les profils sont claim_state='unclaimed' — ils le sont
--   RÉELLEMENT : personne ne les a revendiqués.
--
-- MARQUAGE. Tout slug d'organisation commence par `demo-`, tout handle de
-- professionnel par `demo.`. C'est le critère unique de repérage et de
-- suppression (voir unseed-demo.sql).
--
-- IDEMPOTENCE. UUID fixes (préfixe hex `de3` = « de[mo]3 ») + ON CONFLICT
-- DO NOTHING : le script peut être rejoué sans dupliquer ni écraser.
--
-- EXÉCUTION — MANUELLE UNIQUEMENT, jamais appelée par le build ni les tests :
--   docker exec -i fadeup-supabase-db psql -U supabase_admin -d postgres \
--     < apps/web/scripts/seed-demo.sql
--
-- Adresses : réalistes d'Île-de-France, mais AUCUNE ne désigne un commerce
-- réel ; coordonnées approchées au quartier. Le barbier mobile n'a
-- volontairement PAS d'adresse (jamais de fausse adresse physique —
-- MASTER_SPEC §8) : voir la note en fin de script.
-- ============================================================================

begin;

-- Autorisation opérateur documentée du trigger de création (auth.uid() est
-- null en session psql — même chemin qu'une restauration).

-- ---------------------------------------------------------------------------
-- 1) ORGANISATIONS (8) — types et modes variés, noms longs inclus
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name, slug, marketplace_visible, business_type, currency, country_code)
select v.id::uuid, v.name, v.slug, v.marketplace_visible, v.business_type::public.business_type, v.currency, v.country_code
from (values
  ('de300001-0000-4000-8000-000000000001', 'Maison Kaïs — Barbier de Château d''Eau',                        'demo-maison-kais',            true, 'barbershop',        'EUR', 'FR'),
  ('de300002-0000-4000-8000-000000000002', 'Le Salon de Coiffure et Barbier de Saint-Germain-en-Laye',       'demo-salon-saint-germain',    true, 'barbershop',        'EUR', 'FR'),
  ('de300003-0000-4000-8000-000000000003', 'Atelier Fadel',                                                  'demo-atelier-fadel',          true, 'solo_professional', 'EUR', 'FR'),
  ('de300004-0000-4000-8000-000000000004', 'Sofian Cuts — Barbier à domicile, Grand Paris Sud',              'demo-sofian-cuts',            true, 'solo_professional', 'EUR', 'FR'),
  ('de300005-0000-4000-8000-000000000005', 'Barber Corner Ménilmontant',                                     'demo-barber-corner',          true, 'barbershop',        'EUR', 'FR'),
  ('de300006-0000-4000-8000-000000000006', 'Kingsman Coiffure & Barbe — Levallois-Perret',                   'demo-kingsman-levallois',     true, 'barbershop',        'EUR', 'FR'),
  ('de300007-0000-4000-8000-000000000007', 'Studio Nassim',                                                  'demo-studio-nassim',          true, 'solo_professional', 'EUR', 'FR'),
  ('de300008-0000-4000-8000-000000000008', 'Braids & Fades Factory — Esplanade de La Défense',               'demo-braids-fades-defense',   true, 'mixed_salon',       'EUR', 'FR')
) as v(id, name, slug, marketplace_visible, business_type, currency, country_code)
where not exists (select 1 from public.organizations o where o.id = v.id::uuid);

-- ---------------------------------------------------------------------------
-- 2) LIEUX — un par organisation ; le mobile (n°4) est SANS adresse fixe
-- ---------------------------------------------------------------------------
insert into public.locations (id, organization_id, name, address_line1, city, region, postal_code, country, timezone, latitude, longitude)
select v.id::uuid, v.organization_id::uuid, v.name, v.address_line1, v.city, v.region, v.postal_code, v.country, v.timezone, v.latitude, v.longitude
from (values
  ('de300101-0000-4000-8000-000000000001', 'de300001-0000-4000-8000-000000000001', 'Maison Kaïs',                          '41 rue du Château d''Eau',        'Paris',                  'Île-de-France', '75010', 'FR', 'Europe/Paris', 48.8712, 2.3557),
  ('de300102-0000-4000-8000-000000000002', 'de300002-0000-4000-8000-000000000002', 'Salon de Saint-Germain-en-Laye',       '17 rue de la Salle',              'Saint-Germain-en-Laye',  'Île-de-France', '78100', 'FR', 'Europe/Paris', 48.8980, 2.0937),
  ('de300103-0000-4000-8000-000000000003', 'de300003-0000-4000-8000-000000000003', 'Atelier Fadel',                        '12 avenue de la République',      'Aubervilliers',          'Île-de-France', '93300', 'FR', 'Europe/Paris', 48.9126, 2.3839),
  -- Barbier MOBILE : zone de service, pas d'adresse physique, pas de point géo.
  ('de300104-0000-4000-8000-000000000004', 'de300004-0000-4000-8000-000000000004', 'Zone de service — Grand Paris Sud',    null,                              'Évry-Courcouronnes',     'Île-de-France', null,    'FR', 'Europe/Paris', null,    null),
  ('de300105-0000-4000-8000-000000000005', 'de300005-0000-4000-8000-000000000005', 'Barber Corner',                        '86 boulevard de Ménilmontant',    'Paris',                  'Île-de-France', '75020', 'FR', 'Europe/Paris', 48.8650, 2.3868),
  ('de300106-0000-4000-8000-000000000006', 'de300006-0000-4000-8000-000000000006', 'Kingsman Levallois',                   '3 place du Général Leclerc',      'Levallois-Perret',       'Île-de-France', '92300', 'FR', 'Europe/Paris', 48.8935, 2.2874),
  ('de300107-0000-4000-8000-000000000007', 'de300007-0000-4000-8000-000000000007', 'Studio Nassim',                        '5 rue du Midi',                   'Vincennes',              'Île-de-France', '94300', 'FR', 'Europe/Paris', 48.8470, 2.4380),
  ('de300108-0000-4000-8000-000000000008', 'de300008-0000-4000-8000-000000000008', 'Braids & Fades Factory',               '11 esplanade du Général de Gaulle','Puteaux',               'Île-de-France', '92800', 'FR', 'Europe/Paris', 48.8890, 2.2503)
) as v(id, organization_id, name, address_line1, city, region, postal_code, country, timezone, latitude, longitude)
where not exists (select 1 from public.locations l where l.id = v.id::uuid);

-- ---------------------------------------------------------------------------
-- 3) MODES DE SERVICE — variés entre les huit (hybrid / reservation_only /
--    queue_only / unavailable), file ouverte ou non
-- ---------------------------------------------------------------------------
insert into public.location_service_settings (location_id, organization_id, default_service_mode, queue_open)
values
  ('de300101-0000-4000-8000-000000000001', 'de300001-0000-4000-8000-000000000001', 'hybrid',           true),
  ('de300102-0000-4000-8000-000000000002', 'de300002-0000-4000-8000-000000000002', 'reservation_only', false),
  ('de300103-0000-4000-8000-000000000003', 'de300003-0000-4000-8000-000000000003', 'hybrid',           true),
  ('de300104-0000-4000-8000-000000000004', 'de300004-0000-4000-8000-000000000004', 'reservation_only', false),
  ('de300105-0000-4000-8000-000000000005', 'de300005-0000-4000-8000-000000000005', 'queue_only',       true),
  ('de300106-0000-4000-8000-000000000006', 'de300006-0000-4000-8000-000000000006', 'unavailable',      false),
  ('de300107-0000-4000-8000-000000000007', 'de300007-0000-4000-8000-000000000007', 'reservation_only', false),
  ('de300108-0000-4000-8000-000000000008', 'de300008-0000-4000-8000-000000000008', 'hybrid',           false)
on conflict (location_id) do nothing;

-- ---------------------------------------------------------------------------
-- 4) HORAIRES DES LIEUX — semaines réalistes du métier (mardi–samedi pour la
--    plupart, dimanche matin à Ménilmontant, lundi fermé presque partout)
--    day_of_week : 0 = dimanche … 6 = samedi
-- ---------------------------------------------------------------------------
insert into public.location_hours (id, organization_id, location_id, day_of_week, is_closed, open_time, close_time)
select
  ('de3002' || lpad(to_hex(rn), 2, '0') || '-0000-4000-8000-' || lpad(to_hex(rn), 12, '0'))::uuid,
  organization_id, location_id, day_of_week, is_closed, open_time::time, close_time::time
from (
  values
  -- Maison Kaïs (mar–sam 10h–20h, dim/lun fermé)
  (  1, 'de300001-0000-4000-8000-000000000001'::uuid, 'de300101-0000-4000-8000-000000000001'::uuid, 0, true,  null,    null),
  (  2, 'de300001-0000-4000-8000-000000000001', 'de300101-0000-4000-8000-000000000001', 1, true,  null,    null),
  (  3, 'de300001-0000-4000-8000-000000000001', 'de300101-0000-4000-8000-000000000001', 2, false, '10:00', '20:00'),
  (  4, 'de300001-0000-4000-8000-000000000001', 'de300101-0000-4000-8000-000000000001', 3, false, '10:00', '20:00'),
  (  5, 'de300001-0000-4000-8000-000000000001', 'de300101-0000-4000-8000-000000000001', 4, false, '10:00', '20:00'),
  (  6, 'de300001-0000-4000-8000-000000000001', 'de300101-0000-4000-8000-000000000001', 5, false, '10:00', '21:00'),
  (  7, 'de300001-0000-4000-8000-000000000001', 'de300101-0000-4000-8000-000000000001', 6, false, '09:30', '20:00'),
  -- Saint-Germain (mar–sam 9h30–19h)
  (  8, 'de300002-0000-4000-8000-000000000002', 'de300102-0000-4000-8000-000000000002', 0, true,  null,    null),
  (  9, 'de300002-0000-4000-8000-000000000002', 'de300102-0000-4000-8000-000000000002', 1, true,  null,    null),
  ( 10, 'de300002-0000-4000-8000-000000000002', 'de300102-0000-4000-8000-000000000002', 2, false, '09:30', '19:00'),
  ( 11, 'de300002-0000-4000-8000-000000000002', 'de300102-0000-4000-8000-000000000002', 3, false, '09:30', '19:00'),
  ( 12, 'de300002-0000-4000-8000-000000000002', 'de300102-0000-4000-8000-000000000002', 4, false, '09:30', '19:00'),
  ( 13, 'de300002-0000-4000-8000-000000000002', 'de300102-0000-4000-8000-000000000002', 5, false, '09:30', '19:00'),
  ( 14, 'de300002-0000-4000-8000-000000000002', 'de300102-0000-4000-8000-000000000002', 6, false, '09:00', '19:00'),
  -- Atelier Fadel (lun–sam 9h–19h30)
  ( 15, 'de300003-0000-4000-8000-000000000003', 'de300103-0000-4000-8000-000000000003', 0, true,  null,    null),
  ( 16, 'de300003-0000-4000-8000-000000000003', 'de300103-0000-4000-8000-000000000003', 1, false, '09:00', '19:30'),
  ( 17, 'de300003-0000-4000-8000-000000000003', 'de300103-0000-4000-8000-000000000003', 2, false, '09:00', '19:30'),
  ( 18, 'de300003-0000-4000-8000-000000000003', 'de300103-0000-4000-8000-000000000003', 3, false, '09:00', '19:30'),
  ( 19, 'de300003-0000-4000-8000-000000000003', 'de300103-0000-4000-8000-000000000003', 4, false, '09:00', '19:30'),
  ( 20, 'de300003-0000-4000-8000-000000000003', 'de300103-0000-4000-8000-000000000003', 5, false, '09:00', '19:30'),
  ( 21, 'de300003-0000-4000-8000-000000000003', 'de300103-0000-4000-8000-000000000003', 6, false, '09:00', '18:00'),
  -- Sofian Cuts, mobile (mer–dim 11h–21h — déplacements en soirée)
  ( 22, 'de300004-0000-4000-8000-000000000004', 'de300104-0000-4000-8000-000000000004', 0, false, '11:00', '19:00'),
  ( 23, 'de300004-0000-4000-8000-000000000004', 'de300104-0000-4000-8000-000000000004', 1, true,  null,    null),
  ( 24, 'de300004-0000-4000-8000-000000000004', 'de300104-0000-4000-8000-000000000004', 2, true,  null,    null),
  ( 25, 'de300004-0000-4000-8000-000000000004', 'de300104-0000-4000-8000-000000000004', 3, false, '11:00', '21:00'),
  ( 26, 'de300004-0000-4000-8000-000000000004', 'de300104-0000-4000-8000-000000000004', 4, false, '11:00', '21:00'),
  ( 27, 'de300004-0000-4000-8000-000000000004', 'de300104-0000-4000-8000-000000000004', 5, false, '11:00', '21:00'),
  ( 28, 'de300004-0000-4000-8000-000000000004', 'de300104-0000-4000-8000-000000000004', 6, false, '10:00', '21:00'),
  -- Barber Corner (7 j/7, 10h–22h — file uniquement)
  ( 29, 'de300005-0000-4000-8000-000000000005', 'de300105-0000-4000-8000-000000000005', 0, false, '11:00', '20:00'),
  ( 30, 'de300005-0000-4000-8000-000000000005', 'de300105-0000-4000-8000-000000000005', 1, false, '10:00', '22:00'),
  ( 31, 'de300005-0000-4000-8000-000000000005', 'de300105-0000-4000-8000-000000000005', 2, false, '10:00', '22:00'),
  ( 32, 'de300005-0000-4000-8000-000000000005', 'de300105-0000-4000-8000-000000000005', 3, false, '10:00', '22:00'),
  ( 33, 'de300005-0000-4000-8000-000000000005', 'de300105-0000-4000-8000-000000000005', 4, false, '10:00', '22:00'),
  ( 34, 'de300005-0000-4000-8000-000000000005', 'de300105-0000-4000-8000-000000000005', 5, false, '10:00', '22:00'),
  ( 35, 'de300005-0000-4000-8000-000000000005', 'de300105-0000-4000-8000-000000000005', 6, false, '10:00', '22:00'),
  -- Kingsman (mar–sam 10h–19h ; mode unavailable : les horaires existent,
  -- le service est suspendu — cas « profil entier, réservation indisponible »)
  ( 36, 'de300006-0000-4000-8000-000000000006', 'de300106-0000-4000-8000-000000000006', 0, true,  null,    null),
  ( 37, 'de300006-0000-4000-8000-000000000006', 'de300106-0000-4000-8000-000000000006', 1, true,  null,    null),
  ( 38, 'de300006-0000-4000-8000-000000000006', 'de300106-0000-4000-8000-000000000006', 2, false, '10:00', '19:00'),
  ( 39, 'de300006-0000-4000-8000-000000000006', 'de300106-0000-4000-8000-000000000006', 3, false, '10:00', '19:00'),
  ( 40, 'de300006-0000-4000-8000-000000000006', 'de300106-0000-4000-8000-000000000006', 4, false, '10:00', '19:00'),
  ( 41, 'de300006-0000-4000-8000-000000000006', 'de300106-0000-4000-8000-000000000006', 5, false, '10:00', '19:00'),
  ( 42, 'de300006-0000-4000-8000-000000000006', 'de300106-0000-4000-8000-000000000006', 6, false, '10:00', '19:00'),
  -- Studio Nassim (mar–sam 9h–18h30)
  ( 43, 'de300007-0000-4000-8000-000000000007', 'de300107-0000-4000-8000-000000000007', 0, true,  null,    null),
  ( 44, 'de300007-0000-4000-8000-000000000007', 'de300107-0000-4000-8000-000000000007', 1, true,  null,    null),
  ( 45, 'de300007-0000-4000-8000-000000000007', 'de300107-0000-4000-8000-000000000007', 2, false, '09:00', '18:30'),
  ( 46, 'de300007-0000-4000-8000-000000000007', 'de300107-0000-4000-8000-000000000007', 3, false, '09:00', '18:30'),
  ( 47, 'de300007-0000-4000-8000-000000000007', 'de300107-0000-4000-8000-000000000007', 4, false, '09:00', '18:30'),
  ( 48, 'de300007-0000-4000-8000-000000000007', 'de300107-0000-4000-8000-000000000007', 5, false, '09:00', '18:30'),
  ( 49, 'de300007-0000-4000-8000-000000000007', 'de300107-0000-4000-8000-000000000007', 6, false, '09:00', '17:00'),
  -- Braids & Fades (lun–sam 10h–20h)
  ( 50, 'de300008-0000-4000-8000-000000000008', 'de300108-0000-4000-8000-000000000008', 0, true,  null,    null),
  ( 51, 'de300008-0000-4000-8000-000000000008', 'de300108-0000-4000-8000-000000000008', 1, false, '10:00', '20:00'),
  ( 52, 'de300008-0000-4000-8000-000000000008', 'de300108-0000-4000-8000-000000000008', 2, false, '10:00', '20:00'),
  ( 53, 'de300008-0000-4000-8000-000000000008', 'de300108-0000-4000-8000-000000000008', 3, false, '10:00', '20:00'),
  ( 54, 'de300008-0000-4000-8000-000000000008', 'de300108-0000-4000-8000-000000000008', 4, false, '10:00', '20:00'),
  ( 55, 'de300008-0000-4000-8000-000000000008', 'de300108-0000-4000-8000-000000000008', 5, false, '10:00', '20:00'),
  ( 56, 'de300008-0000-4000-8000-000000000008', 'de300108-0000-4000-8000-000000000008', 6, false, '10:00', '19:00')
) as v(rn, organization_id, location_id, day_of_week, is_closed, open_time, close_time)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 5) SERVICES — durées et prix réels du métier en Île-de-France
-- ---------------------------------------------------------------------------
insert into public.services (id, organization_id, name, description, duration_minutes, price_cents)
values
  -- Maison Kaïs
  ('de300301-0000-4000-8000-000000000001', 'de300001-0000-4000-8000-000000000001', 'Coupe homme',                        'Coupe aux ciseaux ou tondeuse, coiffage inclus', 30, 2800),
  ('de300302-0000-4000-8000-000000000002', 'de300001-0000-4000-8000-000000000001', 'Dégradé américain + contour barbe',  'Fade précis, finition au rasoir',                45, 3800),
  ('de300303-0000-4000-8000-000000000003', 'de300001-0000-4000-8000-000000000001', 'Barbe traditionnelle serviette chaude', 'Taille, rasoir, serviette chaude, soins',     30, 2500),
  ('de300304-0000-4000-8000-000000000004', 'de300001-0000-4000-8000-000000000001', 'Coupe enfant (-12 ans)',             null,                                             20, 1800),
  -- Saint-Germain (premium)
  ('de300305-0000-4000-8000-000000000005', 'de300002-0000-4000-8000-000000000002', 'Coupe signature',                    'Diagnostic, shampoing, coupe, coiffage',         45, 4500),
  ('de300306-0000-4000-8000-000000000006', 'de300002-0000-4000-8000-000000000002', 'Coupe + barbe complète',             null,                                             75, 6500),
  ('de300307-0000-4000-8000-000000000007', 'de300002-0000-4000-8000-000000000002', 'Rituel rasage traditionnel',         'Rasage coupe-chou, serviettes chaudes',          40, 4000),
  -- Atelier Fadel
  ('de300308-0000-4000-8000-000000000008', 'de300003-0000-4000-8000-000000000003', 'Coupe',                              null,                                             30, 2000),
  ('de300309-0000-4000-8000-000000000009', 'de300003-0000-4000-8000-000000000003', 'Coupe + barbe',                      null,                                             45, 3000),
  ('de30030a-0000-4000-8000-00000000000a', 'de300003-0000-4000-8000-000000000003', 'Contours (retouche express)',        null,                                             15, 1000),
  -- Sofian Cuts (mobile — majoration déplacement incluse)
  ('de30030b-0000-4000-8000-00000000000b', 'de300004-0000-4000-8000-000000000004', 'Coupe à domicile',                   'Déplacement inclus, Grand Paris Sud',            45, 4000),
  ('de30030c-0000-4000-8000-00000000000c', 'de300004-0000-4000-8000-000000000004', 'Coupe + barbe à domicile',           'Déplacement inclus, Grand Paris Sud',            60, 5500),
  -- Barber Corner (file)
  ('de30030d-0000-4000-8000-00000000000d', 'de300005-0000-4000-8000-000000000005', 'Coupe sans rendez-vous',             null,                                             25, 2200),
  ('de30030e-0000-4000-8000-00000000000e', 'de300005-0000-4000-8000-000000000005', 'Dégradé + traçage',                  null,                                             35, 3000),
  ('de30030f-0000-4000-8000-00000000000f', 'de300005-0000-4000-8000-000000000005', 'Barbe',                              null,                                             20, 1500),
  -- Kingsman
  ('de300310-0000-4000-8000-000000000010', 'de300006-0000-4000-8000-000000000006', 'Coupe gentleman',                    null,                                             40, 3500),
  ('de300311-0000-4000-8000-000000000011', 'de300006-0000-4000-8000-000000000006', 'Coupe + barbe sculptée',             null,                                             60, 5200),
  -- Studio Nassim
  ('de300312-0000-4000-8000-000000000012', 'de300007-0000-4000-8000-000000000007', 'Coupe studio',                       null,                                             35, 2600),
  ('de300313-0000-4000-8000-000000000013', 'de300007-0000-4000-8000-000000000007', 'Coloration homme',                   'Coloration ton sur ton',                         60, 4800),
  ('de300314-0000-4000-8000-000000000014', 'de300007-0000-4000-8000-000000000007', 'Soin visage black mask',             null,                                             20, 1500),
  -- Braids & Fades
  ('de300315-0000-4000-8000-000000000015', 'de300008-0000-4000-8000-000000000008', 'Fade toutes textures',               null,                                             40, 3200),
  ('de300316-0000-4000-8000-000000000016', 'de300008-0000-4000-8000-000000000008', 'Tresses collées (6 à 8 nattes)',     null,                                             90, 6000),
  ('de300317-0000-4000-8000-000000000017', 'de300008-0000-4000-8000-000000000008', 'Twists + finition',                  null,                                             75, 5500),
  ('de300318-0000-4000-8000-000000000018', 'de300008-0000-4000-8000-000000000008', 'Barbe + contours',                   null,                                             25, 1800)
on conflict (id) do nothing;

-- Chaque service est proposé au lieu unique de son organisation.
insert into public.service_locations (organization_id, service_id, location_id)
select s.organization_id, s.id, l.id
from public.services s
join public.locations l on l.organization_id = s.organization_id and l.id::text like 'de3001%'
where s.id::text like 'de3003%'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 6) ÉQUIPE — staff public + barbers + identité professionnelle NON
--    REVENDIQUÉE (source acquisition, is_public=false : l'état exact que le
--    Worker produit ; la contrainte professionals_publication_eligibility
--    interdit d'ailleurs is_public sans revendication réelle)
-- ---------------------------------------------------------------------------
insert into public.professionals (id, claim_state, display_name, handle, headline, source, is_public)
values
  ('de300401-0000-4000-8000-000000000001', 'unclaimed', 'Kaïs Bellamine',                 'demo.kais.bellamine',    'Fondateur — Maison Kaïs',                'acquisition', false),
  ('de300403-0000-4000-8000-000000000003', 'unclaimed', 'Édouard de Montmorency-Laval',   'demo.edouard.ml',        'Maître barbier — Saint-Germain-en-Laye', 'acquisition', false),
  ('de300404-0000-4000-8000-000000000004', 'unclaimed', 'Fadel Haddadi',                  'demo.fadel',             'Barbier indépendant — Aubervilliers',    'acquisition', false),
  ('de300405-0000-4000-8000-000000000005', 'unclaimed', 'Sofian Meziane',                 'demo.sofian.cuts',       'Barbier à domicile — Grand Paris Sud',   'acquisition', false),
  ('de300406-0000-4000-8000-000000000006', 'unclaimed', 'Moussa Diakité',                 'demo.moussa.diakite',    'Fade specialist — Ménilmontant',         'acquisition', false),
  ('de300407-0000-4000-8000-000000000007', 'unclaimed', 'Grégoire Kingsman-Duchesne',     'demo.gregoire.kd',       null,                                     'acquisition', false),
  ('de300408-0000-4000-8000-000000000008', 'unclaimed', 'Nassim Boukhari',                'demo.nassim',            'Coloriste et barbier — Vincennes',       'acquisition', false),
  ('de300409-0000-4000-8000-000000000009', 'unclaimed', 'Aïssata Traoré-Konaté',          'demo.aissata.tk',        'Braids, twists, textures — La Défense',  'acquisition', false)
on conflict (id) do nothing;

insert into public.staff_profiles (id, organization_id, location_id, display_name, title, bio, is_public, is_active)
values
  ('de300501-0000-4000-8000-000000000001', 'de300001-0000-4000-8000-000000000001', 'de300101-0000-4000-8000-000000000001', 'Kaïs Bellamine',               'Fondateur & barbier',      'Quinze ans de métier entre Alger et Paris. Dégradés nets, rasage traditionnel, conseil sans chichi.', true, true),
  ('de300503-0000-4000-8000-000000000003', 'de300002-0000-4000-8000-000000000002', 'de300102-0000-4000-8000-000000000002', 'Édouard de Montmorency-Laval', 'Maître barbier',           'Formé à Londres. Rituels de rasage au coupe-chou, coupes structurées.', true, true),
  ('de300504-0000-4000-8000-000000000004', 'de300003-0000-4000-8000-000000000003', 'de300103-0000-4000-8000-000000000003', 'Fadel Haddadi',                'Barbier indépendant',      null,                                                     true, true),
  ('de300505-0000-4000-8000-000000000005', 'de300004-0000-4000-8000-000000000004', 'de300104-0000-4000-8000-000000000004', 'Sofian Meziane',               'Barbier à domicile',       'Je me déplace dans tout le Grand Paris Sud, matériel pro complet.', true, true),
  ('de300506-0000-4000-8000-000000000006', 'de300005-0000-4000-8000-000000000005', 'de300105-0000-4000-8000-000000000005', 'Moussa Diakité',               'Fade specialist',          null,                                                     true, true),
  ('de300507-0000-4000-8000-000000000007', 'de300006-0000-4000-8000-000000000006', 'de300106-0000-4000-8000-000000000006', 'Grégoire Kingsman-Duchesne',   'Barbier',                  null,                                                     true, true),
  ('de300508-0000-4000-8000-000000000008', 'de300007-0000-4000-8000-000000000007', 'de300107-0000-4000-8000-000000000007', 'Nassim Boukhari',              'Coloriste & barbier',      null,                                                     true, true),
  ('de300509-0000-4000-8000-000000000009', 'de300008-0000-4000-8000-000000000008', 'de300108-0000-4000-8000-000000000008', 'Aïssata Traoré-Konaté',        'Braids & textures',        'Spécialiste tresses, twists et textures. Sur rendez-vous uniquement le week-end.', true, true)
on conflict (id) do nothing;

insert into public.barbers (id, organization_id, staff_profile_id, professional_id, is_bookable)
select v.id::uuid, v.organization_id::uuid, v.staff_profile_id::uuid, v.professional_id::uuid, v.is_bookable
from (values
  ('de300601-0000-4000-8000-000000000001', 'de300001-0000-4000-8000-000000000001', 'de300501-0000-4000-8000-000000000001', 'de300401-0000-4000-8000-000000000001', true),
  ('de300603-0000-4000-8000-000000000003', 'de300002-0000-4000-8000-000000000002', 'de300503-0000-4000-8000-000000000003', 'de300403-0000-4000-8000-000000000003', true),
  ('de300604-0000-4000-8000-000000000004', 'de300003-0000-4000-8000-000000000003', 'de300504-0000-4000-8000-000000000004', 'de300404-0000-4000-8000-000000000004', true),
  ('de300605-0000-4000-8000-000000000005', 'de300004-0000-4000-8000-000000000004', 'de300505-0000-4000-8000-000000000005', 'de300405-0000-4000-8000-000000000005', true),
  ('de300606-0000-4000-8000-000000000006', 'de300005-0000-4000-8000-000000000005', 'de300506-0000-4000-8000-000000000006', 'de300406-0000-4000-8000-000000000006', true),
  ('de300607-0000-4000-8000-000000000007', 'de300006-0000-4000-8000-000000000006', 'de300507-0000-4000-8000-000000000007', 'de300407-0000-4000-8000-000000000007', true),
  ('de300608-0000-4000-8000-000000000008', 'de300007-0000-4000-8000-000000000007', 'de300508-0000-4000-8000-000000000008', 'de300408-0000-4000-8000-000000000008', true),
  ('de300609-0000-4000-8000-000000000009', 'de300008-0000-4000-8000-000000000008', 'de300509-0000-4000-8000-000000000009', 'de300409-0000-4000-8000-000000000009', true)
) as v(id, organization_id, staff_profile_id, professional_id, is_bookable)
where not exists (select 1 from public.barbers b where b.id = v.id::uuid);

-- Un professionnel opérationnel par organisation : c'est la capacité réelle
-- du plan free (enforce_barber_capacity l'impose), et c'est fidèle à ce que
-- le Worker sait d'un salon non revendiqué. Chaque barber couvre les
-- services de son organisation.
insert into public.barber_services (organization_id, barber_id, service_id)
select b.organization_id, b.id, s.id
from public.barbers b
join public.services s on s.organization_id = b.organization_id
where b.id::text like 'de3006%'
on conflict do nothing;

-- Heures de travail des barbers = heures d'ouverture de leur lieu.
insert into public.barber_working_hours (id, organization_id, barber_id, day_of_week, is_off, start_time, end_time)
select
  md5('demo-bwh' || b.id::text || lh.day_of_week::text)::uuid,
  b.organization_id, b.id, lh.day_of_week, lh.is_closed, lh.open_time, lh.close_time
from public.barbers b
join public.staff_profiles sp on sp.id = b.staff_profile_id
join public.location_hours lh on lh.location_id = sp.location_id
where b.id::text like 'de3006%'
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 7) VÉRIFICATION D'HONNÊTETÉ — le script REFUSE de terminer s'il a produit
--    la moindre activité opérationnelle ou sociale
-- ---------------------------------------------------------------------------
do $$
declare
  v_count integer;
begin
  select (select count(*) from public.appointments a join public.organizations o on o.id = a.organization_id and o.slug like 'demo-%')
       + (select count(*) from public.queue_entries q join public.organizations o on o.id = q.organization_id and o.slug like 'demo-%')
       + (select count(*) from public.professional_follows f join public.professionals p on p.id = f.professional_id and p.handle like 'demo.%')
       + (select count(*) from public.organization_follows f join public.organizations o on o.id = f.organization_id and o.slug like 'demo-%')
       + (select count(*) from public.customer_favorites f join public.organizations o on o.id = f.organization_id and o.slug like 'demo-%')
    into v_count;
  if v_count > 0 then
    raise exception 'seed-demo: % ligne(s) d''activité fabriquée détectée(s) — interdit', v_count;
  end if;
  raise notice 'seed-demo: OK — 8 organisations demo-%%, 8 professionnels unclaimed, zéro métrique/activité.';
end $$;

commit;

-- NOTE (constat, pas contournement) : get_organization_readiness exige une
-- adresse de lieu (has_location_address). Le barbier mobile n'en a pas — le
-- schéma n'a pas encore de modèle « zone de service » (écart remonté dans le
-- rapport P1c). Sa visibilité marketplace est posée à l'insertion, chemin
-- opérateur documenté par guard_marketplace_publication ; les sept autres
-- organisations satisfont la readiness complète.
