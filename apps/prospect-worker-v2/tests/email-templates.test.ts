import { describe, expect, it } from 'vitest'
import { renderEmail } from '../src/email/templates.js'

describe('renderEmail', () => {
  const approvedPayload = { first_name: 'Karim', business_name: 'Maison Fade' }

  it('renders the approval email with a CTA pointing at the pro sign-in', () => {
    const email = renderEmail('professional_application_approved', 'fr', approvedPayload, 'https://fadeup.app')

    expect(email.subject).toBe('Votre demande FadeUp a été approuvée')
    expect(email.text).toContain('Bonne nouvelle, votre demande a été approuvée.')
    expect(email.text).toContain('https://fadeup.app/pro/login')
    expect(email.html).toContain('Accéder à FadeUp Pro')
  })

  it('falls back to English rather than sending a half-translated message', () => {
    const email = renderEmail('professional_application_approved', 'sv', approvedPayload, 'https://fadeup.app')

    expect(email.subject).toBe('Your FadeUp application has been approved')
  })

  it('includes an applicant-facing rejection reason when one was written', () => {
    const email = renderEmail(
      'professional_application_rejected',
      'fr',
      { first_name: 'Karim', business_name: 'Maison Fade', rejection_reason: 'Nous ne couvrons pas encore votre zone.' },
      'https://fadeup.app',
    )

    expect(email.text).toContain('Nous ne couvrons pas encore votre zone.')
    expect(email.html).toContain('Nous ne couvrons pas encore votre zone.')
  })

  it('omits the reason block entirely when no reason was given', () => {
    const email = renderEmail(
      'professional_application_rejected',
      'en',
      { first_name: 'Karim', business_name: 'Maison Fade' },
      'https://fadeup.app',
    )

    expect(email.html).not.toContain('blockquote')
    expect(email.text).toContain('not able to approve it at this time')
  })

  it('carries no token, tracking pixel or magic link', () => {
    // The approval RPC never places credentials in the payload, and this
    // renderer must not invent any: the CTA is an ordinary sign-in link.
    const email = renderEmail('professional_application_approved', 'en', approvedPayload, 'https://fadeup.app')

    expect(email.html).not.toMatch(/token|access_token|<img/i)
    expect(email.text).not.toMatch(/token/i)
  })

  it('escapes applicant-controlled text so a business name cannot inject markup', () => {
    const email = renderEmail(
      'professional_application_rejected',
      'en',
      { first_name: 'Karim', business_name: '<script>alert(1)</script>' },
      'https://fadeup.app',
    )

    expect(email.html).not.toContain('<script>')
    expect(email.html).toContain('&lt;script&gt;')
  })

  it('does not double a trailing slash on the base URL', () => {
    const email = renderEmail('professional_application_approved', 'en', approvedPayload, 'https://fadeup.app/')

    expect(email.text).toContain('https://fadeup.app/pro/login')
    expect(email.text).not.toContain('fadeup.app//pro/login')
  })
})
