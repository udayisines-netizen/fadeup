-- FadeUp — Wave 1 Phase 5: Fade Passport
-- Migration: customer_passports, customer_passport_photos,
--            customer_passport_shares, passport-photos storage bucket
--
-- The Fade Passport is customer-owned and portable — anchored to
-- customer_profiles.user_id (Phase 3), never to any single shop's
-- customers row. A shop gains no ownership of it just because the customer
-- once visited. This migration deliberately has NO column anywhere that
-- could hold shop/staff-internal notes — the internal-notes-separation
-- requirement is enforced structurally by never modeling that data here in
-- the first place, not by filtering it out later.
--
-- Share tokens follow the exact pattern already established for platform
-- invitations (20260810130000_platform_roles.sql): a high-entropy random
-- token returned to the caller ONCE, only its sha256 hash persisted, zero
-- client SELECT on the hash. See get_shared_passport for the "useful
-- expired-link state" the spec asks for — a share status
-- (active/expired/revoked/not_found) is returned rather than either an
-- error or an indistinguishable empty result, since (unlike a private
-- barber profile) knowing a share link has expired leaks nothing about a
-- third party.
--
-- Storage: this is the first Supabase Storage bucket in this codebase — no
-- prior convention to follow (see docs/wave-1/PLAN.md's audit finding),
-- built from the standard per-user-folder pattern. MIME type and size are
-- enforced by the bucket's own allowed_mime_types/file_size_limit,
-- validated server-side by the Storage API against the actual upload
-- content — not by trusting a client-supplied file extension.
--
-- Idempotent: safe to re-run.

create table if not exists public.customer_passports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  usual_haircut text,
  fade_type text,
  side_length text,
  top_length text,
  beard_preferences text,
  preferences_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_passports_notes_length check (preferences_notes is null or char_length(preferences_notes) <= 1000)
);

comment on table public.customer_passports is
  'The customer-owned, portable Fade Passport. One row per auth.users account. No field here is ever shop/staff-internal data — customer-visible by construction, not by a later filter.';

alter table public.customer_passports enable row level security;
alter table public.customer_passports force row level security;

drop trigger if exists customer_passports_set_updated_at on public.customer_passports;
create trigger customer_passports_set_updated_at
  before update on public.customer_passports
  for each row execute function public.set_updated_at();

drop policy if exists customer_passports_select on public.customer_passports;
create policy customer_passports_select on public.customer_passports for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists customer_passports_insert on public.customer_passports;
create policy customer_passports_insert on public.customer_passports for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists customer_passports_update on public.customer_passports;
create policy customer_passports_update on public.customer_passports for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists customer_passports_delete on public.customer_passports;
create policy customer_passports_delete on public.customer_passports for delete to authenticated using (user_id = (select auth.uid()));

-- customer_passport_photos -----------------------------------------------------
create table if not exists public.customer_passport_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  storage_path text not null,
  caption text,
  created_at timestamptz not null default now(),
  constraint customer_passport_photos_caption_length check (caption is null or char_length(caption) <= 200),
  constraint customer_passport_photos_storage_path_unique unique (storage_path)
);

comment on table public.customer_passport_photos is
  'Reference photos for a Fade Passport. storage_path points into the private passport-photos bucket, always under {user_id}/... — see storage.objects policies below.';

create index if not exists customer_passport_photos_user_id_idx on public.customer_passport_photos (user_id);

alter table public.customer_passport_photos enable row level security;
alter table public.customer_passport_photos force row level security;

drop policy if exists customer_passport_photos_select on public.customer_passport_photos;
create policy customer_passport_photos_select on public.customer_passport_photos for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists customer_passport_photos_insert on public.customer_passport_photos;
create policy customer_passport_photos_insert on public.customer_passport_photos for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists customer_passport_photos_delete on public.customer_passport_photos;
create policy customer_passport_photos_delete on public.customer_passport_photos for delete to authenticated using (user_id = (select auth.uid()));

-- customer_passport_shares -----------------------------------------------------
create table if not exists public.customer_passport_shares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token_hash text not null unique,
  label text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_accessed_at timestamptz,
  constraint customer_passport_shares_label_length check (label is null or char_length(label) <= 100),
  constraint customer_passport_shares_expires_future check (expires_at > created_at)
);

comment on table public.customer_passport_shares is
  'Revocable, time-limited, read-only share links to a Fade Passport. Only token_hash (sha256) is stored — the raw token is returned once, by create_passport_share, and never again. No anon/broad SELECT policy exists on this table; verification only happens inside get_shared_passport.';

create index if not exists customer_passport_shares_user_id_idx on public.customer_passport_shares (user_id);

alter table public.customer_passport_shares enable row level security;
alter table public.customer_passport_shares force row level security;

drop policy if exists customer_passport_shares_select on public.customer_passport_shares;
create policy customer_passport_shares_select on public.customer_passport_shares for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists customer_passport_shares_delete on public.customer_passport_shares;
create policy customer_passport_shares_delete on public.customer_passport_shares for delete to authenticated using (user_id = (select auth.uid()));
-- No direct insert/update policy: rows are only ever created/revoked via
-- create_passport_share/revoke_passport_share below (SECURITY DEFINER),
-- which is what actually generates and hashes the token — a raw insert
-- policy would let a client insert a row with a token_hash of their own
-- choosing, defeating the whole point.

-- create_passport_share -----------------------------------------------------
create or replace function public.create_passport_share(p_label text default null, p_ttl_hours integer default 168)
returns table (share_id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_ttl integer;
  v_expires_at timestamptz;
  v_raw_token text;
  v_share_id uuid;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'create_passport_share requires an authenticated session';
  end if;

  if not exists (select 1 from public.customer_passports where user_id = v_user_id) then
    raise exception 'create a Fade Passport before sharing it';
  end if;

  -- Clamp to [1 hour, 30 days] — always time-limited, never accidentally unbounded.
  v_ttl := least(greatest(coalesce(p_ttl_hours, 168), 1), 720);
  v_expires_at := now() + (v_ttl || ' hours')::interval;
  v_raw_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.customer_passport_shares (user_id, token_hash, label, expires_at)
  values (v_user_id, encode(extensions.digest(v_raw_token, 'sha256'), 'hex'), nullif(btrim(coalesce(p_label, '')), ''), v_expires_at)
  returning id into v_share_id;

  return query select v_share_id, v_raw_token, v_expires_at;
end;
$$;

comment on function public.create_passport_share(text, integer) is
  'Authenticated-only. Creates a revocable, time-limited (1h-30d, clamped) share link for the caller''s own Fade Passport. Returns the raw token exactly once — only its sha256 hash is ever persisted.';

revoke execute on function public.create_passport_share(text, integer) from public, anon;
grant execute on function public.create_passport_share(text, integer) to authenticated;

-- revoke_passport_share -----------------------------------------------------
create or replace function public.revoke_passport_share(p_share_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.customer_passport_shares
  set revoked_at = now()
  where id = p_share_id and user_id = (select auth.uid()) and revoked_at is null;

  if not found then
    raise exception 'share not found, not yours, or already revoked';
  end if;
end;
$$;

comment on function public.revoke_passport_share(uuid) is
  'Authenticated-only. Revokes the caller''s own share — raises if it doesn''t exist, isn''t theirs, or is already revoked (never a silent no-op).';

revoke execute on function public.revoke_passport_share(uuid) from public, anon;
grant execute on function public.revoke_passport_share(uuid) to authenticated;

-- get_shared_passport -----------------------------------------------------
-- The one anon-callable read for a share link. Returns a `status` so the
-- frontend can show a genuinely useful expired/revoked state (spec:
-- "Provide a useful expired-link state") rather than an error or an
-- indistinguishable empty result — unlike a private barber profile,
-- knowing a share link expired reveals nothing sensitive about anyone.
-- Curated columns only: no phone/email, no internal shop notes (none exist
-- in this schema to begin with), no photos (see PLAN.md section 9 — photo
-- delivery to an unauthenticated viewer is a deliberate V1 scope cut).
create or replace function public.get_shared_passport(p_token text)
returns table (
  status text,
  display_name text,
  usual_haircut text,
  fade_type text,
  side_length text,
  top_length text,
  beard_preferences text,
  preferences_notes text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_share public.customer_passport_shares;
begin
  v_hash := encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  select * into v_share from public.customer_passport_shares where token_hash = v_hash;

  if not found then
    return query select 'not_found'::text, null::text, null::text, null::text, null::text, null::text, null::text, null::text;
    return;
  end if;

  if v_share.revoked_at is not null then
    return query select 'revoked'::text, null::text, null::text, null::text, null::text, null::text, null::text, null::text;
    return;
  end if;

  if v_share.expires_at < now() then
    return query select 'expired'::text, null::text, null::text, null::text, null::text, null::text, null::text, null::text;
    return;
  end if;

  update public.customer_passport_shares set last_accessed_at = now() where id = v_share.id;

  return query
  select
    'active'::text,
    cp.display_name,
    p.usual_haircut,
    p.fade_type,
    p.side_length,
    p.top_length,
    p.beard_preferences,
    p.preferences_notes
  from public.customer_passports p
  left join public.customer_profiles cp on cp.user_id = p.user_id
  where p.user_id = v_share.user_id;
end;
$$;

comment on function public.get_shared_passport(text) is
  'Anon-callable. Verifies a share token by sha256 hash (never a raw lookup) and returns status active/expired/revoked/not_found plus curated Passport fields only when active. Never returns phone/email/internal notes/photos.';

revoke execute on function public.get_shared_passport(text) from public;
grant execute on function public.get_shared_passport(text) to anon, authenticated;

-- passport-photos storage bucket -----------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('passport-photos', 'passport-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists passport_photos_select_own on storage.objects;
create policy passport_photos_select_own
  on storage.objects for select to authenticated
  using (bucket_id = 'passport-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists passport_photos_insert_own on storage.objects;
create policy passport_photos_insert_own
  on storage.objects for insert to authenticated
  with check (bucket_id = 'passport-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists passport_photos_delete_own on storage.objects;
create policy passport_photos_delete_own
  on storage.objects for delete to authenticated
  using (bucket_id = 'passport-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
