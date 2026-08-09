-- FadeUp — LOT 2: multi-tenant database foundation
-- Migration: extensions
--
-- pgcrypto provides gen_random_uuid(), used as the default for every UUID
-- primary key in this schema. It ships pre-installed in the Supabase base
-- image (in the `extensions` schema, which is on the default search_path),
-- but we declare it explicitly so the migration history is a complete,
-- reproducible record of what this schema depends on and this repo does not
-- rely on undocumented state of the running container.
--
-- Idempotent: safe to re-run.

create extension if not exists pgcrypto with schema extensions;
