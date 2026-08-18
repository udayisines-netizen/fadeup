# FadeUp — Google & Apple sign-in setup

Operator guide for enabling the two universal authentication providers.

Kept here rather than appended to `.env.example` on purpose: that file is
vendored from upstream Supabase and is overwritten by `sh run.sh update`.
FadeUp-specific configuration belongs in FadeUp-owned files —
`docker-compose.fadeup-oauth.yml` and this document.

---

## What this enables, and what it deliberately does not

Enabling these providers lets **any** FadeUp user authenticate with Google or
Apple — customers, professionals, business owners, staff, and platform
owners/admins/support alike. All five sign-in doors (`/login`, `/register`,
`/pro/login`, `/pro/register`, `/platform/login`) use the same provider
configuration and the same `auth.users` namespace, because one FadeUp
identity may be several of those things at once.

It grants **no** FadeUp role.

| Question | Answered by | Never answered by |
|---|---|---|
| Who is this? | Google / Apple / password | — |
| Are they platform staff? | `public.platform_members` | the provider, the email domain, or user metadata |
| Do they run a business? | `public.memberships` | the provider |
| Can they see this tenant's data? | RLS, on every request | the provider |

`public.platform_members` has **no client-facing INSERT/UPDATE/DELETE grant
at all**. The only writers are `claim_platform_owner_bootstrap()` and
`accept_platform_invitation()`, both requiring an unguessable single-use
token, plus an operator at the database. There is no provider path to it.
A Google account whose metadata literally claims `{"role":"platform_admin"}`
receives nothing — asserted behaviourally in
`supabase/VERIFY_LOTS_A_A5_B_2026_08_18.sql`.

This is **not** a substitute for platform MFA, which remains a separate,
later security lot.

---

## Prerequisite: the API must be reachable over HTTPS

Google refuses a plain-HTTP or bare-IP redirect URI. Apple additionally
requires a registered domain and an HTTPS return URL.

Configure the host nginx to proxy the Supabase API on the same origin as the
app **before** touching provider configuration — see
`infra/web/nginx-host-fadeup.conf.example`. Verify:

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://fadeup.jasmean.com/auth/v1/health
# expect 200
```

A provider pointed at an unreachable callback fails at the very last hop,
*after* the user has already approved consent — the most confusing possible
failure mode.

---

## The callback URI

Exactly this, for both providers:

```
https://fadeup.jasmean.com/auth/v1/callback
```

Note the two different URLs, which are easy to confuse:

| URL | Belongs to | Registered where |
|---|---|---|
| `https://fadeup.jasmean.com/auth/v1/callback` | GoTrue | Google Console / Apple Developer |
| `https://fadeup.jasmean.com/auth/callback` | the FadeUp app | `GOTRUE_URI_ALLOW_LIST` (already covered by the existing `https://fadeup.jasmean.com/**`) |

The provider redirects to the first; GoTrue then redirects the browser to the
second, which is the single post-auth resolver page.

---

## Google

1. Google Cloud console → **APIs & Services → OAuth consent screen**. External
   user type. Fill in app name, support email, and the FadeUp domain.
2. **APIs & Services → Credentials → Create credentials → OAuth client ID**,
   application type **Web application**.
3. Authorized JavaScript origin: `https://fadeup.jasmean.com`
4. Authorized redirect URI: `https://fadeup.jasmean.com/auth/v1/callback`
5. Put the client ID and secret in `infra/supabase/.env`:

```
FADEUP_GOOGLE_ENABLED=true
FADEUP_GOOGLE_CLIENT_ID=<client id>
FADEUP_GOOGLE_SECRET=<client secret>
```

---

## Apple

Sign in with Apple has more moving parts, and one of them expires.

1. Apple Developer → **Certificates, Identifiers & Profiles → Identifiers**.
   Create an **App ID** with the *Sign in with Apple* capability enabled.
2. Create a **Services ID** (this, not the App ID, is the OAuth client id).
   Enable *Sign in with Apple* on it and configure:
   - Domain: `fadeup.jasmean.com`
   - Return URL: `https://fadeup.jasmean.com/auth/v1/callback`
3. **Keys** → create a key with *Sign in with Apple* enabled. Download the
   `.p8` **once** — Apple will not offer it again. Note the Key ID and your
   Team ID.
4. Generate the client secret. It is **a JWT signed with that .p8**, not a
   static string: `iss` = Team ID, `sub` = Services ID,
   `aud` = `https://appleid.apple.com`, `alg` = ES256, `kid` = Key ID.
5. Put the Services ID and generated JWT in `infra/supabase/.env`:

```
FADEUP_APPLE_ENABLED=true
FADEUP_APPLE_CLIENT_ID=<services id, e.g. com.fadeup.web>
FADEUP_APPLE_SECRET=<generated JWT>
```

### Rotation — do not skip this

Apple caps the client-secret JWT at **six months**. When it expires, Apple
sign-in stops working with an opaque `invalid_client`. Diarise regeneration,
and keep the `.p8` somewhere the rotation can actually reach.

**Never commit the `.p8`, and never commit a generated secret.** Neither
belongs in this repository at any point.

### Native apps later

`GOTRUE_EXTERNAL_APPLE_CLIENT_ID` accepts a comma-separated list. FadeUp iOS
and FadeUp Pro iOS join it by adding their bundle IDs — no second provider
configuration, no second identity namespace, and no change to any of the
authorization rules above.

---

## Apply

```sh
cd infra/supabase
sh run.sh config add fadeup-oauth     # once: adds the override to COMPOSE_FILE
docker compose up -d auth             # recreates ONLY the auth container
```

Confirm the providers are live:

```sh
curl -s https://fadeup.jasmean.com/auth/v1/settings -H "apikey: $ANON_KEY" \
  | python3 -c 'import sys,json; e=json.load(sys.stdin)["external"]; print("google", e["google"], "| apple", e["apple"])'
# expect: google True | apple True
```

`/auth/v1/settings` is the authority on which providers this GoTrue build
supports and which are configured. It is how the variable names in
`docker-compose.fadeup-oauth.yml` were established rather than guessed.

---

## Private Relay, and missing names

A visitor using **Hide My Email** arrives with a
`…@privaterelay.appleid.com` address that is not their real one, and Apple
returns their name **at most once**, on the very first authorization.

FadeUp handles both, structurally:

- `handle_new_user()` stores `NULL` rather than an empty string when no name
  is supplied, and only ever runs on **INSERT** — so a later Apple sign-in
  carrying no name cannot blank out a name the user has since set.
- A missing name is not an authentication failure. Onboarding and the
  profile screen ask for it later, when asking makes sense.
- Never merge two accounts because their names or emails look similar.
  Identity linking is Supabase's, based on verified emails, plus the
  explicit `linkIdentity()` flow for an already-authenticated user. A relay
  address genuinely is a different identity until the user themselves links
  it.
