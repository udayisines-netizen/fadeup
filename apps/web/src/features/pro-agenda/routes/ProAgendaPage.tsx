import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isSoloOrganization, useProOrganization } from '@/shared/data/organization'
import { useMyBarberId, useOrganizationBarbers, type OrganizationBarber } from '@/shared/data/proBarbers'
import { errorMessageKey, toAppError } from '@/shared/data/errors'
import { formatDateTime } from '@/shared/lib/format'
import { useNow } from '@/shared/hooks/useNow'
import { bookingRefusalMessageKey } from '@/shared/lib/bookingRefusals'
import { Button } from '@/shared/ui/Button'
import { EmptyState } from '@/shared/ui/EmptyState'
import { SkeletonRect, SkeletonText } from '@/shared/ui/Skeleton'
import { useToast } from '@/shared/ui/Toast'
import { IconCalendar } from '@/shared/ui/icons'
import {
  AgendaActionError,
  useAgendaAppointments,
  useAgendaChannel,
  useAgendaServices,
  useAgendaTimeBlocks,
  useCancelAppointment,
  useCompleteAppointment,
  useCreateAppointment,
  useCreateTimeBlocks,
  useDeleteTimeBlocks,
  useMarkNoShow,
  useRescheduleAppointment,
  useSetRevenueVisibility,
  type AgendaAppointmentRow,
  type TimeBlockRow,
} from '@/features/pro-agenda/api/agenda'
import { AgendaHeader, type AgendaView } from '@/features/pro-agenda/components/AgendaHeader'
import { AppointmentSheet } from '@/features/pro-agenda/components/AppointmentSheet'
import { ConflictDialog } from '@/features/pro-agenda/components/ConflictDialog'
import { CreateAppointmentSheet, type CreateDraft, type CreateSubmit } from '@/features/pro-agenda/components/CreateAppointmentSheet'
import { DayGrid, HOUR_HEIGHT } from '@/features/pro-agenda/components/DayGrid'
import { TimeBlockSheet, type BlockDraft, type BlockSubmit } from '@/features/pro-agenda/components/TimeBlockSheet'
import { WeekGrid } from '@/features/pro-agenda/components/WeekGrid'
import { useChangedIds } from '@/features/pro-agenda/hooks/useChangedIds'
import { useDragMove, type DragItem, type DropTarget } from '@/features/pro-agenda/hooks/useDragMove'
import { findConflicts, holdsSlot, visibleHourRange, type ConflictReport } from '@/features/pro-agenda/lib/layout'
import {
  canBlockTimeFor,
  canCloseAppointment,
  canForceOverlap,
  canManageAgenda,
  canMoveAppointments,
  canSeeRevenue,
  canSetRevenueVisibility,
  canViewTeamAgenda,
  defaultBarberSelection,
  type AgendaViewer,
} from '@/features/pro-agenda/lib/permissions'
import {
  addDays,
  dayKeyInZone,
  instantAt,
  minutesOfDayInZone,
  snapMinutes,
  weekOf,
  zonedDayStart,
  type DayKey,
} from '@/features/pro-agenda/lib/time'

/**
 * OS-1 — /dashboard/agenda : le cœur de l'outil de travail. Un patron
 * l'ouvre le matin et ne le quitte pas de la journée.
 *
 * Vue JOUR par défaut (colonnes par barber, heures en ordonnée), vue
 * SEMAINE PAR RESSOURCE (barbers côte à côte, jours empilés), glisser-
 * déposer dans le temps et entre barbers, création manuelle, blocage de
 * temps ponctuel/récurrent, terminé en un geste, absent sans restriction,
 * annulation qui prévient le client. Fuseau : celui du LIEU. Realtime :
 * canal de contexte, seul l'élément modifié s'anime. Rôles : contrat
 * P1PRO §8 + règles OS-1 (permissions.ts, miroir du SQL).
 */

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches)
  useEffect(() => {
    const query = window.matchMedia('(max-width: 1023px)')
    const onChange = () => setMobile(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return mobile
}

function storedSelection(organizationId: string): string[] | null {
  try {
    const raw = window.localStorage.getItem(`fadeup.agenda.barbers.${organizationId}`)
    return raw ? (JSON.parse(raw) as string[]) : null
  } catch {
    return null
  }
}

function storeSelection(organizationId: string, ids: string[]): void {
  try {
    window.localStorage.setItem(`fadeup.agenda.barbers.${organizationId}`, JSON.stringify(ids))
  } catch {
    /* préférence seulement */
  }
}

type PendingAction =
  | { kind: 'move'; row: AgendaAppointmentRow; target: DropTarget }
  | { kind: 'create'; input: CreateSubmit }

export function ProAgendaPage() {
  const { t, i18n } = useTranslation('v2')
  const { toast } = useToast()
  const now = useNow(30_000)
  const isMobile = useIsMobile()

  const { organization, loading: orgLoading } = useProOrganization()
  const organizationId = organization?.organizationId ?? null
  const location = organization?.locations[0] ?? null
  const timezone = location?.timezone ?? 'UTC'
  const isSolo = isSoloOrganization(organization)

  const barbersQuery = useOrganizationBarbers(organizationId)
  const myBarber = useMyBarberId(organizationId)
  // OS-1 : un seul lieu à l'écran — le premier (limite déclarée, sélecteur
  // de lieu pour OS-2). Les fauteuils sans lieu déclaré restent visibles.
  const locationBarbers = useMemo(
    () => (barbersQuery.data ?? []).filter((b) => !location || !b.location_id || b.location_id === location.id),
    [barbersQuery.data, location],
  )
  const viewer: AgendaViewer = useMemo(
    () => ({
      role: organization?.role ?? 'barber',
      myBarberId: myBarber.data ?? null,
      canViewRevenue: organization?.canViewRevenue ?? false,
      isSolo,
    }),
    [isSolo, myBarber.data, organization?.canViewRevenue, organization?.role],
  )
  const seesRevenue = canSeeRevenue(viewer)
  const manages = canManageAgenda(viewer)
  const teamView = canViewTeamAgenda(viewer)

  /* ── L'état de navigation ─────────────────────────────────────────── */
  const [view, setView] = useState<AgendaView>('day')
  const [dayKey, setDayKey] = useState<DayKey>(() => dayKeyInZone(new Date(), timezone))
  const weekDays = useMemo(() => weekOf(dayKey), [dayKey])
  const [selection, setSelection] = useState<string[] | null>(null)

  // Un barber salarié ne voit que SON fauteuil (sélecteur absent, données bornées).
  const barbers = useMemo(
    () => (teamView ? locationBarbers : locationBarbers.filter((b) => b.id === viewer.myBarberId)),
    [locationBarbers, teamView, viewer.myBarberId],
  )
  const barberIds = useMemo(() => barbers.map((b) => b.id), [barbers])

  // Sélection par défaut : un barber voit le sien ; le comptoir voit l'équipe
  // (préférence mémorisée) ; mobile : un seul à la fois.
  useEffect(() => {
    if (!organizationId || barbers.length === 0 || selection !== null) return
    const preset = defaultBarberSelection(viewer, barberIds)
    if (preset) {
      setSelection([preset])
      return
    }
    const stored = storedSelection(organizationId)?.filter((id) => barberIds.includes(id))
    setSelection(stored && stored.length > 0 ? stored : barberIds)
  }, [barberIds, barbers.length, organizationId, selection, viewer])

  const visibleBarbers = useMemo(() => {
    const ids = selection ?? barberIds
    const list = barbers.filter((b) => ids.includes(b.id))
    if (list.length === 0) return barbers
    return isMobile ? list.slice(0, 1) : list
  }, [barberIds, barbers, isMobile, selection])

  const onSelectionChange = useCallback(
    (ids: string[]) => {
      setSelection(ids)
      if (organizationId && manages) storeSelection(organizationId, ids)
    },
    [manages, organizationId],
  )

  /* ── La fenêtre de données ────────────────────────────────────────── */
  const windowRange = useMemo(() => {
    const startKey = view === 'day' ? dayKey : (weekDays[0] ?? dayKey)
    const from = zonedDayStart(startKey, timezone)
    const to = zonedDayStart(addDays(startKey, view === 'day' ? 1 : 7), timezone)
    return { from: from.toISOString(), to: to.toISOString() }
  }, [dayKey, timezone, view, weekDays])

  const scope = useMemo(
    () => ({
      locationId: location?.id ?? null,
      // Barber : sa borne, connue seulement une fois son fauteuil résolu.
      barberId: teamView ? null : myBarber.isSuccess ? myBarber.data : undefined,
    }),
    [location?.id, myBarber.data, myBarber.isSuccess, teamView],
  )
  const appointmentsQuery = useAgendaAppointments(organizationId, windowRange.from, windowRange.to, scope)
  const blocksQuery = useAgendaTimeBlocks(organizationId, windowRange.from, windowRange.to)
  const servicesQuery = useAgendaServices(organizationId, location?.id ?? null)
  useAgendaChannel(organizationId)

  const appointments = useMemo(() => appointmentsQuery.data ?? [], [appointmentsQuery.data])
  const blocks = useMemo(() => blocksQuery.data ?? [], [blocksQuery.data])
  const changed = useChangedIds(
    appointments,
    (row) => `${row.starts_at}|${row.ends_at}|${row.barber_id}|${row.status}|${row.overlap_forced_at ?? ''}`,
    `${windowRange.from}|${windowRange.to}`,
    !appointmentsQuery.isPlaceholderData,
  )

  const hourRange = useMemo(
    () =>
      visibleHourRange(
        [...appointments.filter((r) => r.status !== 'cancelled'), ...blocks].map((item) => ({
          startMinutes: minutesOfDayInZone(new Date(item.starts_at), timezone),
          endMinutes: Math.max(minutesOfDayInZone(new Date(item.ends_at), timezone), 1),
        })),
      ),
    [appointments, blocks, timezone],
  )

  const revenue = useMemo(() => {
    if (!seesRevenue || view !== 'day') return null
    const completed = appointments.filter((r) => r.status === 'completed')
    return {
      cents: completed.reduce((sum, r) => sum + (r.price_cents ?? 0), 0),
      currency: organization?.currency ?? 'EUR',
      completed: completed.length,
    }
  }, [appointments, organization?.currency, seesRevenue, view])

  /* ── Les actions ──────────────────────────────────────────────────── */
  const reschedule = useRescheduleAppointment(organizationId)
  const create = useCreateAppointment(organizationId)
  const complete = useCompleteAppointment(organizationId)
  const noShow = useMarkNoShow(organizationId)
  const cancel = useCancelAppointment(organizationId)
  const createBlocks = useCreateTimeBlocks(organizationId)
  const deleteBlocks = useDeleteTimeBlocks(organizationId)
  const setRevenue = useSetRevenueVisibility(organizationId)
  const busy =
    reschedule.isPending || create.isPending || complete.isPending || noShow.isPending || cancel.isPending || createBlocks.isPending || deleteBlocks.isPending

  const [openRow, setOpenRow] = useState<AgendaAppointmentRow | null>(null)
  const [createDraft, setCreateDraft] = useState<CreateDraft | null>(null)
  const [blockDraft, setBlockDraft] = useState<BlockDraft | null>(null)
  const [openBlock, setOpenBlock] = useState<TimeBlockRow | null>(null)
  const [pending, setPending] = useState<{ action: PendingAction; report: ConflictReport<AgendaAppointmentRow, TimeBlockRow> } | null>(null)

  // La fiche ouverte suit la donnée fraîche (terminé → badge, etc.).
  const openRowLive = useMemo(() => (openRow ? (appointments.find((r) => r.id === openRow.id) ?? openRow) : null), [appointments, openRow])

  const failure = useCallback(
    (error: unknown) => {
      if (error instanceof AgendaActionError && error.code !== 'unknown') {
        toast({ tone: 'error', title: t(bookingRefusalMessageKey(error.code)) })
        return
      }
      const raw = error instanceof AgendaActionError ? error.raw : error
      toast({ tone: 'error', title: t(errorMessageKey(toAppError(raw))) })
    },
    [t, toast],
  )

  const runComplete = useCallback(
    (row: AgendaAppointmentRow) =>
      complete.mutate(row.id, {
        onSuccess: () => {
          setOpenRow(null)
          toast({ tone: 'success', title: t('pro.agenda.toast.completed') })
        },
        onError: failure,
      }),
    [complete, failure, t, toast],
  )

  const runMove = useCallback(
    (row: AgendaAppointmentRow, target: DropTarget, force?: string) => {
      reschedule.mutate(
        {
          appointmentId: row.id,
          startsAt: instantAt(target.dayKey, target.minutes, timezone).toISOString(),
          barberId: target.barberId !== row.barber_id ? target.barberId : null,
          ...(force ? { force: true, forceReason: force } : {}),
        },
        {
          onSuccess: () => {
            setPending(null)
            setOpenRow(null)
            toast({ tone: 'success', title: t('pro.agenda.toast.moved') })
          },
          onError: failure,
        },
      )
    },
    [failure, reschedule, t, timezone, toast],
  )

  const runCreate = useCallback(
    (input: CreateSubmit, force?: string) => {
      if (!location) return
      create.mutate(
        {
          locationId: location.id,
          barberId: input.barberId,
          serviceId: input.serviceId,
          startsAt: instantAt(input.dayKey, input.minutes, timezone).toISOString(),
          customerName: input.customerName,
          customerPhone: input.customerPhone || undefined,
          customerEmail: input.customerEmail || undefined,
          notes: input.notes || undefined,
          ...(force ? { force: true, forceReason: force } : {}),
        },
        {
          onSuccess: () => {
            setPending(null)
            setCreateDraft(null)
            toast({ tone: 'success', title: t('pro.agenda.toast.created') })
          },
          onError: failure,
        },
      )
    },
    [create, failure, location, t, timezone, toast],
  )

  /** L'avertissement AVANT le geste : même règle que le serveur. */
  const requestMove = useCallback(
    (row: AgendaAppointmentRow, target: DropTarget) => {
      const starts = instantAt(target.dayKey, target.minutes, timezone)
      const ends = new Date(starts.getTime() + (Date.parse(row.ends_at) - Date.parse(row.starts_at)))
      const report = findConflicts(
        { excludeId: row.id, barberId: target.barberId, starts, ends, bufferBeforeMinutes: row.buffer_before_minutes, bufferAfterMinutes: row.buffer_after_minutes },
        appointments,
        blocks,
      )
      if (report.any) setPending({ action: { kind: 'move', row, target }, report })
      else runMove(row, target)
    },
    [appointments, blocks, runMove, timezone],
  )

  const requestCreate = useCallback(
    (input: CreateSubmit) => {
      const service = servicesQuery.data?.find((s) => s.id === input.serviceId)
      if (!service) return
      const starts = instantAt(input.dayKey, input.minutes, timezone)
      const ends = new Date(starts.getTime() + service.duration_minutes * 60_000)
      const report = findConflicts(
        { barberId: input.barberId, starts, ends, bufferBeforeMinutes: service.buffer_before_minutes, bufferAfterMinutes: service.buffer_after_minutes },
        appointments,
        blocks,
      )
      if (report.any) setPending({ action: { kind: 'create', input }, report })
      else runCreate(input)
    },
    [appointments, blocks, runCreate, servicesQuery.data, timezone],
  )

  const onForce = (reason: string) => {
    if (!pending) return
    if (pending.action.kind === 'move') runMove(pending.action.row, pending.action.target, reason)
    else runCreate(pending.action.input, reason)
  }

  /* ── Le glisser-déposer ───────────────────────────────────────────── */
  const onDrop = useCallback(
    (item: DragItem, target: DropTarget) => {
      const row = appointments.find((r) => r.id === item.id)
      if (row) requestMove(row, target)
    },
    [appointments, requestMove],
  )
  const { drag, startDrag } = useDragMove({
    enabled: canMoveAppointments(viewer),
    hourHeight: HOUR_HEIGHT,
    startHour: hourRange.start,
    endHour: hourRange.end,
    onDrop,
  })
  const canDrag = useCallback((row: AgendaAppointmentRow) => canMoveAppointments(viewer) && holdsSlot(row.status) && row.status !== 'completed', [viewer])
  const canCreateFor = useCallback(() => manages, [manages])
  // « Terminé » en un geste sur la carte : rôle habilité, ligne confirmée,
  // rendez-vous COMMENCÉ (c'est le client au fauteuil qu'on clôt d'un tap).
  const quickCompleteFor = useCallback(
    (row: AgendaAppointmentRow) =>
      row.status === 'confirmed' && Date.parse(row.starts_at) <= now.getTime() && canCloseAppointment(viewer, row.barber_id) ? runComplete : undefined,
    [now, runComplete, viewer],
  )
  const canBlockFor = useCallback((barberId: string) => canBlockTimeFor(viewer, barberId), [viewer])

  /* ── Rendu ────────────────────────────────────────────────────────── */
  const loading = orgLoading || barbersQuery.isPending || appointmentsQuery.isPending || blocksQuery.isPending
  const error = appointmentsQuery.error ?? blocksQuery.error ?? barbersQuery.error
  const empty =
    !loading &&
    !error &&
    appointments.filter((r) => r.status !== 'cancelled' && visibleBarbers.some((b) => b.id === r.barber_id)).length === 0 &&
    blocks.filter((b) => visibleBarbers.some((v) => v.id === b.barber_id)).length === 0

  const defaultCreateDraft = (): CreateDraft => {
    const barberId = visibleBarbers[0]?.id ?? barberIds[0] ?? ''
    const today = dayKeyInZone(now, timezone)
    const minutes = dayKey === today ? Math.min(snapMinutes(minutesOfDayInZone(now, timezone) + 15, 15), 23 * 60) : hourRange.start * 60 + 60
    return { barberId, dayKey: view === 'day' ? dayKey : (weekDays[0] ?? dayKey), minutes }
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-5 lg:px-8 lg:py-8" data-testid="pro-agenda">
      <AgendaHeader
        view={view}
        dayKey={dayKey}
        weekDays={weekDays}
        timezone={timezone}
        barbers={barbers}
        selected={visibleBarbers.map((b) => b.id)}
        isSolo={isSolo}
        isMobile={isMobile}
        canPickBarber={teamView}
        canCreate={manages && barbers.length > 0}
        canBlock={barbers.some((b) => canBlockFor(b.id))}
        canSetRevenue={canSetRevenueVisibility(viewer) && !isSolo}
        revenue={revenue}
        onViewChange={setView}
        onNavigate={(direction) => setDayKey((key) => addDays(key, view === 'day' ? direction : direction * 7))}
        onToday={() => setDayKey(dayKeyInZone(new Date(), timezone))}
        onSelectionChange={onSelectionChange}
        onCreate={() => setCreateDraft(defaultCreateDraft())}
        onBlock={() => {
          const d = defaultCreateDraft()
          const barberId = canBlockFor(d.barberId) ? d.barberId : (barbers.find((b) => canBlockFor(b.id))?.id ?? d.barberId)
          setBlockDraft({ ...d, barberId })
        }}
        onToggleRevenue={(barber: OrganizationBarber, visible) => {
          if (!barber.membership_id) return
          setRevenue.mutate(
            { membershipId: barber.membership_id, visible },
            {
              onSuccess: () => toast({ tone: 'success', title: t(visible ? 'pro.agenda.toast.revenueOn' : 'pro.agenda.toast.revenueOff', { name: barber.display_name }) }),
              onError: failure,
            },
          )
        }}
      />

      {loading ? (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label={t('pro.agenda.loading')}>
          <div className="flex gap-3">
            <SkeletonText className="w-24" />
            <SkeletonText className="w-24" />
          </div>
          <SkeletonRect className="h-96 w-full" />
        </div>
      ) : error ? (
        <div className="rounded-[var(--radius-card)] border border-[var(--fu-border)] bg-[var(--fu-surface)] p-4">
          <p className="text-fu-sm text-[var(--fu-text-secondary)]">{t(errorMessageKey(toAppError(error)))}</p>
          <Button
            variant="secondary"
            className="mt-3"
            onClick={() => {
              void appointmentsQuery.refetch()
              void blocksQuery.refetch()
              void barbersQuery.refetch()
            }}
          >
            {t('common.action.retry')}
          </Button>
        </div>
      ) : (
        <div className="rounded-[var(--radius-card)] border border-[var(--fu-border)] bg-[var(--fu-surface)]">
          {empty && (
            <div data-testid="agenda-empty">
              <EmptyState
                icon={<IconCalendar />}
                title={barbers.length === 0 ? t('pro.agenda.empty.noBarbersTitle') : view === 'day' ? t('pro.agenda.empty.title') : t('pro.agenda.empty.week')}
                description={barbers.length === 0 ? t('pro.agenda.empty.noBarbersDescription') : t('pro.agenda.empty.description')}
                action={
                  barbers.length === 0 ? undefined : manages ? (
                    <Button variant="primary" onClick={() => setCreateDraft(defaultCreateDraft())}>
                      {t('pro.agenda.empty.action')}
                    </Button>
                  ) : (
                    <Button variant="secondary" onClick={() => setDayKey((key) => addDays(key, 1))}>
                      {t('pro.agenda.nav.next')}
                    </Button>
                  )
                }
                className="py-8"
              />
            </div>
          )}
          {view === 'day' ? (
            <DayGrid
              dayKey={dayKey}
              timezone={timezone}
              barbers={visibleBarbers}
              appointments={appointments}
              blocks={blocks}
              hourRange={hourRange}
              now={now}
              seesRevenue={seesRevenue}
              isSolo={isSolo}
              changed={changed}
              drag={drag}
              canDrag={canDrag}
              canCreateFor={canCreateFor}
              onStartDrag={startDrag}
              onOpenAppointment={setOpenRow}
              onOpenBlock={setOpenBlock}
              quickComplete={quickCompleteFor}
              onCreateAt={(barberId, minutes) => setCreateDraft({ barberId, dayKey, minutes })}
            />
          ) : (
            <WeekGrid
              days={weekDays}
              timezone={timezone}
              barbers={visibleBarbers}
              appointments={appointments}
              blocks={blocks}
              now={now}
              seesRevenue={seesRevenue}
              isSolo={isSolo}
              changed={changed}
              drag={drag}
              canDrag={canDrag}
              canCreateFor={canCreateFor}
              onStartDrag={startDrag}
              onOpenAppointment={setOpenRow}
              onOpenBlock={setOpenBlock}
              quickComplete={quickCompleteFor}
              onCreateAt={(barberId, day) => setCreateDraft({ barberId, dayKey: day, minutes: hourRange.start * 60 + 60 })}
            />
          )}
        </div>
      )}

      {/* Le fantôme du glisser : suit le pointeur, sans animation (le geste
          reste utilisable sous prefers-reduced-motion). */}
      {drag?.active && (
        <div
          aria-hidden="true"
          data-testid="agenda-drag-ghost"
          style={{ insetInlineStart: drag.x - drag.offsetX, top: drag.y - drag.offsetY, width: drag.width, height: drag.height }}
          className="pointer-events-none fixed z-[var(--fu-z-overlay)] rounded-[var(--radius-control)] border-2 border-[var(--fu-accent)] bg-[var(--fu-surface)] px-2 py-1 text-fu-xs font-semibold text-[var(--fu-text-primary)]"
        >
          <p className="truncate">{drag.item.label}</p>
          {drag.target && (
            <p className="font-fu-mono tabular-nums text-[var(--fu-text-secondary)]">
              {t('pro.agenda.grid.dropTarget', {
                time: formatDateTime(instantAt(drag.target.dayKey, drag.target.minutes, timezone), timezone, 'time', i18n.language),
                name: barbers.find((b) => b.id === drag.target?.barberId)?.display_name ?? '',
              })}
            </p>
          )}
        </div>
      )}

      <AppointmentSheet
        row={openRowLive}
        timezone={timezone}
        barbers={barbers}
        isSolo={isSolo}
        seesRevenue={seesRevenue}
        canClose={openRowLive ? canCloseAppointment(viewer, openRowLive.barber_id) : false}
        canMove={canMoveAppointments(viewer)}
        canCancel={manages}
        busy={busy}
        onOpenChange={(open) => {
          if (!open) setOpenRow(null)
        }}
        onComplete={runComplete}
        onNoShow={(row) =>
          noShow.mutate(row.id, {
            onSuccess: () => {
              setOpenRow(null)
              toast({ tone: 'neutral', title: t('pro.agenda.toast.noShow') })
            },
            onError: failure,
          })
        }
        onMove={(row, target) => requestMove(row, { barberId: target.barberId, dayKey: target.dayKey, minutes: target.minutes })}
        onCancel={(row, note) =>
          cancel.mutate(
            { appointmentId: row.id, note: note || undefined },
            {
              onSuccess: () => {
                setOpenRow(null)
                toast({ tone: 'neutral', title: t('pro.agenda.toast.cancelled') })
              },
              onError: failure,
            },
          )
        }
      />

      <CreateAppointmentSheet
        draft={createDraft}
        services={servicesQuery.data}
        barbers={barbers}
        currency={organization?.currency ?? 'EUR'}
        isSolo={isSolo}
        seesRevenue={seesRevenue}
        busy={create.isPending}
        onOpenChange={(open) => {
          if (!open) setCreateDraft(null)
        }}
        onSubmit={requestCreate}
      />

      <TimeBlockSheet
        draft={blockDraft}
        existing={openBlock}
        timezone={timezone}
        barbers={barbers}
        appointments={appointments}
        isSolo={isSolo}
        canBlockFor={canBlockFor}
        busy={createBlocks.isPending || deleteBlocks.isPending}
        onOpenChange={(open) => {
          if (!open) {
            setBlockDraft(null)
            setOpenBlock(null)
          }
        }}
        onSubmit={(input: BlockSubmit) => {
          if (!organizationId) return
          createBlocks.mutate(
            input.occurrences.map((o) => ({
              organization_id: organizationId,
              location_id: location?.id ?? null,
              barber_id: input.barberId,
              starts_at: o.starts_at,
              ends_at: o.ends_at,
              reason: input.reason || null,
              series_id: input.seriesId,
            })),
            {
              onSuccess: () => {
                setBlockDraft(null)
                toast({ tone: 'success', title: t('pro.agenda.toast.blocked') })
              },
              onError: failure,
            },
          )
        }}
        onDelete={(block, scope) =>
          deleteBlocks.mutate(
            { id: block.id, seriesId: block.series_id, scope },
            {
              onSuccess: () => {
                setOpenBlock(null)
                toast({ tone: 'neutral', title: t('pro.agenda.toast.unblocked') })
              },
              onError: failure,
            },
          )
        }
      />

      <ConflictDialog
        open={pending !== null}
        report={pending?.report ?? null}
        timezone={timezone}
        canForce={canForceOverlap(viewer)}
        submitting={reschedule.isPending || create.isPending}
        onCancel={() => setPending(null)}
        onForce={onForce}
      />
    </div>
  )
}
