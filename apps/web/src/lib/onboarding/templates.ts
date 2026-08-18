import type { BusinessType, StarterService, WeeklyDay } from '@/lib/queries/onboarding'

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

export interface ServiceTemplate extends StarterService {
  /** Preselected in the wizard. The rest are offered unticked. */
  recommended: boolean
}

const BARBER_SERVICES: ServiceTemplate[] = [
  { name: 'Coupe', durationMinutes: 30, priceCents: 2500, recommended: true },
  { name: 'Fade', durationMinutes: 45, priceCents: 3000, recommended: true },
  { name: 'Coupe + barbe', durationMinutes: 60, priceCents: 4000, recommended: true },
  { name: 'Taper', durationMinutes: 30, priceCents: 2500, recommended: false },
  { name: 'Barbe', durationMinutes: 20, priceCents: 1500, recommended: false },
  { name: 'Contours', durationMinutes: 15, priceCents: 1000, recommended: false },
]

const SALON_SERVICES: ServiceTemplate[] = [
  { name: 'Coupe', durationMinutes: 45, priceCents: 3500, recommended: true },
  { name: 'Brushing', durationMinutes: 30, priceCents: 2500, recommended: true },
  { name: 'Coupe + brushing', durationMinutes: 60, priceCents: 5000, recommended: true },
  { name: 'Couleur', durationMinutes: 90, priceCents: 6500, recommended: false },
  { name: 'Balayage', durationMinutes: 120, priceCents: 9000, recommended: false },
  { name: 'Soin', durationMinutes: 30, priceCents: 2500, recommended: false },
]

// A mixed salon serves both sides of the room, so its starter set is the
// overlap plus the signature service from each — not both full lists, which
// would open onboarding with twelve checkboxes.
const MIXED_SERVICES: ServiceTemplate[] = [
  { name: 'Coupe', durationMinutes: 45, priceCents: 3000, recommended: true },
  { name: 'Fade', durationMinutes: 45, priceCents: 3000, recommended: true },
  { name: 'Brushing', durationMinutes: 30, priceCents: 2500, recommended: true },
  { name: 'Coupe + barbe', durationMinutes: 60, priceCents: 4000, recommended: false },
  { name: 'Couleur', durationMinutes: 90, priceCents: 6500, recommended: false },
  { name: 'Soin', durationMinutes: 30, priceCents: 2500, recommended: false },
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

export const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

/** The currencies onboarding offers directly; any other is reachable by country. */
export const COMMON_CURRENCIES = ['EUR', 'GBP', 'CHF', 'USD', 'CAD', 'MAD', 'AED'] as const

export const COMMON_COUNTRIES: { code: string; label: string }[] = [
  { code: 'FR', label: 'France' },
  { code: 'BE', label: 'Belgium' },
  { code: 'CH', label: 'Switzerland' },
  { code: 'LU', label: 'Luxembourg' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'ES', label: 'Spain' },
  { code: 'IT', label: 'Italy' },
  { code: 'DE', label: 'Germany' },
  { code: 'PT', label: 'Portugal' },
  { code: 'NL', label: 'Netherlands' },
  { code: 'MA', label: 'Morocco' },
  { code: 'CA', label: 'Canada' },
  { code: 'US', label: 'United States' },
]
