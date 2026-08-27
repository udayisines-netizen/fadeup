import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'
import { useRealtimeInvalidation, pollingInterval } from '@/lib/realtime'
import { zonedDateKey, dayOfWeek, zonedTimeToInstant, MINUTES_PER_DAY } from '@/lib/calendar/time'

/**
 * Service mode — which channels an establishment or a barber is accepting.
 *
 * ONE DOMAIN TRUTH, AND THIS MODULE DOES NOT OWN IT.
 *
 * The precedence (barber temporary > location temporary > barber persistent >
 * establishment default) is implemented exactly once, in
 * `private.effective_service_mode`. Nothing here re-derives it. The RPCs hand
 * back the resolved mode AND its provenance, so this module's job is to render
 * an answer, never to compute one.
 *
 * That matters more than it sounds. A customer-facing CTA that computed the
 * mode slightly differently from the trigger that refuses the booking would
 * show a Book button which fails on tap — worse than showing nothing.
 *
 * NONE OF THIS IS AUTHORIZATION.
 *
 * Hiding a button secures nothing. Admission is enforced by BEFORE INSERT
 * triggers on `appointments` and `queue_entries` that fire for every writer,
 * including `service_role` and `postgres`. If this module were deleted the
 * product would become confusing, not insecure — which is the correct
 * relationship between a UI gate and a real one.
 *
 * THE CONTRACT IS SHARED WITH THE FUTURE MOBILE APP.
 *
 * `get_public_service_state` is the customer contract, and it is deliberately
 * shaped so a second client can consume it without reimplementing anything.
 * The types below name that contract; only the hooks are web-specific.
 */

// --- the domain ------------------------------------------------------------

export const SERVICE_MODES = ['hybrid', 'reservation_only', 'queue_only', 'unavailable'] as const
export type ServiceMode = (typeof SERVICE_MODES)[number]

/**
 * Where the effective mode came from. Stable machine tokens, never sentences —
 * the human-readable explanation is a locale key chosen from this.
 */
export type ServiceModeSource =
  | 'barber_temporary_override'
  | 'location_temporary_override'
  | 'barber_override'
  | 'location_default'

export type ServiceModeScope = 'location' | 'barber'

/** The customer-visible answer. Mirrors `public.get_public_service_state`. */
export interface PublicServiceState {
  locationId: string
  barberId: string | null
  effectiveServiceMode: ServiceMode
  modeSource: ServiceModeSource
  /** ISO-8601 UTC. Non-null only while a temporary override with an end time is in force. */
  modeExpiresAt: string | null
  modeAllowsBooking: boolean
  modeAllowsQueue: boolean
  /** Runtime live-queue state. A separate fact from the mode, always. */
  queueOpen: boolean
  /** Final: entitlement AND mode AND queue_open. Joining a queue needs no slot. */
  queueAcceptingNewEntries: boolean
  /**
   * "A new booking would not be refused by entitlement or mode."
   *
   * NOT slot availability — that is `get_public_available_slots`, needs a date
   * and a service, and stays where it is. Treating this as "there is a free
   * time" would let the UI promise a slot the availability engine never offered.
   */
  bookingAcceptingNewEntries: boolean
}

interface PublicServiceStateRow {
  location_id: string
  barber_id: string | null
  effective_service_mode: ServiceMode
  mode_source: ServiceModeSource
  mode_expires_at: string | null
  mode_allows_booking: boolean
  mode_allows_queue: boolean
  queue_open: boolean
  queue_accepting_new_entries: boolean
  booking_accepting_new_entries: boolean
}

function mapPublicServiceState(row: PublicServiceStateRow): PublicServiceState {
  return {
    locationId: row.location_id,
    barberId: row.barber_id,
    effectiveServiceMode: row.effective_service_mode,
    modeSource: row.mode_source,
    modeExpiresAt: row.mode_expires_at,
    modeAllowsBooking: row.mode_allows_booking,
    modeAllowsQueue: row.mode_allows_queue,
    queueOpen: row.queue_open,
    queueAcceptingNewEntries: row.queue_accepting_new_entries,
    bookingAcceptingNewEntries: row.booking_accepting_new_entries,
  }
}

/** One row of the Pro operating view. Mirrors `public.get_service_mode_state`. */
export interface ServiceModeStateRow {
  scope: ServiceModeScope
  barberId: string | null
  barberDisplayName: string | null
  locationDefaultServiceMode: ServiceMode
  /** null = this barber inherits the establishment default. */
  barberServiceModeOverride: ServiceMode | null
  effectiveServiceMode: ServiceMode
  modeSource: ServiceModeSource
  modeStartsAt: string | null
  modeExpiresAt: string | null
  queueOpen: boolean
  modeAllowsBooking: boolean
  modeAllowsQueue: boolean
  bookingAcceptingNewEntries: boolean
  queueAcceptingNewEntries: boolean
}

interface ServiceModeStateRawRow {
  scope: ServiceModeScope
  barber_id: string | null
  barber_display_name: string | null
  location_default_service_mode: ServiceMode
  barber_service_mode_override: ServiceMode | null
  effective_service_mode: ServiceMode
  mode_source: ServiceModeSource
  mode_starts_at: string | null
  mode_expires_at: string | null
  queue_open: boolean
  mode_allows_booking: boolean
  mode_allows_queue: boolean
  booking_accepting_new_entries: boolean
  queue_accepting_new_entries: boolean
}

function mapServiceModeStateRow(row: ServiceModeStateRawRow): ServiceModeStateRow {
  return {
    scope: row.scope,
    barberId: row.barber_id,
    barberDisplayName: row.barber_display_name,
    locationDefaultServiceMode: row.location_default_service_mode,
    barberServiceModeOverride: row.barber_service_mode_override,
    effectiveServiceMode: row.effective_service_mode,
    modeSource: row.mode_source,
    modeStartsAt: row.mode_starts_at,
    modeExpiresAt: row.mode_expires_at,
    queueOpen: row.queue_open,
    modeAllowsBooking: row.mode_allows_booking,
    modeAllowsQueue: row.mode_allows_queue,
    bookingAcceptingNewEntries: row.booking_accepting_new_entries,
    queueAcceptingNewEntries: row.queue_accepting_new_entries,
  }
}

// --- expiry-driven refresh -------------------------------------------------

/**
 * Schedules ONE refetch for the instant a temporary override lapses.
 *
 * An override that expires on its own writes no row, so it emits no Realtime
 * event — there is nothing for Postgres to broadcast. A screen with only a
 * subscription would therefore sit on a stale answer until something unrelated
 * happened to invalidate it, which for a customer looking at a Join Queue
 * button could be a long time.
 *
 * Correctness still lives entirely on the server: the resolver refuses to
 * return an expired override whether or not any browser is awake. This timer is
 * UX synchronisation, nothing more, and a missed one degrades to a stale label
 * rather than to a booking that should not have happened.
 *
 * A small grace period is added because the client's clock is not the server's;
 * refetching a second early would just re-read the pre-expiry answer and leave
 * the screen stale until the next event.
 */
const EXPIRY_GRACE_MS = 1_500
/** setTimeout stores its delay in a signed 32-bit int; anything larger fires immediately. */
const MAX_TIMEOUT_MS = 2_147_483_647

function useExpiryRefresh(expiresAt: string | null | undefined, onExpire: () => void) {
  const callbackRef = useRef(onExpire)
  callbackRef.current = onExpire

  useEffect(() => {
    if (!expiresAt) return

    const delay = new Date(expiresAt).getTime() - Date.now() + EXPIRY_GRACE_MS
    if (Number.isNaN(delay) || delay <= 0 || delay > MAX_TIMEOUT_MS) return

    const timer = setTimeout(() => callbackRef.current(), delay)
    return () => clearTimeout(timer)
  }, [expiresAt])
}

// --- the customer read -----------------------------------------------------

export function publicServiceStateKey(
  organizationSlug: string | undefined,
  locationId: string | undefined,
  barberId: string | null | undefined,
) {
  return ['public-service-state', organizationSlug, locationId, barberId ?? null] as const
}

/**
 * What a customer is allowed to know about this establishment right now.
 *
 * Anon-callable. Returns `null` — never throws — for anything not publicly
 * operable: an unknown shop, a foreign tenant, an inactive location, a
 * non-public barber. The RPC deliberately makes those indistinguishable so it
 * cannot be used to enumerate ids, and `null` is how that reaches the UI.
 *
 * There is NO Realtime subscription here, and that is not an omission: `anon`
 * holds no SELECT on the underlying tables, so Postgres Changes has nothing it
 * could deliver to a signed-out visitor. Freshness comes from the scheduled
 * expiry refetch above plus a slow poll, exactly as the public queue display
 * already works.
 */
export function usePublicServiceState(
  organizationSlug: string | undefined,
  locationId: string | undefined,
  barberId?: string | null,
) {
  const queryClient = useQueryClient()
  const queryKey = publicServiceStateKey(organizationSlug, locationId, barberId)

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<PublicServiceState | null> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('get_public_service_state', {
        p_organization_slug: organizationSlug,
        p_location_id: locationId,
        p_barber_id: barberId ?? null,
      })
      if (error) throw error
      const rows = (data ?? []) as PublicServiceStateRow[]
      return rows[0] ? mapPublicServiceState(rows[0]) : null
    },
    enabled: Boolean(organizationSlug) && Boolean(locationId),
    refetchInterval: 120_000,
  })

  const expiresAt = query.data?.modeExpiresAt
  useExpiryRefresh(expiresAt, () => {
    void queryClient.invalidateQueries({ queryKey })
  })

  return query
}

// --- the Pro read ----------------------------------------------------------

export function serviceModeStateKey(locationId: string | undefined) {
  return ['service-mode-state', locationId] as const
}

/**
 * The Pro operating view of one establishment: its default and queue state,
 * plus every barber placed there with their effective mode and provenance.
 *
 * Live in both directions. Realtime carries anything that WRITES a row — a
 * colleague changing the mode, the desk closing the queue, an override being
 * set or cleared — and the scheduled refetch carries the one transition that
 * writes nothing, an override reaching its own `expires_at`.
 *
 * `organizationId` is used only to scope the Realtime channel name and filter;
 * it is not an authorization input. The RPC re-derives membership from
 * `auth.uid()` and returns nothing to a non-member.
 */
export function useServiceModeState(
  locationId: string | undefined,
  organizationId: string | undefined,
) {
  const queryClient = useQueryClient()
  const queryKey = serviceModeStateKey(locationId)

  const realtimeStatus = useRealtimeInvalidation(
    locationId && organizationId ? `service-mode-${locationId}` : null,
    [
      { table: 'location_service_settings', filter: `location_id=eq.${locationId}` },
      // Overrides are filtered by organization rather than by location. A
      // barber-scoped row for this establishment always carries this
      // location_id, so either filter would be correct; the wider one costs a
      // few extra events at a multi-salon group and removes a whole class of
      // "why did my screen not update" bug.
      { table: 'service_mode_overrides', filter: `organization_id=eq.${organizationId}` },
    ],
    [queryKey],
  )

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<ServiceModeStateRow[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('get_service_mode_state', {
        p_location_id: locationId,
      })
      if (error) throw error
      return ((data ?? []) as ServiceModeStateRawRow[]).map(mapServiceModeStateRow)
    },
    enabled: Boolean(locationId),
    refetchInterval: pollingInterval(realtimeStatus),
  })

  // The soonest expiry across every scope on screen. One timer, not one per
  // barber: they all invalidate the same query, so the earliest is the only one
  // that matters and the rest arrive with its result.
  const rows = query.data
  const soonestExpiry = useMemo(() => {
    const times = (rows ?? [])
      .map((row) => row.modeExpiresAt)
      .filter((value): value is string => Boolean(value))
      .sort()
    return times[0] ?? null
  }, [rows])

  useExpiryRefresh(soonestExpiry, () => {
    void queryClient.invalidateQueries({ queryKey })
  })

  return { ...query, realtimeStatus }
}

/** The establishment-scope row, which every Pro surface wants first. */
export function locationRowOf(rows: ServiceModeStateRow[] | undefined): ServiceModeStateRow | null {
  return rows?.find((row) => row.scope === 'location') ?? null
}

/** The barber rows, in the order the RPC returned them (by display name). */
export function barberRowsOf(rows: ServiceModeStateRow[] | undefined): ServiceModeStateRow[] {
  return (rows ?? []).filter((row) => row.scope === 'barber')
}

// --- durations -------------------------------------------------------------

/**
 * The durations the Pro UI offers. Machine identities, not labels.
 *
 * `until_closing` is offered ONLY when today's opening hours actually provide a
 * closing time — see `resolveDurationToExpiry`. FadeUp does not invent a
 * closing time for a shop that has not recorded one.
 */
export const OVERRIDE_DURATIONS = ['30m', '1h', 'today', 'until_closing', 'manual'] as const
export type OverrideDuration = (typeof OVERRIDE_DURATIONS)[number]

export interface ClosingHoursToday {
  /** `HH:MM` or `HH:MM:SS` in the establishment's own timezone, or null if there is none. */
  closeTime: string | null
  isClosed: boolean
}

function parseClockMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(value)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return hours * 60 + minutes
}

/**
 * Turns a UI duration into the ABSOLUTE instant the backend expects.
 *
 * Every calculation happens in the ESTABLISHMENT'S timezone, never the
 * browser's and never the server's. A manager in Paris setting "until closing"
 * for a shop in Nice must get Nice's closing time, and a barber travelling must
 * not change what "today" means for the shop they work at.
 *
 * Returns `null` for `manual`, which is the documented "until manually changed"
 * state, and `null` when the requested duration cannot be resolved honestly —
 * a closing time that does not exist, or one that has already passed. The
 * caller must not offer an option this cannot resolve; `availableDurations`
 * below is how it finds out.
 */
export function resolveDurationToExpiry(
  duration: OverrideDuration,
  timeZone: string,
  now: Date = new Date(),
  closingToday?: ClosingHoursToday | null,
): string | null {
  if (duration === 'manual') return null

  if (duration === '30m') return new Date(now.getTime() + 30 * 60_000).toISOString()
  if (duration === '1h') return new Date(now.getTime() + 60 * 60_000).toISOString()

  // The date key is derived from the `now` this function was GIVEN, not from
  // the wall clock. Reading the clock again here would make the parameter a
  // lie: a caller passing an explicit instant would get relative durations
  // computed from it and calendar durations computed from something else, and
  // the two would silently disagree at every midnight boundary.
  const dateKey = zonedDateKey(now, timeZone)

  if (duration === 'today') {
    // The shop's own midnight, not the browser's. zonedTimeToInstant corrects
    // for DST on the two days a year it matters.
    return zonedTimeToInstant(dateKey, MINUTES_PER_DAY, timeZone).toISOString()
  }

  // until_closing
  if (!closingToday || closingToday.isClosed || !closingToday.closeTime) return null
  const minutes = parseClockMinutes(closingToday.closeTime)
  if (minutes === null) return null

  const instant = zonedTimeToInstant(dateKey, minutes, timeZone)
  // A closing time that has already passed would produce an override that is
  // inert on arrival — and the backend refuses one, correctly. Better to not
  // offer it than to let a Pro tap it and be told no.
  if (instant.getTime() <= now.getTime()) return null
  return instant.toISOString()
}

/**
 * Which durations may honestly be offered right now.
 *
 * "Until closing" appears only when today's hours give a real, still-future
 * closing time. §11 is explicit that a closing time must not be invented, so
 * the option disappears rather than guessing 18:00.
 */
export function availableDurations(
  timeZone: string,
  now: Date = new Date(),
  closingToday?: ClosingHoursToday | null,
): OverrideDuration[] {
  return OVERRIDE_DURATIONS.filter((duration) => {
    if (duration !== 'until_closing') return true
    return resolveDurationToExpiry('until_closing', timeZone, now, closingToday) !== null
  })
}

/**
 * Today's LAST closing time for an establishment, from its weekly hours.
 *
 * The last, not the first: `location_hours` carries an optional second window
 * for shops that close over lunch, and "until closing" plainly means the end of
 * the working day rather than the start of the break. A day with no row at all
 * is closed by convention, which is the same answer as `is_closed`.
 */
export function closingHoursToday(
  hours:
    | Array<{
        locationId: string
        dayOfWeek: number
        isClosed: boolean
        closeTime: string | null
        secondCloseTime?: string | null
      }>
    | undefined,
  locationId: string | undefined,
  timeZone: string,
  now: Date = new Date(),
): ClosingHoursToday | null {
  if (!hours || !locationId) return null
  const today = dayOfWeek(zonedDateKey(now, timeZone))
  const row = hours.find((entry) => entry.locationId === locationId && entry.dayOfWeek === today)
  if (!row) return { closeTime: null, isClosed: true }
  return {
    isClosed: row.isClosed,
    closeTime: row.secondCloseTime ?? row.closeTime,
  }
}

// --- the controls ----------------------------------------------------------

/**
 * Every mutation invalidates BOTH reads. The Pro screen that made the change
 * gets its own Realtime event too, but relying on that alone would leave a
 * visible lag on the device that acted — and a customer tab open on the same
 * machine would not move at all, because it has no subscription.
 */
function useServiceModeMutation<TInput, TResult>(mutationFn: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['service-mode-state'] })
      void queryClient.invalidateQueries({ queryKey: ['public-service-state'] })
    },
  })
}

export interface SetLocationServiceModeInput {
  locationId: string
  mode: ServiceMode
}

/** owner/manager. Per establishment — never per organization. */
export function useSetLocationServiceMode() {
  return useServiceModeMutation(async (input: SetLocationServiceModeInput) => {
    const supabase = getSupabaseClient()
    const { error } = await supabase.rpc('set_location_service_mode', {
      p_location_id: input.locationId,
      p_mode: input.mode,
    })
    if (error) throw error
  })
}

export interface SetLocationQueueOpenInput {
  locationId: string
  queueOpen: boolean
}

/**
 * owner/manager/receptionist. Closing the line is a front-of-house judgement.
 *
 * This changes the runtime state and NOTHING else — it never touches the
 * service mode, and it never removes anyone already waiting.
 */
export function useSetLocationQueueOpen() {
  return useServiceModeMutation(async (input: SetLocationQueueOpenInput) => {
    const supabase = getSupabaseClient()
    const { error } = await supabase.rpc('set_location_queue_open', {
      p_location_id: input.locationId,
      p_queue_open: input.queueOpen,
    })
    if (error) throw error
  })
}

export interface SetBarberServiceModeOverrideInput {
  barberId: string
  /** null returns the barber to inheriting the establishment default. */
  mode: ServiceMode | null
}

/** owner/manager, or that barber themselves — resolved server-side from auth.uid(). */
export function useSetBarberServiceModeOverride() {
  return useServiceModeMutation(async (input: SetBarberServiceModeOverrideInput) => {
    const supabase = getSupabaseClient()
    const { error } = await supabase.rpc('set_barber_service_mode_override', {
      p_barber_id: input.barberId,
      p_mode: input.mode,
    })
    if (error) throw error
  })
}

export interface SetTemporaryOverrideInput {
  scope: ServiceModeScope
  locationId: string
  mode: ServiceMode
  /** ABSOLUTE ISO instant, or null for "until manually changed". Resolved by resolveDurationToExpiry. */
  expiresAt: string | null
  barberId?: string | null
}

/**
 * Creates a temporary override, superseding whatever was active on that target.
 *
 * `expiresAt` is an absolute instant. The backend never receives "today" or
 * "until closing" — those are resolved against the establishment's timezone
 * before this is called, because a server asked to interpret them would have to
 * guess whose midnight was meant.
 */
export function useSetServiceModeTemporaryOverride() {
  return useServiceModeMutation(async (input: SetTemporaryOverrideInput) => {
    const supabase = getSupabaseClient()
    const { error } = await supabase.rpc('set_service_mode_temporary_override', {
      p_scope: input.scope,
      p_location_id: input.locationId,
      p_mode: input.mode,
      p_expires_at: input.expiresAt,
      p_barber_id: input.barberId ?? null,
    })
    if (error) throw error
  })
}

export interface ClearTemporaryOverrideInput {
  scope: ServiceModeScope
  locationId: string
  barberId?: string | null
}

/**
 * Clears the active temporary override, returning the effective mode to the
 * next precedence level. Clearing when nothing is active is a success, not an
 * error — the override may have lapsed a minute ago and the Pro tapping "back
 * to normal" should get the state they asked for.
 */
export function useClearServiceModeTemporaryOverride() {
  return useServiceModeMutation(async (input: ClearTemporaryOverrideInput) => {
    const supabase = getSupabaseClient()
    const { error } = await supabase.rpc('clear_service_mode_temporary_override', {
      p_scope: input.scope,
      p_location_id: input.locationId,
      p_barber_id: input.barberId ?? null,
    })
    if (error) throw error
  })
}

// --- customer CTA derivation -----------------------------------------------

/**
 * What a customer may actually DO, derived from server truth.
 *
 * A customer should never have to understand service modes. They should see
 * the actions that exist and, when an action does not exist, a reason rather
 * than an absence.
 *
 *   book / joinQueue   an actionable CTA
 *   queueClosed        the shop takes walk-ins, but not this minute. A
 *                      non-actionable state, deliberately distinct from
 *                      "no queue here at all" — the customer may want to come
 *                      back, and hiding it would tell them the wrong thing.
 *
 * `unavailable` yields neither, and no explanatory queue state either: there is
 * nothing to come back for in ten minutes.
 *
 * Social actions are NOT modelled here on purpose. Follow stays available in
 * every mode — a barber not taking bookings today is still someone you follow.
 */
export interface CustomerCtas {
  book: boolean
  joinQueue: boolean
  /** The queue exists and the mode allows it, but it is closed right now. */
  queueClosed: boolean
}

export function deriveCustomerCtas(state: PublicServiceState | null | undefined): CustomerCtas {
  if (!state) return { book: false, joinQueue: false, queueClosed: false }

  return {
    book: state.bookingAcceptingNewEntries,
    joinQueue: state.queueAcceptingNewEntries,
    // Only worth saying when the MODE would have allowed a walk-in. In
    // reservation_only or unavailable the queue is not merely shut, it is not
    // on offer, and "temporarily closed" would promise a return that is not
    // coming.
    queueClosed: state.modeAllowsQueue && !state.queueOpen,
  }
}

/**
 * The locale key describing why the effective mode is what it is.
 *
 * Kept beside the derivation so a new `mode_source` cannot be added to the
 * database without this failing to compile.
 */
export function modeSourceKey(source: ServiceModeSource): string {
  const keys: Record<ServiceModeSource, string> = {
    barber_temporary_override: 'serviceMode.source.barberTemporary',
    location_temporary_override: 'serviceMode.source.locationTemporary',
    barber_override: 'serviceMode.source.barberPersistent',
    location_default: 'serviceMode.source.locationDefault',
  }
  return keys[source]
}

/** The locale key naming a mode. Same exhaustiveness guarantee. */
export function modeLabelKey(mode: ServiceMode): string {
  const keys: Record<ServiceMode, string> = {
    hybrid: 'serviceMode.mode.hybrid',
    reservation_only: 'serviceMode.mode.reservationOnly',
    queue_only: 'serviceMode.mode.queueOnly',
    unavailable: 'serviceMode.mode.unavailable',
  }
  return keys[mode]
}

/** The locale key for a duration option. */
export function durationLabelKey(duration: OverrideDuration): string {
  const keys: Record<OverrideDuration, string> = {
    '30m': 'serviceMode.duration.thirtyMinutes',
    '1h': 'serviceMode.duration.oneHour',
    today: 'serviceMode.duration.today',
    until_closing: 'serviceMode.duration.untilClosing',
    manual: 'serviceMode.duration.untilChanged',
  }
  return keys[duration]
}

/**
 * A stable callback that applies a mode for a scope, choosing between the
 * persistent control and a temporary override by whether a duration was given.
 *
 * Exists so the UI does not have to know that "for 30 minutes" and "from now
 * on" are two different RPCs.
 */
export function useApplyServiceMode() {
  const setLocationMode = useSetLocationServiceMode()
  const setBarberMode = useSetBarberServiceModeOverride()
  const setTemporary = useSetServiceModeTemporaryOverride()
  const clearTemporary = useClearServiceModeTemporaryOverride()

  const setLocationModeAsync = setLocationMode.mutateAsync
  const setBarberModeAsync = setBarberMode.mutateAsync
  const setTemporaryAsync = setTemporary.mutateAsync
  const clearTemporaryAsync = clearTemporary.mutateAsync

  const apply = useCallback(
    async (args: {
      scope: ServiceModeScope
      locationId: string
      barberId?: string | null
      mode: ServiceMode
      expiresAt: string | null
      temporary: boolean
    }) => {
      if (args.temporary) {
        await setTemporaryAsync({
          scope: args.scope,
          locationId: args.locationId,
          mode: args.mode,
          expiresAt: args.expiresAt,
          barberId: args.barberId ?? null,
        })
        return
      }

      // A persistent change supersedes any temporary override on the same
      // target — otherwise the Pro would set the standing mode and watch the
      // screen keep showing the temporary one, which still legitimately wins on
      // precedence. Clearing first makes the control mean what it says.
      await clearTemporaryAsync({
        scope: args.scope,
        locationId: args.locationId,
        barberId: args.barberId ?? null,
      })

      if (args.scope === 'location') {
        await setLocationModeAsync({ locationId: args.locationId, mode: args.mode })
      } else if (args.barberId) {
        await setBarberModeAsync({ barberId: args.barberId, mode: args.mode })
      }
    },
    [setLocationModeAsync, setBarberModeAsync, setTemporaryAsync, clearTemporaryAsync],
  )

  return {
    apply,
    isPending:
      setLocationMode.isPending ||
      setBarberMode.isPending ||
      setTemporary.isPending ||
      clearTemporary.isPending,
    error:
      setLocationMode.error ?? setBarberMode.error ?? setTemporary.error ?? clearTemporary.error,
  }
}
