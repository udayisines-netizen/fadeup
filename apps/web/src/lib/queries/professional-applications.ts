import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'
import { useRealtimeInvalidation } from '@/lib/realtime'

/**
 * The professional registration approval workflow —
 * db/migrations/20260813170000_professional_applications.sql.
 *
 * Everything here is a workflow read/write, never an authorization signal.
 * Whether someone may use FadeUp Pro is decided by their memberships, as it
 * is everywhere else in this app; an application row only describes where
 * they are in the review process.
 */

export type ProfessionalApplicationStatus = 'pending_review' | 'approved' | 'rejected'
export type ProfessionalType = 'barbershop' | 'independent_barber' | 'private_studio' | 'mobile_barber'

export const PROFESSIONAL_TYPES: ProfessionalType[] = [
  'barbershop',
  'independent_barber',
  'private_studio',
  'mobile_barber',
]

/** The applicant-facing shape. Note what is absent: internal_note and reviewed_by are not returned by the RPC at all. */
export interface MyProfessionalApplication {
  id: string
  status: ProfessionalApplicationStatus
  firstName: string
  lastName: string
  email: string
  phone: string
  businessName: string
  professionalType: ProfessionalType
  city: string | null
  submittedAt: string
  reviewedAt: string | null
  rejectionReason: string | null
  organizationId: string | null
}

interface MyApplicationRow {
  id: string
  status: ProfessionalApplicationStatus
  first_name: string
  last_name: string
  email: string
  phone: string
  business_name: string
  professional_type: ProfessionalType
  city: string | null
  submitted_at: string
  reviewed_at: string | null
  rejection_reason: string | null
  organization_id: string | null
}

function mapMyApplication(row: MyApplicationRow): MyProfessionalApplication {
  return {
    id: row.id,
    status: row.status,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    businessName: row.business_name,
    professionalType: row.professional_type,
    city: row.city,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
    rejectionReason: row.rejection_reason,
    organizationId: row.organization_id,
  }
}

export const myApplicationQueryKey = ['my-professional-application'] as const

/**
 * `null` once resolved when the account has never applied — a legitimate,
 * normal state (every customer is in it), not an error.
 *
 * Polls while a decision is outstanding so an applicant sitting on the
 * status page when the reviewer approves them sees it without a manual
 * refresh. Polling stops the moment the status is terminal.
 */
export function useMyProfessionalApplication(enabled = true) {
  return useQuery({
    queryKey: myApplicationQueryKey,
    queryFn: async (): Promise<MyProfessionalApplication | null> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('get_my_professional_application')
      if (error) throw error
      const rows = (data ?? []) as MyApplicationRow[]
      return rows[0] ? mapMyApplication(rows[0]) : null
    },
    enabled,
    refetchInterval: (query) =>
      query.state.data?.status === 'pending_review' ? 30_000 : false,
  })
}

export interface SubmitApplicationInput {
  firstName: string
  lastName: string
  phone: string
  businessName: string
  professionalType: ProfessionalType
  city?: string | null
  addressLine1?: string | null
  postalCode?: string | null
  country?: string | null
  staffCount?: number | null
  website?: string | null
  instagram?: string | null
  businessIdentifier?: string | null
}

export function useSubmitProfessionalApplication() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: SubmitApplicationInput): Promise<MyProfessionalApplication> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('submit_professional_application', {
        p_first_name: input.firstName,
        p_last_name: input.lastName,
        p_phone: input.phone,
        p_business_name: input.businessName,
        p_professional_type: input.professionalType,
        p_city: input.city ?? null,
        p_address_line1: input.addressLine1 ?? null,
        p_postal_code: input.postalCode ?? null,
        p_country: input.country ?? null,
        p_staff_count: input.staffCount ?? null,
        p_website: input.website ?? null,
        p_instagram: input.instagram ?? null,
        p_business_identifier: input.businessIdentifier ?? null,
      })
      if (error) throw error
      const row = (Array.isArray(data) ? data[0] : data) as MyApplicationRow
      return mapMyApplication(row)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: myApplicationQueryKey })
    },
  })
}

/** Lets the applicant correct the contact details the reviewer will use to reach them. The DB trigger is what actually keeps review columns out of reach. */
export function useUpdateMyApplicationContact() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: string; phone: string; firstName: string; lastName: string }) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase
        .from('professional_applications')
        .update({ phone: input.phone, first_name: input.firstName, last_name: input.lastName })
        .eq('id', input.id)
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: myApplicationQueryKey })
    },
  })
}

// --- platform review side -----------------------------------------------------

export interface PlatformApplication extends MyProfessionalApplication {
  addressLine1: string | null
  postalCode: string | null
  country: string | null
  staffCount: number | null
  website: string | null
  instagram: string | null
  businessIdentifier: string | null
  internalNote: string | null
  reviewedBy: string | null
  userId: string
}

interface PlatformApplicationRow extends MyApplicationRow {
  user_id: string
  address_line1: string | null
  postal_code: string | null
  country: string | null
  staff_count: number | null
  website: string | null
  instagram: string | null
  business_identifier: string | null
  internal_note: string | null
  reviewed_by: string | null
}

const PLATFORM_APPLICATION_COLUMNS =
  'id, user_id, status, first_name, last_name, email, phone, business_name, professional_type, city, address_line1, postal_code, country, staff_count, website, instagram, business_identifier, internal_note, submitted_at, reviewed_at, reviewed_by, rejection_reason, organization_id'

function mapPlatformApplication(row: PlatformApplicationRow): PlatformApplication {
  return {
    ...mapMyApplication(row),
    userId: row.user_id,
    addressLine1: row.address_line1,
    postalCode: row.postal_code,
    country: row.country,
    staffCount: row.staff_count,
    website: row.website,
    instagram: row.instagram,
    businessIdentifier: row.business_identifier,
    internalNote: row.internal_note,
    reviewedBy: row.reviewed_by,
  }
}

export const platformApplicationsQueryKey = (status: ProfessionalApplicationStatus) =>
  ['platform-applications', status] as const

export function usePlatformApplications(status: ProfessionalApplicationStatus) {
  return useQuery({
    queryKey: platformApplicationsQueryKey(status),
    queryFn: async (): Promise<PlatformApplication[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('professional_applications')
        .select(PLATFORM_APPLICATION_COLUMNS)
        .eq('status', status)
        .order('submitted_at', { ascending: status === 'pending_review' })
      if (error) throw error
      return ((data ?? []) as PlatformApplicationRow[]).map(mapPlatformApplication)
    },
  })
}

export function usePlatformApplication(applicationId: string | undefined) {
  return useQuery({
    queryKey: ['platform-application', applicationId],
    queryFn: async (): Promise<PlatformApplication | null> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('professional_applications')
        .select(PLATFORM_APPLICATION_COLUMNS)
        .eq('id', applicationId)
        .maybeSingle()
      if (error) throw error
      return data ? mapPlatformApplication(data as PlatformApplicationRow) : null
    },
    enabled: Boolean(applicationId),
  })
}

export function useReviewApplication() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      applicationId: string
      decision: 'approve' | 'reject'
      rejectionReason?: string | null
      internalNote?: string | null
    }) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.rpc('review_professional_application', {
        p_application_id: input.applicationId,
        p_decision: input.decision,
        p_rejection_reason: input.rejectionReason ?? null,
        p_internal_note: input.internalNote ?? null,
      })
      if (error) throw error
    },
    onSuccess: (_result, input) => {
      void queryClient.invalidateQueries({ queryKey: ['platform-applications'] })
      void queryClient.invalidateQueries({ queryKey: ['platform-application', input.applicationId] })
      void queryClient.invalidateQueries({ queryKey: ['platform-notifications'] })
    },
  })
}

// --- platform notifications ---------------------------------------------------

export interface PlatformNotification {
  id: string
  type: string
  title: string
  body: string | null
  targetType: string | null
  targetId: string | null
  readAt: string | null
  createdAt: string
}

interface PlatformNotificationRow {
  id: string
  type: string
  title: string
  body: string | null
  target_type: string | null
  target_id: string | null
  read_at: string | null
  created_at: string
}

/**
 * Reuses the Realtime pattern already established for the live queue
 * (lib/queries/queue.ts) rather than introducing an event bus: subscribe to
 * postgres_changes on the table and let the change invalidate the query.
 */
export function usePlatformNotifications(userId: string | undefined) {
  // Same shared helper as the live queue, for the same lifecycle reasons: one
  // physical topic per mount, and no invalidation from a channel belonging to
  // an identity the session has already moved off.
  useRealtimeInvalidation(
    userId ? `platform-notifications-${userId}` : null,
    [{ table: 'platform_notifications', filter: `recipient_user_id=eq.${userId}` }],
    [['platform-notifications']],
  )

  return useQuery({
    queryKey: ['platform-notifications', userId],
    queryFn: async (): Promise<PlatformNotification[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('platform_notifications')
        .select('id, type, title, body, target_type, target_id, read_at, created_at')
        .order('created_at', { ascending: false })
        .limit(30)
      if (error) throw error
      return ((data ?? []) as PlatformNotificationRow[]).map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        targetType: row.target_type,
        targetId: row.target_id,
        readAt: row.read_at,
        createdAt: row.created_at,
      }))
    },
    enabled: Boolean(userId),
  })
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (notificationId: string) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.rpc('mark_platform_notification_read', { p_notification_id: notificationId })
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['platform-notifications'] })
    },
  })
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.rpc('mark_all_platform_notifications_read')
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['platform-notifications'] })
    },
  })
}
