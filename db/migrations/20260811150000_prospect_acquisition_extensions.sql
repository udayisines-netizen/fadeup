-- FadeUp — Prospect Worker V2
-- Migration: extensions for prospect acquisition
--
-- pg_trgm: trigram similarity, used by prospect dedup candidate matching
-- (normalized business name similarity) and by ILIKE-style search in the
-- Platform Acquisition UI.
--
-- unaccent: used by application-layer/SQL name normalization so "Café" and
-- "Cafe" compare equal during dedup candidate matching.
--
-- cube + earthdistance: lightweight great-circle distance support
-- (ll_to_earth/earth_distance), used for the Search UI's radius parameter
-- and for prospect_locations' geo index — deliberately NOT postgis, which
-- would be substantial unused surface area for what this needs (radius
-- filtering and rough proximity for dedup candidate matching, not real
-- GIS operations).
--
-- Idempotent: safe to re-run.

create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists cube with schema extensions;
create extension if not exists earthdistance with schema extensions;
