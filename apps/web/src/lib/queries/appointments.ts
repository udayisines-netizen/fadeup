import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'

/** Mirrors public.appointment_status — see db/migrations/20260809140000_appointments.sql. */
export type AppointmentStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'

/**
 * Core booking record. No `customers` table yet (LOT 12) — `customerName`/
 * `customerPhone`/`customerEmail` are a deliberate placeholder, not a design
 * mistake. `bufferBeforeMinutes`/`bufferAfterMinutes` are snapshotted from
 * the service at booking time, so a later edit to the service's buffers
 * never silently changes the blocked window of appointments already booked.
 */
export interface Appointment {
  id: string
  organizationId: string
  locationId: string
  barberId: string
  chairId: string | null
  serviceId: string
  customerName: string
  customerPhone: string | null
  customerEmail: string | null
  startsAt: string
  endsAt: string
  bufferBeforeMinutes: number
  bufferAfterMinutes: number
  status: AppointmentStatus
  notes: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

interface AppointmentRow {
  id: string
  organization_id: string
  location_id: string
  barber_id: string
  chair_id: string | null
  service_id: string
  customer_name: string
  customer_phone: string | null
  customer_email: string | null
  starts_at: string
  ends_at: string
  buffer_before_minutes: number
  buffer_after_minutes: number
  status: AppointmentStatus
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

const APPOINTMENT_COLUMNS =
  'id, organization_id, location_id, barber_id, chair_id, service_id, customer_name, customer_phone, customer_email, starts_at, ends_at, buffer_before_minutes, buffer_after_minutes, status, notes, created_by, created_at, updated_at'

function mapAppointment(row: AppointmentRow): Appointment {
  return {
    id: row.id,
    organizationId: row.organization_id,
    locationId: row.location_id,
    barberId: row.barber_id,
    chairId: row.chair_id,
    serviceId: row.service_id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    customerEmail: row.customer_email,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    bufferBeforeMinutes: row.buffer_before_minutes,
    bufferAfterMinutes: row.buffer_after_minutes,
    status: row.status,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** [UTC day-start, next UTC day-start) for a "YYYY-MM-DD" date string. */
function utcDayRange(date: string): { start: string; end: string } {
  const start = `${date}T00:00:00.000Z`
  const end = new Date(new Date(start).getTime() + 24 * 60 * 60 * 1000).toISOString()
  return { start, end }
}

/**
 * Appointments across the whole org for one calendar date, filtered by a
 * UTC day window on `starts_at` (not each location's own timezone) — a
 * documented simplification, same spirit as `get_available_slots`'s own
 * documented timezone approximation. Good enough for a single-day schedule
 * view; revisit if a shop's locations span timezones far enough apart that
 * the UTC boundary visibly clips a business day. Filter further by
 * `locationId` client-side (same pattern as `useOrgChairs`) since a shop can
 * have appointments at several locations on the same day.
 */
export function useOrgAppointmentsForDate(organizationId: string | undefined, date: string | undefined) {
  return useQuery({
    queryKey: ['appointments', organizationId, date],
    queryFn: async (): Promise<Appointment[]> => {
      if (!date) return []
      const { start, end } = utcDayRange(date)
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('appointments')
        .select(APPOINTMENT_COLUMNS)
        .eq('organization_id', organizationId)
        .gte('starts_at', start)
        .lt('starts_at', end)
        .order('starts_at', { ascending: true })

      if (error) throw error

      return ((data ?? []) as unknown as AppointmentRow[]).map(mapAppointment)
    },
    enabled: Boolean(organizationId) && Boolean(date),
  })
}

export interface CreateAppointmentInput {
  organizationId: string
  locationId: string
  barberId: string
  chairId: string | null
  serviceId: string
  customerName: string
  customerPhone: string | null
  customerEmail: string | null
  startsAt: string
  endsAt: string
  bufferBeforeMinutes: number
  bufferAfterMinutes: number
  status: AppointmentStatus
  notes: string | null
  createdBy: string | null
}

/**
 * Create an appointment. RLS restricts this to owner/manager/receptionist
 * regardless of what the client sends — note this is a *different* set of
 * roles than every other management mutation in this app (which is
 * owner/manager only); see db/migrations/20260809140000_appointments.sql.
 *
 * This is a plain insert, not an RPC — unlike LOT 9's anon-facing
 * `book_public_appointment`, staff already pass through RLS as an
 * authenticated org member, so there is no separate anon-safe wrapper to
 * go through here. The double-booking guard (the `appointments_*_no_overlap`
 * GiST exclusion constraints) still applies to this insert exactly as it
 * does to the RPC's.
 */
export function useCreateAppointment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateAppointmentInput) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.from('appointments').insert({
        organization_id: input.organizationId,
        location_id: input.locationId,
        barber_id: input.barberId,
        chair_id: input.chairId,
        service_id: input.serviceId,
        customer_name: input.customerName,
        customer_phone: input.customerPhone,
        customer_email: input.customerEmail,
        starts_at: input.startsAt,
        ends_at: input.endsAt,
        buffer_before_minutes: input.bufferBeforeMinutes,
        buffer_after_minutes: input.bufferAfterMinutes,
        status: input.status,
        notes: input.notes,
        created_by: input.createdBy,
      })
      if (error) throw error
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['appointments', variables.organizationId] })
      // A new booking can make previously-open slots unavailable.
      void queryClient.invalidateQueries({ queryKey: ['available-slots'] })
    },
  })
}

export interface UpdateAppointmentStatusInput {
  id: string
  organizationId: string
  status: AppointmentStatus
}

/** Change just an appointment's status (confirm/cancel/complete/no-show). RLS restricts this to owner/manager/receptionist. */
export function useUpdateAppointmentStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: UpdateAppointmentStatusInput) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.from('appointments').update({ status: input.status }).eq('id', input.id)
      if (error) throw error
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['appointments', variables.organizationId] })
      // Cancelling/no-showing an appointment can free up a slot again.
      void queryClient.invalidateQueries({ queryKey: ['available-slots'] })
    },
  })
}

export interface AvailableSlot {
  slotStart: string
  slotEnd: string
}

interface AvailableSlotRow {
  slot_start: string
  slot_end: string
}

/**
 * Wraps the `get_available_slots` RPC (see
 * db/migrations/20260809140100_appointment_slots_rpc.sql) — bookable
 * (start, end) pairs for one barber/location/service/date, already
 * excluding conflicts with existing appointments. Only enabled once every
 * id and the date are known, since the RPC returns nothing useful (and the
 * DB function itself early-returns) for a partial selection.
 */
export function useAvailableSlots(
  organizationId: string | undefined,
  locationId: string | undefined,
  barberId: string | undefined,
  serviceId: string | undefined,
  date: string | undefined,
) {
  return useQuery({
    queryKey: ['available-slots', organizationId, locationId, barberId, serviceId, date],
    queryFn: async (): Promise<AvailableSlot[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('get_available_slots', {
        p_organization_id: organizationId,
        p_location_id: locationId,
        p_barber_id: barberId,
        p_service_id: serviceId,
        p_date: date,
        p_slot_step_minutes: 15,
      })

      if (error) throw error

      return ((data ?? []) as unknown as AvailableSlotRow[]).map((row) => ({
        slotStart: row.slot_start,
        slotEnd: row.slot_end,
      }))
    },
    enabled: Boolean(organizationId) && Boolean(locationId) && Boolean(barberId) && Boolean(serviceId) && Boolean(date),
  })
}
