/**
 * Live end-to-end verification of the professional application approval
 * lifecycle, over real HTTP against the running self-hosted Supabase.
 *
 * Nothing here uses service_role for the actions under test: the applicant
 * and the reviewer both act with real JWTs obtained from GoTrue, so PostgREST
 * and RLS are exercised exactly as the browser would exercise them. The only
 * privileged step is seeding the reviewer's platform role, which is a
 * server-side act by definition (the product never lets anyone self-grant
 * one — that is the point of test 7).
 *
 * Secrets are read from disk and never printed.
 */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

function readEnvFile(path) {
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return out
}

const web = readEnvFile('/opt/fadeup/apps/web/.env.local')
const BASE = (web.VITE_SUPABASE_URL || '').replace(/\/$/, '')
const ANON = web.VITE_SUPABASE_ANON_KEY
if (!BASE || !ANON) throw new Error('missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY')

let pass = 0
let fail = 0
function check(label, ok, detail) {
  if (ok) {
    pass += 1
    console.log(`PASS: ${label}`)
  } else {
    fail += 1
    console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function sql(statement) {
  return execFileSync(
    'docker',
    ['exec', 'fadeup-supabase-db', 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc', statement],
    { encoding: 'utf8' },
  ).trim()
}

async function api(path, { method = 'GET', token, body, headers = {} } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token ?? ANON}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let json
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = text
  }
  return { status: response.status, body: json }
}

const stamp = Date.now()
const applicantEmail = `e2e-pro-${stamp}@fadeup.test`
const reviewerEmail = `e2e-platform-${stamp}@fadeup.test`
const customerEmail = `e2e-customer-${stamp}@fadeup.test`
const PASSWORD = `e2e-${stamp}-Aa!`

async function signUpAndSignIn(email, intent) {
  await api('/auth/v1/signup', {
    method: 'POST',
    body: { email, password: PASSWORD, data: { full_name: 'E2E User', signup_intent: intent } },
  })
  // Local stack may require confirmation; confirm server-side so the test can proceed.
  sql(`update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where email = '${email}'`)
  const signIn = await api('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email, password: PASSWORD },
  })
  if (!signIn.body?.access_token) throw new Error(`sign-in failed for ${email}: ${JSON.stringify(signIn.body)}`)
  return { token: signIn.body.access_token, userId: signIn.body.user.id }
}

async function main() {
  console.log('=== 1. accounts ===')
  const applicant = await signUpAndSignIn(applicantEmail, 'pro')
  const reviewer = await signUpAndSignIn(reviewerEmail, 'pro')
  const customer = await signUpAndSignIn(customerEmail, 'customer')
  check('applicant, reviewer and customer accounts created over HTTP', Boolean(applicant.token && reviewer.token && customer.token))

  // Seed the reviewer's platform role BEFORE the application is submitted.
  // Notification fan-out is an event, delivered to the platform members who
  // exist at submit time — a reviewer onboarded afterwards still sees the
  // pending queue (test 10), which is the authoritative work surface.
  // This is the one privileged step: the product never lets anyone grant
  // themselves a platform role, which is exactly what test 7 proves.
  sql(
    `insert into public.platform_members (user_id, role) values ('${reviewer.userId}','platform_owner') on conflict (user_id) do update set role='platform_owner'`,
  )

  check(
    'a brand-new professional account holds no membership and no platform role',
    sql(`select count(*) from public.memberships where user_id='${applicant.userId}'`) === '0' &&
      sql(`select count(*) from public.platform_members where user_id='${applicant.userId}'`) === '0',
  )

  console.log('=== 2. submit the application ===')
  const submit = await api('/rest/v1/rpc/submit_professional_application', {
    method: 'POST',
    token: applicant.token,
    body: {
      p_first_name: 'Karim',
      p_last_name: 'Benali',
      p_phone: '06 12 34 56 78',
      p_business_name: `E2E Fade City ${stamp}`,
      p_professional_type: 'barbershop',
      p_city: 'Lyon',
      p_country: 'FR',
    },
  })
  const application = Array.isArray(submit.body) ? submit.body[0] : submit.body
  check('submit_professional_application succeeded over HTTP', submit.status === 200 && Boolean(application?.id), JSON.stringify(submit.body).slice(0, 200))
  check('status is pending_review, chosen by the server', application?.status === 'pending_review')
  check('the phone number was normalized to E.164 server-side', application?.phone === '+33612345678', application?.phone)
  check(
    'submitting granted no membership and no organization',
    sql(`select count(*) from public.memberships where user_id='${applicant.userId}'`) === '0' && !application?.organization_id,
  )

  console.log('=== 3. the applicant sees their own pending application ===')
  const mine = await api('/rest/v1/rpc/get_my_professional_application', { method: 'POST', token: applicant.token, body: {} })
  const myRow = Array.isArray(mine.body) ? mine.body[0] : mine.body
  check('get_my_professional_application returns the caller their row', myRow?.id === application?.id)
  check('the applicant-facing shape carries no internal_note field at all', myRow !== null && !('internal_note' in (myRow ?? {})))

  console.log('=== 4. submission is idempotent ===')
  const resubmit = await api('/rest/v1/rpc/submit_professional_application', {
    method: 'POST',
    token: applicant.token,
    body: {
      p_first_name: 'Karim',
      p_last_name: 'Benali',
      p_phone: '06 12 34 56 78',
      p_business_name: `E2E Fade City ${stamp}`,
      p_professional_type: 'barbershop',
    },
  })
  const resubmitted = Array.isArray(resubmit.body) ? resubmit.body[0] : resubmit.body
  check('re-submitting returns the same application rather than creating a second', resubmitted?.id === application?.id)
  check(
    'exactly one application row exists for this account',
    sql(`select count(*) from public.professional_applications where user_id='${applicant.userId}'`) === '1',
  )

  console.log('=== 5. pending applicant is blocked from activating themselves ===')
  const selfActivate = await api('/rest/v1/rpc/create_organization', {
    method: 'POST',
    token: applicant.token,
    body: { p_name: 'Self Activated Shop', p_slug: `self-activated-${stamp}` },
  })
  check('create_organization refuses a pending applicant', selfActivate.status >= 400, `status ${selfActivate.status}`)
  check(
    'no organization was created behind the refusal',
    sql(`select count(*) from public.memberships where user_id='${applicant.userId}'`) === '0',
  )

  console.log('=== 6. the applicant cannot approve themselves ===')
  const selfApprove = await api('/rest/v1/rpc/review_professional_application', {
    method: 'POST',
    token: applicant.token,
    body: { p_application_id: application.id, p_decision: 'approve', p_rejection_reason: null, p_internal_note: null },
  })
  check('review_professional_application rejects a non-platform caller', selfApprove.status >= 400, `status ${selfApprove.status}`)

  const selfPatch = await api(`/rest/v1/professional_applications?id=eq.${application.id}`, {
    method: 'PATCH',
    token: applicant.token,
    body: { status: 'approved' },
    headers: { Prefer: 'return=representation' },
  })
  check(
    'a direct PATCH to status is refused by the column guard',
    selfPatch.status >= 400 || sql(`select status from public.professional_applications where id='${application.id}'`) === 'pending_review',
    `status ${selfPatch.status}`,
  )

  console.log('=== 7. no escalation to platform roles ===')
  const selfPlatform = await api('/rest/v1/platform_members', {
    method: 'POST',
    token: applicant.token,
    body: { user_id: applicant.userId, role: 'platform_owner' },
  })
  check('an applicant cannot insert themselves into platform_members', selfPlatform.status >= 400, `status ${selfPlatform.status}`)
  check(
    'still no platform role after every attempt above',
    sql(`select count(*) from public.platform_members where user_id='${applicant.userId}'`) === '0',
  )

  console.log('=== 8. a customer cannot see the review queue ===')
  const customerPeek = await api('/rest/v1/professional_applications?select=id', { token: customer.token })
  check(
    'a customer reading professional_applications gets nothing',
    customerPeek.status >= 400 || (Array.isArray(customerPeek.body) && customerPeek.body.length === 0),
  )

  console.log('=== 9. the platform owner is notified ===')
  const notifications = await api(
    `/rest/v1/platform_notifications?select=id,type,title,target_id,read_at&target_id=eq.${application.id}`,
    { token: reviewer.token },
  )
  check(
    'a platform notification exists for the new application',
    Array.isArray(notifications.body) && notifications.body.length >= 1,
    JSON.stringify(notifications.body).slice(0, 200),
  )
  check(
    'the notification points at the application and is unread',
    notifications.body?.[0]?.type === 'professional_application_submitted' && notifications.body?.[0]?.read_at === null,
  )

  console.log('=== 10. the reviewer sees the queue with contact details ===')
  const queue = await api(
    `/rest/v1/professional_applications?select=id,business_name,phone,email,city,status&id=eq.${application.id}`,
    { token: reviewer.token },
  )
  const queued = queue.body?.[0]
  check('the reviewer can read the pending application', queued?.id === application.id)
  check('the reviewer sees a dialable E.164 phone number', queued?.phone === '+33612345678', queued?.phone)
  check('the reviewer sees the applicant email from the verified identity', queued?.email === applicantEmail, queued?.email)

  const notificationId = notifications.body?.[0]?.id
  if (notificationId) {
    const markRead = await api('/rest/v1/rpc/mark_platform_notification_read', {
      method: 'POST',
      token: reviewer.token,
      body: { p_notification_id: notificationId },
    })
    const after = await api(`/rest/v1/platform_notifications?select=read_at&id=eq.${notificationId}`, { token: reviewer.token })
    check(
      'the reviewer can mark the notification read',
      markRead.status < 400 && Boolean(after.body?.[0]?.read_at),
      `status ${markRead.status}`,
    )
  } else {
    check('the reviewer can mark the notification read', false, 'no notification to mark')
  }

  console.log('=== 11. APPROVE ===')
  const approve = await api('/rest/v1/rpc/review_professional_application', {
    method: 'POST',
    token: reviewer.token,
    body: {
      p_application_id: application.id,
      p_decision: 'approve',
      p_rejection_reason: null,
      p_internal_note: 'E2E: called, confirmed the address.',
    },
  })
  check('the platform owner can approve', approve.status < 400, `status ${approve.status} ${JSON.stringify(approve.body).slice(0, 200)}`)

  const decided = await api('/rest/v1/rpc/get_my_professional_application', { method: 'POST', token: applicant.token, body: {} })
  const decidedRow = Array.isArray(decided.body) ? decided.body[0] : decided.body
  check('the applicant now sees status approved', decidedRow?.status === 'approved')
  check('the applicant sees the organization that was created for them', Boolean(decidedRow?.organization_id))

  const orgId = decidedRow?.organization_id
  check(
    'the APPLICANT owns the new organization',
    sql(`select role from public.memberships where user_id='${applicant.userId}' and organization_id='${orgId}'`) === 'owner',
  )
  check(
    'the REVIEWER got no membership in the applicant’s shop',
    sql(`select count(*) from public.memberships where user_id='${reviewer.userId}' and organization_id='${orgId}'`) === '0',
  )
  check(
    'approval granted the applicant no platform role',
    sql(`select count(*) from public.platform_members where user_id='${applicant.userId}'`) === '0',
  )
  check(
    'approval wrote an audit event naming the reviewer as actor',
    sql(
      `select count(*) from public.platform_audit_log where target_id='${application.id}' and actor_user_id='${reviewer.userId}' and action like '%approve%'`,
    ) === '1',
  )
  check(
    'exactly one approval email was queued',
    sql(
      `select count(*) from public.email_outbox where to_email='${applicantEmail}' and template='professional_application_approved'`,
    ) === '1',
  )
  check(
    'the queued email carries no internal note',
    sql(
      `select count(*) from public.email_outbox where to_email='${applicantEmail}' and payload::text ilike '%confirmed the address%'`,
    ) === '0',
  )

  console.log('=== 12. the approved professional can actually use their workspace ===')
  const orgRead = await api(`/rest/v1/organizations?select=id,name&id=eq.${orgId}`, { token: applicant.token })
  check('the approved professional can read their own organization', orgRead.body?.[0]?.id === orgId)

  console.log('=== 13. approval is idempotent ===')
  const reApprove = await api('/rest/v1/rpc/review_professional_application', {
    method: 'POST',
    token: reviewer.token,
    body: { p_application_id: application.id, p_decision: 'approve', p_rejection_reason: null, p_internal_note: null },
  })
  check('re-approving does not error', reApprove.status < 400, `status ${reApprove.status}`)
  check(
    're-approving created no second organization, membership or email',
    sql(`select count(*) from public.memberships where user_id='${applicant.userId}'`) === '1' &&
      sql(`select count(*) from public.email_outbox where to_email='${applicantEmail}'`) === '1',
  )

  console.log('=== 14. REFUSE (a second applicant) ===')
  const rejectedEmail = `e2e-refused-${stamp}@fadeup.test`
  const refused = await signUpAndSignIn(rejectedEmail, 'pro')
  const refusedSubmit = await api('/rest/v1/rpc/submit_professional_application', {
    method: 'POST',
    token: refused.token,
    body: {
      p_first_name: 'Sam',
      p_last_name: 'Diallo',
      p_phone: '+33711223344',
      p_business_name: `E2E Studio Nord ${stamp}`,
      p_professional_type: 'private_studio',
    },
  })
  const refusedApp = Array.isArray(refusedSubmit.body) ? refusedSubmit.body[0] : refusedSubmit.body
  check('the second application was created', Boolean(refusedApp?.id))

  const reject = await api('/rest/v1/rpc/review_professional_application', {
    method: 'POST',
    token: reviewer.token,
    body: {
      p_application_id: refusedApp.id,
      p_decision: 'reject',
      p_rejection_reason: 'We could not confirm the business address.',
      p_internal_note: 'E2E INTERNAL: suspected duplicate listing.',
    },
  })
  check('the platform owner can refuse', reject.status < 400, `status ${reject.status}`)

  const refusedView = await api('/rest/v1/rpc/get_my_professional_application', { method: 'POST', token: refused.token, body: {} })
  const refusedRow = Array.isArray(refusedView.body) ? refusedView.body[0] : refusedView.body
  check('the refused applicant sees status rejected', refusedRow?.status === 'rejected')
  check(
    'the refused applicant sees the reason written for them',
    refusedRow?.rejection_reason === 'We could not confirm the business address.',
  )
  check(
    'the refused applicant never receives the internal note',
    !JSON.stringify(refusedRow ?? {}).includes('suspected duplicate'),
  )
  check(
    'refusal granted no organization and no membership',
    sql(`select count(*) from public.memberships where user_id='${refused.userId}'`) === '0' && !refusedRow?.organization_id,
  )

  const refusedActivate = await api('/rest/v1/rpc/create_organization', {
    method: 'POST',
    token: refused.token,
    body: { p_name: 'Refused Shop', p_slug: `refused-${stamp}` },
  })
  check('a refused applicant still cannot create an organization', refusedActivate.status >= 400, `status ${refusedActivate.status}`)

  check(
    'exactly one rejection email was queued, carrying the public reason only',
    sql(
      `select count(*) from public.email_outbox where to_email='${rejectedEmail}' and template='professional_application_rejected' and payload::text like '%could not confirm the business address%'`,
    ) === '1',
  )
  check(
    'the rejection email carries no internal note',
    sql(`select count(*) from public.email_outbox where to_email='${rejectedEmail}' and payload::text ilike '%suspected duplicate%'`) === '0',
  )
  check(
    'refusal wrote an audit event',
    Number(sql(`select count(*) from public.platform_audit_log where target_id='${refusedApp.id}'`)) >= 1,
  )

  console.log('=== 15. the outbox is dispatchable and platform-visible only ===')
  const outboxAsApplicant = await api('/rest/v1/email_outbox?select=id', { token: applicant.token })
  check(
    'the applicant cannot read the email outbox',
    outboxAsApplicant.status >= 400 || (Array.isArray(outboxAsApplicant.body) && outboxAsApplicant.body.length === 0),
  )
  const outboxAsReviewer = await api('/rest/v1/email_outbox?select=id,template,status&limit=5', { token: reviewer.token })
  check('the platform owner can see the outbox', Array.isArray(outboxAsReviewer.body) && outboxAsReviewer.body.length >= 1)

  const claimed = sql(
    `select count(*) from private.claim_next_email(10) where to_email in ('${applicantEmail}','${rejectedEmail}')`,
  )
  check('the dispatcher can lease both queued emails', claimed === '2', `claimed ${claimed}`)

  console.log('=== cleanup ===')
  const emails = [applicantEmail, reviewerEmail, customerEmail, rejectedEmail].map((e) => `'${e}'`).join(',')
  sql(`delete from public.email_outbox where to_email in (${emails})`)
  sql(
    `delete from public.organizations where id in (select organization_id from public.professional_applications where user_id in (select id from auth.users where email in (${emails})) and organization_id is not null)`,
  )
  sql(`delete from public.professional_applications where user_id in (select id from auth.users where email in (${emails}))`)
  sql(`delete from public.platform_notifications where recipient_user_id in (select id from auth.users where email in (${emails}))`)
  sql(`delete from public.platform_audit_log where actor_user_id in (select id from auth.users where email in (${emails}))`)
  sql(`delete from public.platform_members where user_id in (select id from auth.users where email in (${emails}))`)
  sql(`delete from auth.users where email in (${emails})`)
  const leftover = sql(`select count(*) from auth.users where email in (${emails})`)
  check('test fixtures removed', leftover === '0', `${leftover} users left`)

  console.log(`\n=== ${pass} passed, ${fail} failed ===`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error('E2E ABORTED:', error.message)
  process.exit(1)
})
