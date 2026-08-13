import { useMutation, useQuery } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'

/**
 * Anon-callable read/write hooks backing the public booking flow at
 * `/s/:slug` (LOT 9). Every one of these wraps a `SECURITY DEFINER` RPC
 * (see `db/migrations/20260809150000_public_booking_reads.sql` and
 * `20260809150100_book_public_appointment_rpc.sql`) rather than a `.from()`
 * table query — there is no anon RLS access to these tables at all, so this
 * is the *only* client-side surface for the public booking page. Every RPC
 * re-derives `organization_id` from the slug server-side and re-validates
 * every other id against it; nothing here should be treated as a trust
 * boundary on its own.
 */

// --- get_public_organization ---------------------------------------------------

export interface PublicOrganization {
  id: string
  name: string
  slug: string
}

interface PublicOrganizationRow {
  id: string
  name: string
  slug: string
}

function mapPublicOrganization(row: PublicOrganizationRow): PublicOrganization {
  return { id: row.id, name: row.name, slug: row.slug }
}

/**
 * Resolves a booking-page slug to its organization. `data` is `null` (not
 * an error) once loaded for an unknown slug — the RPC simply returns zero
 * rows, so the caller must distinguish "still loading" from "resolved, and
 * there is no such shop" via `isSuccess`/`data`.
 */
export function usePublicOrganization(slug: string | undefined) {
  return useQuery({
    queryKey: ['public-organization', slug],
    queryFn: async (): Promise<PublicOrganization | null> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('get_public_organization', { p_slug: slug })
      if (error) throw error
      const rows = (data ?? []) as PublicOrganizationRow[]
      return rows[0] ? mapPublicOrganization(rows[0]) : null
    },
    enabled: Boolean(slug),
  })
}

// --- list_public_locations -------------------------------------------------------

export interface PublicLocation {
  id: string
  name: string
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  region: string | null
  postalCode: string | null
  country: string | null
  timezone: string
}

interface PublicLocationRow {
  id: string
  name: string
  address_line1: string | null
  address_line2: string | null
  city: string | null
  region: string | null
  postal_code: string | null
  country: string | null
  timezone: string
}

function mapPublicLocation(row: PublicLocationRow): PublicLocation {
  return {
    id: row.id,
    name: row.name,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    region: row.region,
    postalCode: row.postal_code,
    country: row.country,
    timezone: row.timezone,
  }
}

/** Active locations for a shop's public booking page, by slug. */
export function usePublicLocations(organizationSlug: string | undefined) {
  return useQuery({
    queryKey: ['public-locations', organizationSlug],
    queryFn: async (): Promise<PublicLocation[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('list_public_locations', {
        p_organization_slug: organizationSlug,
      })
      if (error) throw error
      return ((data ?? []) as PublicLocationRow[]).map(mapPublicLocation)
    },
    enabled: Boolean(organizationSlug),
  })
}

// --- list_public_services ---------------------------------------------------------

export interface PublicService {
  id: string
  categoryId: string | null
  categoryName: string | null
  name: string
  description: string | null
  durationMinutes: number
  priceCents: number
}

interface PublicServiceRow {
  id: string
  category_id: string | null
  category_name: string | null
  name: string
  description: string | null
  duration_minutes: number
  price_cents: number
}

function mapPublicService(row: PublicServiceRow): PublicService {
  return {
    id: row.id,
    categoryId: row.category_id,
    categoryName: row.category_name,
    name: row.name,
    description: row.description,
    durationMinutes: row.duration_minutes,
    priceCents: row.price_cents,
  }
}

/** Active services actually offered at `locationId`, by shop slug. */
export function usePublicServices(organizationSlug: string | undefined, locationId: string | undefined) {
  return useQuery({
    queryKey: ['public-services', organizationSlug, locationId],
    queryFn: async (): Promise<PublicService[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('list_public_services', {
        p_organization_slug: organizationSlug,
        p_location_id: locationId,
      })
      if (error) throw error
      return ((data ?? []) as PublicServiceRow[]).map(mapPublicService)
    },
    enabled: Boolean(organizationSlug) && Boolean(locationId),
  })
}

// --- list_public_barbers -----------------------------------------------------------

export interface PublicBarber {
  barberId: string
  displayName: string
  title: string | null
  bio: string | null
  avatarUrl: string | null
}

interface PublicBarberRow {
  barber_id: string
  display_name: string
  title: string | null
  bio: string | null
  avatar_url: string | null
}

function mapPublicBarber(row: PublicBarberRow): PublicBarber {
  return {
    barberId: row.barber_id,
    displayName: row.display_name,
    title: row.title,
    bio: row.bio,
    avatarUrl: row.avatar_url,
  }
}

/** Bookable, public barbers eligible for `serviceId` at `locationId`, by shop slug. */
export function usePublicBarbers(
  organizationSlug: string | undefined,
  locationId: string | undefined,
  serviceId: string | undefined,
) {
  return useQuery({
    queryKey: ['public-barbers', organizationSlug, locationId, serviceId],
    queryFn: async (): Promise<PublicBarber[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('list_public_barbers', {
        p_organization_slug: organizationSlug,
        p_location_id: locationId,
        p_service_id: serviceId,
      })
      if (error) throw error
      return ((data ?? []) as PublicBarberRow[]).map(mapPublicBarber)
    },
    enabled: Boolean(organizationSlug) && Boolean(locationId) && Boolean(serviceId),
  })
}

// --- get_public_available_slots -----------------------------------------------------

export interface PublicAvailableSlot {
  slotStart: string
  slotEnd: string
}

interface PublicAvailableSlotRow {
  slot_start: string
  slot_end: string
}

function mapPublicAvailableSlot(row: PublicAvailableSlotRow): PublicAvailableSlot {
  return { slotStart: row.slot_start, slotEnd: row.slot_end }
}

/**
 * Open, unbooked slots for `barberId`/`serviceId` at `locationId` on `date`
 * (a `YYYY-MM-DD` string, location-local). Empty results are expected and
 * common (a fully-booked or non-working day) — not an error.
 */
export function usePublicAvailableSlots(
  organizationSlug: string | undefined,
  locationId: string | undefined,
  barberId: string | undefined,
  serviceId: string | undefined,
  date: string | undefined,
) {
  return useQuery({
    queryKey: ['public-available-slots', organizationSlug, locationId, barberId, serviceId, date],
    queryFn: async (): Promise<PublicAvailableSlot[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('get_public_available_slots', {
        p_organization_slug: organizationSlug,
        p_location_id: locationId,
        p_barber_id: barberId,
        p_service_id: serviceId,
        p_date: date,
      })
      if (error) throw error
      return ((data ?? []) as PublicAvailableSlotRow[]).map(mapPublicAvailableSlot)
    },
    enabled: Boolean(organizationSlug) && Boolean(locationId) && Boolean(barberId) && Boolean(serviceId) && Boolean(date),
  })
}

// --- book_public_appointment ---------------------------------------------------------

export interface BookPublicAppointmentInput {
  organizationSlug: string
  locationId: string
  barberId: string
  serviceId: string
  /** ISO timestamptz for the requested start time. */
  startsAt: string
  customerName: string
  customerPhone?: string | null
  customerEmail?: string | null
  notes?: string | null
}

export interface BookedAppointment {
  id: string
  startsAt: string
  endsAt: string
  status: string
  /**
   * Single-use, 72h token returned ONLY for an anonymous booking — it is
   * what later proves to `redeem_appointment_claim` that the holder is the
   * person who made this booking, letting them attach it to an account they
   * create afterwards. Null when the booker was already signed in, because
   * the appointment is then owned server-side from the moment it exists and
   * there is nothing to claim. Returned exactly once; only its hash is ever
   * stored (20260813150000_appointment_ownership_hardening.sql).
   */
  claimToken: string | null
}

interface BookedAppointmentRow {
  id: string
  starts_at: string
  ends_at: string
  status: string
  claim_token: string | null
}

function mapBookedAppointment(row: BookedAppointmentRow): BookedAppointment {
  return {
    id: row.id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    claimToken: row.claim_token ?? null,
  }
}

/**
 * Creates a `status = 'pending'` appointment request with no session — the
 * only anon write path in this schema (see migration comment). The RPC
 * re-validates everything server-side regardless of what the client
 * already checked; surface `error.message` to the user via friendly copy,
 * not raw Postgres text (see `public-booking-page.tsx`).
 */
export function useBookPublicAppointment() {
  return useMutation({
    mutationFn: async (input: BookPublicAppointmentInput): Promise<BookedAppointment> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('book_public_appointment', {
        p_organization_slug: input.organizationSlug,
        p_location_id: input.locationId,
        p_barber_id: input.barberId,
        p_service_id: input.serviceId,
        p_starts_at: input.startsAt,
        p_customer_name: input.customerName,
        p_customer_phone: input.customerPhone ?? null,
        p_customer_email: input.customerEmail ?? null,
        p_notes: input.notes ?? null,
      })
      if (error) throw error
      const rows = (data ?? []) as BookedAppointmentRow[]
      const row = rows[0]
      if (!row) throw new Error('The shop did not confirm the request. Please try again.')
      return mapBookedAppointment(row)
    },
  })
}
