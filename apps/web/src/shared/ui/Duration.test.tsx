import { describe, expect, it } from 'vitest'
import { formatDuration } from '@/shared/lib/format'

describe('Duration', () => {
  it('sous 60 minutes : « 45 min »', () => {
    expect(formatDuration(45, 'fr')).toMatch(/45\s*min/)
  })

  it('format long : « 45 minutes »', () => {
    expect(formatDuration(45, 'fr', 'long')).toMatch(/45 minutes/)
  })

  it('bascule à 60 : « 1 h », jamais « 60 min »', () => {
    const result = formatDuration(60, 'fr')
    expect(result).toMatch(/1\s*h/)
    expect(result).not.toMatch(/60/)
  })

  it('75 minutes : « 1 h 15 », jamais « 75 min »', () => {
    const result = formatDuration(75, 'fr')
    expect(result).toMatch(/1\s*h\s*15/)
    expect(result).not.toMatch(/75/)
  })

  it('reste correct en anglais', () => {
    expect(formatDuration(90, 'en')).toMatch(/1\s*h\s*30/)
  })
})
