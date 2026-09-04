import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DateTime } from '@/shared/ui/DateTime'
import { deviceTimezone, formatDateTime, timezonesDiffer } from '@/shared/lib/format'

// Un instant fixe : 2026-06-15T12:00:00Z (été — Paris = UTC+2).
const INSTANT = '2026-06-15T12:00:00.000Z'

describe('DateTime', () => {
  it('convertit vers le fuseau du lieu (Paris, été : 14:00)', () => {
    expect(formatDateTime(INSTANT, 'Europe/Paris', 'time', 'fr')).toMatch(/14[:h]00/)
  })

  it('convertit vers un autre fuseau pour le même instant (Londres : 13:00)', () => {
    expect(formatDateTime(INSTANT, 'Europe/London', 'time', 'fr')).toMatch(/13[:h]00/)
  })

  it('détecte quand deux fuseaux diffèrent à cet instant', () => {
    expect(timezonesDiffer('Europe/Paris', 'Europe/London', new Date(INSTANT))).toBe(true)
    expect(timezonesDiffer('Europe/Paris', 'Europe/Paris', new Date(INSTANT))).toBe(false)
  })

  it('mentionne le fuseau quand celui du lieu diffère de l’appareil', () => {
    const device = deviceTimezone()
    const other = device === 'Europe/Paris' ? 'America/New_York' : 'Europe/Paris'
    render(<DateTime value={INSTANT} timezone={other} format="time" />)
    // La mention est présente (texte secondaire contenant le libellé du fuseau).
    expect(screen.getByText(/\(/)).toBeInTheDocument()
  })

  it('expose un <time> machine-lisible en ISO UTC', () => {
    render(<DateTime value={INSTANT} timezone="Europe/Paris" format="datetime" />)
    const time = document.querySelector('time')
    expect(time?.getAttribute('datetime')).toBe(INSTANT)
  })
})
