/**
 * FadeUp brand constants for the marketing motion renderer.
 *
 * Duplicated here on purpose rather than imported from `apps/web`: this
 * package must stay renderable in isolation, with no Supabase client, no
 * router, no i18n runtime and no app state. The values are the official
 * charter, and they match the `--pro-*` tokens in apps/web/src/index.css.
 */

export const BRAND = {
  navy: '#0B1320',
  sunken: '#070D16',
  surface: '#101A29',
  elevated: '#16233A',
  emerald: '#17A36A',
  mint: '#3DDAA2',
  sage: '#B6CDBE',
  offwhite: '#F4F6F8',
} as const

export const BORDER = 'rgba(182, 205, 190, 0.16)'
export const BORDER_STRONG = 'rgba(182, 205, 190, 0.30)'

/**
 * The film's typeface.
 *
 * Satoshi is the charter face, but it is not licensed in this repository and
 * downloading a commercial font is not an option. Plus Jakarta Sans is the
 * closest open-licensed (OFL) geometric-humanist match, and it is loaded and
 * embedded by Remotion at render time.
 *
 * This is not cosmetic housekeeping: the render container has no fontconfig
 * and no system fonts at all, so a CSS font *stack* resolves to nothing and
 * every string in the film renders invisible. The font has to be embedded,
 * not merely named. Replace this one import when a licensed Satoshi asset
 * lands and the whole film picks it up.
 */
import { loadFont } from '@remotion/google-fonts/PlusJakartaSans'

export const { fontFamily: FONT } = loadFont()

/** The demo identity, mirroring `scenes.ts` in the app. Fictional on purpose. */
export const DEMO = {
  shop: 'Fade City',
  customer: 'Malik R.',
  initials: 'MR',
  service: 'Skin fade + beard',
  barbers: ['Yanis', 'Sofia', 'Deniz'],
} as const

export const FPS = 30

/** Frame budget per beat. Sums to the film's total length. */
export const BEATS = {
  open: 90, // 3.0s  — 09:00, the shop opens
  today: 90, // 3.0s  — the day assembles
  appointment: 96, // 3.2s  — a booking lands inside Today
  walkin: 90, // 3.0s  — someone walks in
  queue: 108, // 3.6s  — #3 → #2 → next
  assign: 78, // 2.6s  — queue entry becomes a chair
  chair: 114, // 3.8s  — Chair Mode
  passport: 105, // 3.5s — the cut is remembered
  time: 60, // 2.0s  — 18 days later
  rebook: 105, // 3.5s — the customer books again
  end: 84, // 2.8s  — logo
} as const

export const TOTAL = Object.values(BEATS).reduce((sum, n) => sum + n, 0)

/** Cumulative start frame of each beat. */
export const START = (() => {
  const out = {} as Record<keyof typeof BEATS, number>
  let cursor = 0
  for (const [key, length] of Object.entries(BEATS) as [keyof typeof BEATS, number][]) {
    out[key] = cursor
    cursor += length
  }
  return out
})()
