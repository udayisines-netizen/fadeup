import { describe, expect, it } from 'vitest'
import { buildQueueLink, parseQueueLink } from '@/shared/lib/queueLink'

const TOKEN = 'a'.repeat(32)

describe('le lien que le QR encode', () => {
  it('construit /q/<slug>?l=…&t=… et se relit à l’identique', () => {
    const link = buildQueueLink('https://fade-up.com', 'side-agency', 'loc-1', TOKEN)
    const parsed = parseQueueLink(link)
    expect(parsed).toEqual({ slug: 'side-agency', locationId: 'loc-1', checkInToken: TOKEN })
  })

  it('consulter reste possible sans jeton', () => {
    const link = buildQueueLink('https://fade-up.com', 'side-agency', 'loc-1')
    const parsed = parseQueueLink(link)
    expect(parsed?.checkInToken).toBeNull()
    expect(parsed?.slug).toBe('side-agency')
  })

  it('rejette une valeur scannée qui n’est pas un lien de file', () => {
    expect(parseQueueLink('hello world')).toBeNull()
    expect(parseQueueLink('https://fade-up.com/shop/side-agency')).toBeNull()
    expect(parseQueueLink('https://autre-site.com/pas/une/file')).toBeNull()
  })

  it('refuse un jeton qui n’a pas la forme imposée par la base (32 hex)', () => {
    expect(parseQueueLink(`https://fade-up.com/q/x?t=short`)?.checkInToken).toBeNull()
    expect(parseQueueLink(`https://fade-up.com/q/x?t=${'Z'.repeat(32)}`)?.checkInToken).toBeNull()
    expect(parseQueueLink(`https://fade-up.com/q/x?t=${TOKEN}`)?.checkInToken).toBe(TOKEN)
  })

  it('décode le slug encodé', () => {
    const link = buildQueueLink('https://fade-up.com', 'salon éclair', 'loc-1', TOKEN)
    expect(parseQueueLink(link)?.slug).toBe('salon éclair')
  })
})
