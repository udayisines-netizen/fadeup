import type { BusinessType, WeeklyDay } from '@/lib/queries/onboarding'

/**
 * Starter templates for onboarding.
 *
 * These are INITIALIZERS, never a catalog. Everything they create is edited
 * afterwards through the ordinary /app/services and /app/availability
 * screens — nothing here is locked, and re-running onboarding matches on the
 * service name so it updates rather than duplicating. A service the owner
 * renames stops matching and is left alone, which is correct: their edit
 * wins over a template.
 *
 * Prices are integer cents, matching services.price_cents. The numbers are
 * plausible mid-market French figures because France is FadeUp's first
 * market, and a starting point a shop adjusts beats an empty form. They are
 * quoted in whatever currency the business chose in step 4 — nothing here
 * assumes one.
 */

/**
 * A template entry carries a stable ID and the numbers — never the name.
 *
 * The name matters more than it looks: these become real `services` rows, so
 * a German salon seeded with "Brushing" has a French word in its live price
 * list. The wizard resolves `id` through the `onboarding` namespace
 * (`services.templates.*`) so each shop starts in its own language.
 */
export type ServiceTemplateId =
  | 'cut' | 'fade' | 'cutBeard' | 'taper' | 'beard' | 'lineup'
  | 'blowdry' | 'cutBlowdry' | 'color' | 'balayage' | 'treatment'

export interface ServiceTemplate {
  id: ServiceTemplateId
  durationMinutes: number
  priceCents: number
  /** Preselected in the wizard. The rest are offered unticked. */
  recommended: boolean
}

const BARBER_SERVICES: ServiceTemplate[] = [
  { id: 'cut', durationMinutes: 30, priceCents: 2500, recommended: true },
  { id: 'fade', durationMinutes: 45, priceCents: 3000, recommended: true },
  { id: 'cutBeard', durationMinutes: 60, priceCents: 4000, recommended: true },
  { id: 'taper', durationMinutes: 30, priceCents: 2500, recommended: false },
  { id: 'beard', durationMinutes: 20, priceCents: 1500, recommended: false },
  { id: 'lineup', durationMinutes: 15, priceCents: 1000, recommended: false },
]

const SALON_SERVICES: ServiceTemplate[] = [
  { id: 'cut', durationMinutes: 45, priceCents: 3500, recommended: true },
  { id: 'blowdry', durationMinutes: 30, priceCents: 2500, recommended: true },
  { id: 'cutBlowdry', durationMinutes: 60, priceCents: 5000, recommended: true },
  { id: 'color', durationMinutes: 90, priceCents: 6500, recommended: false },
  { id: 'balayage', durationMinutes: 120, priceCents: 9000, recommended: false },
  { id: 'treatment', durationMinutes: 30, priceCents: 2500, recommended: false },
]

// A mixed salon serves both sides of the room, so its starter set is the
// overlap plus the signature service from each — not both full lists, which
// would open onboarding with twelve checkboxes.
const MIXED_SERVICES: ServiceTemplate[] = [
  { id: 'cut', durationMinutes: 45, priceCents: 3000, recommended: true },
  { id: 'fade', durationMinutes: 45, priceCents: 3000, recommended: true },
  { id: 'blowdry', durationMinutes: 30, priceCents: 2500, recommended: true },
  { id: 'cutBeard', durationMinutes: 60, priceCents: 4000, recommended: false },
  { id: 'color', durationMinutes: 90, priceCents: 6500, recommended: false },
  { id: 'treatment', durationMinutes: 30, priceCents: 2500, recommended: false },
]

export const SERVICE_TEMPLATES: Record<BusinessType, ServiceTemplate[]> = {
  solo_professional: BARBER_SERVICES,
  barbershop: BARBER_SERVICES,
  hair_salon: SALON_SERVICES,
  mixed_salon: MIXED_SERVICES,
  // A multi-location group is defined by scale, not by what it cuts. The
  // mixed set is the safest opening assumption; they change it in one screen.
  multi_location: MIXED_SERVICES,
}

export function templateFor(businessType: BusinessType | null | undefined): ServiceTemplate[] {
  return businessType ? SERVICE_TEMPLATES[businessType] : BARBER_SERVICES
}

/**
 * A default week: Tuesday to Saturday, which is what most French salons and
 * barbershops actually work, with Sunday and Monday closed.
 *
 * day_of_week is 0=Sunday..6=Saturday, matching Postgres `extract(dow)` and
 * therefore location_hours/barber_working_hours directly.
 *
 * One window per day, because that is all the schema stores today. A lunch
 * closure needs a second window per day and is a deliberate, separate schema
 * change — faking it here (by splitting the day into two rows the unique
 * constraint would reject) would be worse than not offering it.
 */
export const DEFAULT_WEEK: WeeklyDay[] = [
  { dayOfWeek: 0, isClosed: true, openTime: null, closeTime: null },
  { dayOfWeek: 1, isClosed: true, openTime: null, closeTime: null },
  { dayOfWeek: 2, isClosed: false, openTime: '09:00', closeTime: '19:00' },
  { dayOfWeek: 3, isClosed: false, openTime: '09:00', closeTime: '19:00' },
  { dayOfWeek: 4, isClosed: false, openTime: '09:00', closeTime: '19:00' },
  { dayOfWeek: 5, isClosed: false, openTime: '09:00', closeTime: '19:00' },
  { dayOfWeek: 6, isClosed: false, openTime: '09:00', closeTime: '18:00' },
]

/** The currencies onboarding offers directly; any other is reachable by country. */
export const COMMON_CURRENCIES = ['EUR', 'GBP', 'CHF', 'USD', 'CAD', 'MAD', 'AED'] as const

/**
 * Codes only. The displayed name comes from Intl in the reader's language
 * (see intl-labels.ts) rather than a hardcoded English list.
 */
export const COMMON_COUNTRIES: { code: string }[] = [
  { code: 'FR' }, { code: 'BE' }, { code: 'CH' }, { code: 'LU' },
  { code: 'GB' }, { code: 'ES' }, { code: 'IT' }, { code: 'DE' },
  { code: 'PT' }, { code: 'NL' }, { code: 'MA' }, { code: 'CA' },
  { code: 'US' },
]
