-- FadeUp — Global experience foundation
-- Migration: profile locale/theme preferences
--
-- Adds `locale` and `theme` to public.profiles so an authenticated user's
-- explicit choice can follow them across devices. Both are nullable —
-- NULL means "no stored preference", so the frontend's locale/theme
-- resolution chain (explicit selection > profile > cookie > IP geo >
-- browser > English fallback) can distinguish "user has not chosen yet"
-- from "user chose the default".
--
-- No RLS changes needed: profiles_select_own / profiles_update_own
-- (20260809100200_profiles.sql) already scope all reads/writes to the
-- owning user, and these are just two more columns on that same row.
--
-- Idempotent: safe to re-run.

alter table public.profiles
  add column if not exists locale text,
  add column if not exists theme text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_locale_valid'
  ) then
    alter table public.profiles
      add constraint profiles_locale_valid
      check (locale is null or locale in ('en', 'fr', 'es', 'de', 'it', 'pt', 'ar', 'zh-CN', 'ja', 'ru'));
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_theme_valid'
  ) then
    alter table public.profiles
      add constraint profiles_theme_valid
      check (theme is null or theme in ('light', 'dark', 'system'));
  end if;
end
$$;

comment on column public.profiles.locale is
  'Explicit user language preference (one of the 10 supported locales), NULL if never set — frontend falls back to cookie/IP-geo/browser/English.';

comment on column public.profiles.theme is
  'Explicit user theme preference (light/dark/system), NULL if never set — frontend falls back to localStorage default of system.';
