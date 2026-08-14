/**
 * Transactional email bodies for the professional application workflow.
 *
 * Rendered here rather than in Postgres so the copy lives with the rest of
 * the application code and can be reviewed like any other text. The outbox
 * row carries only structured data (`payload`), never a pre-rendered body,
 * so wording can be corrected without rewriting queued rows.
 *
 * Deliberately plain: no tracking pixels, no magic links, no tokens. The CTA
 * is an ordinary link to /pro/login, so nothing sensitive is ever placed in
 * an email.
 */

export type EmailTemplate = 'professional_application_approved' | 'professional_application_rejected'

export interface RenderedEmail {
  subject: string
  text: string
  html: string
}

interface Copy {
  subject: string
  greeting: (firstName: string) => string
  lines: string[]
  ctaLabel?: string
}

// Locale coverage mirrors the app's supported locales; anything else falls
// back to English rather than sending a half-translated message.
const APPROVED: Record<string, Copy> & { en: Copy } = {
  en: {
    subject: 'Your FadeUp application has been approved',
    greeting: (name) => `Hi ${name},`,
    lines: [
      'Good news — your application has been approved.',
      'You can now access your FadeUp Pro workspace.',
    ],
    ctaLabel: 'Go to FadeUp Pro',
  },
  fr: {
    subject: 'Votre demande FadeUp a été approuvée',
    greeting: (name) => `Bonjour ${name},`,
    lines: [
      'Bonne nouvelle, votre demande a été approuvée.',
      'Vous pouvez maintenant accéder à votre espace professionnel FadeUp.',
    ],
    ctaLabel: 'Accéder à FadeUp Pro',
  },
}

const REJECTED: Record<string, Copy> & { en: Copy } = {
  en: {
    subject: 'About your FadeUp application',
    greeting: (name) => `Hi ${name},`,
    lines: [
      'We have reviewed your application to join FadeUp.',
      'Unfortunately we are not able to approve it at this time.',
    ],
  },
  fr: {
    subject: 'À propos de votre demande FadeUp',
    greeting: (name) => `Bonjour ${name},`,
    lines: [
      "Nous avons étudié votre demande d'inscription à FadeUp.",
      "Nous ne pouvons malheureusement pas l'approuver pour le moment.",
    ],
  },
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function renderEmail(
  template: EmailTemplate,
  locale: string,
  payload: Record<string, unknown>,
  appBaseUrl: string,
): RenderedEmail {
  const table = template === 'professional_application_approved' ? APPROVED : REJECTED
  const copy = table[locale] ?? table.en
  const firstName = typeof payload.first_name === 'string' && payload.first_name ? payload.first_name : 'there'
  const businessName = typeof payload.business_name === 'string' ? payload.business_name : ''

  // Only the reason a reviewer explicitly wrote FOR THE APPLICANT is ever
  // included. The internal note is not in the payload at all — the review
  // function never puts it there.
  const reason = typeof payload.rejection_reason === 'string' && payload.rejection_reason ? payload.rejection_reason : null

  const ctaUrl = `${appBaseUrl.replace(/\/$/, '')}/pro/login`

  const textLines = [copy.greeting(firstName), '', ...copy.lines]
  if (businessName) textLines.splice(2, 0, businessName)
  if (reason) textLines.push('', reason)
  if (copy.ctaLabel) textLines.push('', `${copy.ctaLabel}: ${ctaUrl}`)
  textLines.push('', '— FadeUp')

  const htmlBody = [
    `<p>${escapeHtml(copy.greeting(firstName))}</p>`,
    businessName ? `<p style="color:#666;margin:0 0 16px">${escapeHtml(businessName)}</p>` : '',
    ...copy.lines.map((line) => `<p>${escapeHtml(line)}</p>`),
    reason ? `<blockquote style="margin:16px 0;padding:12px 16px;border-left:3px solid #ddd;color:#444">${escapeHtml(reason)}</blockquote>` : '',
    copy.ctaLabel
      ? `<p style="margin:24px 0"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#111;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600">${escapeHtml(copy.ctaLabel)}</a></p>`
      : '',
    `<p style="color:#888;font-size:12px;margin-top:32px">— FadeUp</p>`,
  ]
    .filter(Boolean)
    .join('\n')

  return {
    subject: copy.subject,
    text: textLines.join('\n'),
    html: `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:520px">${htmlBody}</div>`,
  }
}
