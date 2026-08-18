# Worker V2 — WhatsApp Business Cloud API

FadeUp sends outreach through the **official Meta WhatsApp Business
Platform (Cloud API)** and nothing else.

There is no WhatsApp Web automation, no browser driver, no
reverse-engineered client library, and no code path that could become one.
When Meta credentials are absent the Worker uses an in-process **mock**
that sends nothing — it never silently falls back to an unofficial
transport.

---

## Provider modes

`whatsapp_accounts.provider_mode` decides how a campaign sends:

| Mode | Behaviour |
|---|---|
| `mock` (default) | `MockProvider` records what *would* have been sent and returns a synthetic id prefixed `wamid.MOCK.`. No network call. The full pipeline — eligibility, template selection, rendering, funnel states — executes normally. |
| `live` | `CloudApiProvider` calls `graph.facebook.com`. Requires the access token named by `access_token_env_var` to be present in the Worker environment; if it is absent, `buildProvider()` logs the missing variable **by name** and falls back to the mock rather than failing or improvising. |

The default is `mock`, and `enumValue()` in the frontend also defaults an
unrecognised value to `mock`. The safe direction is always "sends
nothing", never "sends for real".

---

## Secrets never touch the database

`whatsapp_accounts` stores only non-secret routing identifiers: the WABA
id, the phone number id, the display number, and
`access_token_env_var` — the **name** of the environment variable holding
the token, never its value.

A trigger (`private.whatsapp_accounts_reject_secrets`) rejects any insert
whose `waba_id` or `phone_number_id` looks like an access token, and
VERIFY asserts that no column named `access_token`, `app_secret`,
`verify_token`, `token` or `secret` exists on the table.

The Cloud API token is sent as an `Authorization: Bearer` header, never as
a query parameter — a query parameter would land in provider access logs.
Error messages persisted to `whatsapp_messages.error_message` are readable
by `platform_support`, so no send-path error ever embeds the URL or token.

---

## Idempotency: how a double-send is made impossible

The order of operations is the whole design:

1. **Re-check eligibility in SQL** immediately before sending. The
   recipient passed the gate when it was queued, but that may have been
   days ago and the barber may have opted out since. A stale pass is not
   a pass.
2. **Reserve the idempotency key and INSERT the message row first**, in
   `pending`. `whatsapp_messages.idempotency_key` is UNIQUE.
3. **Only then** call the provider.

Doing (3) before (2) is the classic double-send bug: the API call
succeeds, the process dies before recording it, the job retries, and a
barber receives the same cold message twice.

The key is `sha256("fadeup:whatsapp:<recipient_id>:<template_id>")` —
deliberately **not** time-based, so a retry of the same logical send
produces the same key and collides.

---

## Webhooks

`src/whatsapp/webhook-server.ts` serves exactly two routes and is meant to
sit behind the existing Nginx TLS terminator. It is **disabled by
default** (`WEBHOOK_HTTP_ENABLED=false`) — the Worker is a pure outbound
process unless you turn it on.

| Property | How it is guaranteed |
|---|---|
| **Authenticity** | `X-Hub-Signature-256` verified against `META_APP_SECRET` over the **raw** request bytes, with a constant-time comparison. An unverified payload is stored for forensics and **never processed**. |
| **Idempotency** | Every envelope is keyed by a stable provider event id under a UNIQUE index. Meta retries aggressively; a redelivery is a no-op. |
| **Order independence** | Statuses apply as monotonic advances (`sent` → `delivered` → `read`). A late `sent` cannot move a message backwards, and a delivery receipt cannot regress a recipient who has already replied or converted. |
| **Malformed input** | `parseWebhookPayload()` is total: an unrecognised shape yields zero events rather than an exception. |
| **Retry storms** | Always answers `200` once the envelope is durable. A `5xx` would make Meta redeliver the same payload on an exponential schedule for days. |
| **Body size** | Capped at 1 MB before parsing. |

### Reply handling

Only **one** inbound signal is acted on automatically: a deterministic
opt-out keyword match (`isOptOutMessage`), covering the bare `STOP`
convention plus French and English phrasings, accent-insensitive. An
opt-out immediately withdraws channel eligibility **and** adds a global
phone suppression, so re-discovery under a new prospect id cannot
resurrect the contact.

Everything else is recorded as `replied` and waits for a human to classify
it as positive or negative in `/platform → Outreach → Replies`. The Worker
never infers sentiment — that is what makes the `positive_reply` label
trustworthy enough to train on later.

---

## Meta setup checklist

Only the steps this implementation actually requires.

1. **Meta Business** — create or select one at [business.facebook.com](https://business.facebook.com).
2. **Meta App** — at [developers.facebook.com/apps](https://developers.facebook.com/apps), create a **Business**-type app.
3. **Add the WhatsApp product** to the app.
4. **WABA** — create or select a WhatsApp Business Account.
5. **Phone number** — add and verify a number. It must not be registered to the consumer WhatsApp or WhatsApp Business app.
6. **Phone Number ID** — copy it from *WhatsApp → API Setup*. → `whatsapp_accounts.phone_number_id`
7. **WABA ID** — from the same screen. → `whatsapp_accounts.waba_id`
8. **Access token** — create a **System User** in Business Settings with the `whatsapp_business_messaging` and `whatsapp_business_management` permissions, then generate a long-lived token. → `META_WHATSAPP_ACCESS_TOKEN`
   *The 24-hour token on the API Setup screen is for testing only.*
9. **App Secret** — *App Settings → Basic → App Secret*. → `META_APP_SECRET`
10. **Verify token** — invent a high-entropy string. Put the same value in `META_WEBHOOK_VERIFY_TOKEN` and in the Meta dashboard.
11. **Configure the webhook** — *WhatsApp → Configuration → Webhooks*:
    - Callback URL: `https://<your-public-host>/webhooks/whatsapp`
    - Verify token: the value from step 10
    - Meta will `GET` the URL immediately; it must already be reachable over **HTTPS** with a valid certificate.
12. **Subscribe to fields** — `messages` is the only one this implementation consumes. It carries both inbound messages and delivery statuses.
13. **Create message templates** — in the WhatsApp Manager, one per FadeUp template **per language**. Body parameters are positional (`{{1}}`, `{{2}}`, …); record the mapping in `whatsapp_template_mappings.variable_order`.
14. **Wait for approval.** Meta review typically takes minutes to hours. `whatsapp_template_mappings.approval_state` tracks it.
15. **Add test recipients** — *API Setup → To*. Up to 5 numbers can be messaged before business verification.
16. **Switch to live** — only when you are ready: set `whatsapp_accounts.provider_mode = 'live'`. Until then everything runs against the mock.

### Required templates

FadeUp blocks outreach rather than sending the wrong language, so each
locale you intend to contact needs approved copy on **both** sides — a
FadeUp `outreach_templates` row *and* a Meta-approved template mapped to
it.

| FadeUp locale | Meta template language |
|---|---|
| `fr-FR` | `fr` |
| `en-GB` | `en_GB` |
| `en-US` | `en_US` |

---

## Public HTTPS endpoint

The webhook needs a public HTTPS URL. **This has not been provisioned** —
at the time of writing the Worker publishes no host port and no Nginx
vhost points at it.

To provision it:

1. Set `WEBHOOK_HTTP_ENABLED=true` in `infra/worker/.env.worker`.
2. Add an Nginx `location /webhooks/whatsapp` on an existing FadeUp TLS
   vhost, proxying to `fadeup-prospect-worker-v2:8088`.
3. Confirm the certificate is valid — Meta rejects self-signed.
4. Only then enter the callback URL in the Meta dashboard.

Do **not** publish the container port directly to the host.

---

## Test status

The provider, sender, webhook parser, signature verification, opt-out
matcher and idempotency key are covered by unit tests
(`tests/outreach.test.ts`, `tests/webhook-planner.test.ts`).

**No real WhatsApp message has been sent to any prospect.** Every account
is in `mock` mode, and no Meta credentials are configured.
