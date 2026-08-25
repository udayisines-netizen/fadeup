import { describe, expect, it } from 'vitest'
import { EMAIL_TEMPLATES, renderEmail } from '../src/email/templates.js'

const BOOKING_TEMPLATES = [
  'booking_request_created',
  'booking_confirmed',
  'booking_declined',
  'booking_expired',
  'booking_cancelled',
  'booking_rescheduled',
] as const

describe('email template runtime contract', () => {
  it('mirrors every template currently emitted by the database', () => {
    expect(EMAIL_TEMPLATES).toEqual([
      'professional_application_approved',
      'professional_application_rejected',
      'booking_request_created',
      'booking_confirmed',
      'booking_declined',
      'booking_expired',
      'booking_cancelled',
      'booking_rescheduled',
    ])
  })

  it.each(BOOKING_TEMPLATES)(
    'fails closed for unimplemented template %s',
    (template) => {
      expect(() =>
        renderEmail(
          template,
          'en',
          { first_name: 'Test' },
          'https://fade-up.com',
        ),
      ).toThrow(`no copy for template "${template}"`)
    },
  )

  it('fails closed for an unknown future database value', () => {
    expect(() =>
      renderEmail(
        'future_template_not_yet_supported',
        'en',
        {},
        'https://fade-up.com',
      ),
    ).toThrow('no copy for template "future_template_not_yet_supported"')
  })
})
