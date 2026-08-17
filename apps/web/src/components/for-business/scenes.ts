import type { BusinessMode } from '@/lib/commerce/plans'

/**
 * The scroll narrative of /for-business, as data.
 *
 * The page tells one shop's day from the moment it opens to the moment the same
 * customer books again. Each entry below is one beat of that story; the page
 * renders them in order, and the persistent product stage shows whatever the
 * current beat is about.
 *
 * Two things are encoded here rather than in JSX, because both are product
 * decisions and both change per business mode:
 *
 *   `modes`  — who this beat is for. A barber working alone should not scroll
 *              through a team-management chapter to reach the pricing; the
 *              absence of that chapter is itself part of what Solo is.
 *
 *   `status` — whether the beat describes something shipped. `planned` beats
 *              exist because the commercial story needs them, but they are
 *              rendered with an explicit roadmap marker and never as a
 *              description of what the product does today. See CAPABILITIES in
 *              `lib/commerce/plans.ts` for the evidence behind each call.
 */

export type SceneId =
  | 'today'
  | 'appointments'
  | 'walkins'
  | 'queue'
  | 'barber'
  | 'chair'
  | 'passport'
  | 'history'
  | 'retention'
  | 'control'
  | 'team'
  | 'marketplace'
  | 'discovery'
  | 'rebook'

export interface Scene {
  id: SceneId
  modes: BusinessMode[]
  status: 'live' | 'planned'
}

const ALL: BusinessMode[] = ['independent', 'barbershop', 'multi_location']
const SHOPS: BusinessMode[] = ['barbershop', 'multi_location']

export const SCENES: Scene[] = [
  { id: 'today', modes: ALL, status: 'live' },
  { id: 'appointments', modes: ALL, status: 'live' },
  { id: 'walkins', modes: ALL, status: 'live' },
  { id: 'queue', modes: ALL, status: 'live' },
  // Assignment resolves trivially for a solo barber — it is always you — so the
  // beat still runs, with copy that says so rather than pretending at a choice.
  { id: 'barber', modes: ALL, status: 'live' },
  { id: 'chair', modes: ALL, status: 'live' },
  { id: 'passport', modes: ALL, status: 'live' },
  { id: 'history', modes: ALL, status: 'live' },
  // The pivot from "we remember the customer" to "Pro brings them back". The
  // automation itself is not built; the scene says exactly that.
  { id: 'retention', modes: ALL, status: 'planned' },
  { id: 'control', modes: ALL, status: 'live' },
  { id: 'team', modes: SHOPS, status: 'live' },
  { id: 'marketplace', modes: ALL, status: 'live' },
  { id: 'discovery', modes: ALL, status: 'live' },
  { id: 'rebook', modes: ALL, status: 'live' },
]

export function scenesForMode(mode: BusinessMode): Scene[] {
  return SCENES.filter((scene) => scene.modes.includes(mode))
}

/**
 * The demo shop each mode is set in.
 *
 * Fictional on purpose and captioned as an illustration wherever it renders.
 * This is marketing state and it never touches Supabase — the marketplace on
 * "/" queries real published organizations, and the two must not be confusable.
 * Nothing here is, or resembles, acquisition prospect data.
 */
export interface DemoWorld {
  mode: BusinessMode
  shopName: string
  locations: string[]
  barbers: string[]
  chairs: number
  customer: string
  customerInitials: string
  service: string
}

const WORLDS: Record<BusinessMode, DemoWorld> = {
  independent: {
    mode: 'independent',
    shopName: 'Studio Yanis',
    locations: ['Studio'],
    barbers: ['Yanis'],
    chairs: 1,
    customer: 'Malik R.',
    customerInitials: 'MR',
    service: 'Skin fade + beard',
  },
  barbershop: {
    mode: 'barbershop',
    shopName: 'Fade City',
    locations: ['Fade City'],
    barbers: ['Yanis', 'Sofia', 'Deniz'],
    chairs: 3,
    customer: 'Malik R.',
    customerInitials: 'MR',
    service: 'Skin fade + beard',
  },
  multi_location: {
    mode: 'multi_location',
    shopName: 'Fade City',
    locations: ['Fade City Nord', 'Fade City Sud'],
    barbers: ['Yanis', 'Sofia', 'Deniz', 'Nora', 'Marc'],
    chairs: 5,
    customer: 'Malik R.',
    customerInitials: 'MR',
    service: 'Skin fade + beard',
  },
}

export function worldForMode(mode: BusinessMode): DemoWorld {
  return WORLDS[mode]
}

/**
 * Resolves a scene's copy key, preferring a mode-specific override.
 *
 * Most beats read the same whatever shape of business you run — a walk-in is a
 * walk-in. Where the story genuinely differs, a locale file may define
 * `scenes.<id>.modes.<mode>.<field>`, and it wins. Callers pass both keys to
 * i18next, which takes the first that exists, so a locale that has not written
 * an override yet still renders correct copy instead of a missing-key string.
 */
export function sceneCopyKeys(scene: SceneId, mode: BusinessMode, field: 'eyebrow' | 'title' | 'body'): string[] {
  return [`business.scenes.${scene}.modes.${mode}.${field}`, `business.scenes.${scene}.${field}`]
}
