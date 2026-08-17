import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react'
import {
  CalendarDays,
  Check,
  Clock,
  MapPin,
  Radio,
  Scissors,
  Search,
  Store,
  UserRound,
  Users,
} from 'lucide-react'
import type { BusinessMode } from '@/lib/commerce/plans'
import { worldForMode, type DemoWorld, type SceneId } from '@/components/for-business/scenes'
import { cn } from '@/lib/cn'

/**
 * The persistent visual world of /for-business.
 *
 * One shop, drawn at every moment of its day. That is the whole argument of the
 * page: these are not fourteen features, they are one loop. The customer who
 * arrives in `walkins` is the one waiting in `queue`, the one in the chair in
 * `chair`, the one whose Passport opens in `passport`, the one rebooking at the
 * end.
 *
 * The world MORPHS with the business mode rather than being three unrelated
 * screenshots. The same barber lane exists in all three modes; Independent has
 * one of it, Barbershop three, Multi-location a set per shop. Shared elements
 * carry a `layoutId`, so switching mode animates the same objects into their new
 * arrangement instead of cutting between pictures — the visual simplification of
 * Independent is itself the argument for the Solo plan.
 *
 * All values are fixed and illustrative. Nothing here touches the database, and
 * every stage is captioned as an illustration by its caller. Marketing demo
 * state and real marketplace data never meet.
 */

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'w-full overflow-hidden rounded-xl border border-border bg-paper-0 shadow-sm',
        className,
      )}
    >
      {children}
    </div>
  )
}

function PanelHead({ icon, title, meta }: { icon: React.ReactNode; title: string; meta?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
      <p className="inline-flex min-w-0 items-center gap-2 text-sm font-medium text-ink-950">
        {icon}
        <span className="truncate">{title}</span>
      </p>
      {meta ? (
        <span className="shrink-0 text-xs uppercase tracking-[0.12em] text-ink-500">{meta}</span>
      ) : null}
    </div>
  )
}

/** Softly animates a row in. Disabled under reduced motion, where it just appears. */
function Row({
  children,
  index = 0,
  className,
}: {
  children: React.ReactNode
  index?: number
  className?: string
}) {
  const reduced = useReducedMotion()
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.45, delay: reduced ? 0 : index * 0.06, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  )
}

/**
 * A barber lane — the atom the whole world is built from, and the thing that
 * morphs when the business mode changes.
 *
 * `layout` only, deliberately NOT `layoutId`. A shared-layout id is for one
 * element moving between two different trees; here the same lane is rendered by
 * every mounted stage at once — the hero, the sticky desktop stage, and the
 * inline stage inside every mobile scene block. Giving them a common id made
 * Motion treat them as one element in several places, project them onto each
 * other and fade all but one to `opacity: 0`, which emptied the hero's product
 * world completely. Keyed reconciliation plus `layout` gives the morph that was
 * actually wanted: lanes that survive a mode change slide to their new row,
 * lanes that do not are added or removed.
 */
function BarberLane({
  name,
  occupant,
  freeLabel,
  index = 0,
  compact = false,
}: {
  name: string
  occupant: string | null
  freeLabel: string
  index?: number
  compact?: boolean
}) {
  const reduced = useReducedMotion()
  return (
    <motion.div
      layout={!reduced}
      initial={reduced ? false : { opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.45, delay: reduced ? 0 : index * 0.05, ease: [0.16, 1, 0.3, 1] }}
      className={cn('flex items-center gap-3 bg-paper-0 px-5 py-3.5', compact && 'px-4 py-3')}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-paper-100 text-xs font-semibold text-ink-700">
        {name.slice(0, 2).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-ink-950">{name}</span>
      {occupant ? (
        <span className="shrink-0 rounded-md bg-accent-100 px-2.5 py-1 text-xs font-medium text-accent-800">
          {occupant}
        </span>
      ) : (
        <span className="shrink-0 text-xs text-ink-300">{freeLabel}</span>
      )}
    </motion.div>
  )
}

/** The shop/location strip. One name in Independent, a switcher in Multi. */
function LocationStrip({ world }: { world: DemoWorld }) {
  const { t } = useTranslation('landing')
  if (world.locations.length < 2) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-paper-50 px-4 py-2.5">
      {world.locations.map((location, index) => (
        <span
          key={location}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs',
            index === 0
              ? 'bg-ink-950 font-medium text-paper-0'
              : 'border border-border text-ink-500',
          )}
        >
          <MapPin className="h-3 w-3" aria-hidden="true" />
          {location}
        </span>
      ))}
      <span className="ms-auto text-[11px] uppercase tracking-[0.12em] text-ink-300">
        {t('business.stage.switchLocation')}
      </span>
    </div>
  )
}

/* ---------------------------------------------------------------- scenes */

function TodayStage({ world }: { world: DemoWorld }) {
  const { t } = useTranslation('landing')
  // Independent sees one clean timeline; a floor sees one lane per barber.
  const occupants: Record<string, string | null> = {
    [world.barbers[0]!]: world.customer,
    [world.barbers[1] ?? '_']: 'Ines D.',
    [world.barbers[2] ?? '_']: null,
    [world.barbers[3] ?? '_']: 'Théo B.',
    [world.barbers[4] ?? '_']: null,
  }

  return (
    <Panel>
      <PanelHead
        icon={<CalendarDays className="h-4 w-4 text-ink-500" />}
        title={t('business.stage.today')}
        meta={world.locations.length > 1 ? `${world.locations.length} · ${world.barbers.length}` : undefined}
      />
      <LocationStrip world={world} />
      <LayoutGroup>
        <div className="divide-y divide-border">
          {world.barbers.map((barber, index) => (
            <BarberLane
              key={barber}
              name={barber}
              index={index}
              occupant={occupants[barber] ?? null}
              freeLabel={t('business.stage.free')}
            />
          ))}
        </div>
      </LayoutGroup>
      <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-xs">
        <span className="inline-flex items-center gap-1.5 text-ink-500">
          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
          09:00 — 19:00
        </span>
        <span className="font-mono tabular-nums text-ink-500">{world.shopName}</span>
      </div>
    </Panel>
  )
}

function AppointmentsStage({ world }: { world: DemoWorld }) {
  const { t } = useTranslation('landing')
  const schedule = [
    { time: '09:00', who: 'Théo B.', barber: world.barbers[0]! },
    { time: '09:30', who: 'Amine K.', barber: world.barbers[1] ?? world.barbers[0]! },
    { time: '10:00', who: null, barber: null },
    { time: '10:30', who: 'Luca P.', barber: world.barbers[2] ?? world.barbers[0]! },
  ]

  return (
    <Panel>
      <PanelHead
        icon={<CalendarDays className="h-4 w-4 text-ink-500" />}
        title={t('business.stage.today')}
        meta={world.barbers.slice(0, 3).join(' · ')}
      />
      <ul className="divide-y divide-border">
        {schedule.map((slot, index) => (
          <li key={slot.time}>
            <Row index={index} className="flex items-center gap-4 px-5 py-3.5">
              <span className="w-14 shrink-0 font-mono text-sm tabular-nums text-ink-500">{slot.time}</span>
              {slot.who ? (
                <>
                  <span className="min-w-0 flex-1 truncate text-sm text-ink-950">{slot.who}</span>
                  {world.barbers.length > 1 ? (
                    <span className="shrink-0 text-xs text-ink-500">{slot.barber}</span>
                  ) : null}
                </>
              ) : (
                <span className="flex-1 text-sm text-ink-300">{t('business.stage.available')}</span>
              )}
            </Row>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function WalkInsStage({ world }: { world: DemoWorld }) {
  const { t } = useTranslation('landing')
  return (
    <Panel>
      <PanelHead icon={<UserRound className="h-4 w-4 text-accent-700" />} title={t('business.stage.walkIn')} />
      <div className="p-5">
        <Row className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent-100 text-sm font-semibold text-accent-800">
            {world.customerInitials}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink-950">{world.customer}</p>
            <p className="text-xs text-ink-500">{world.service}</p>
          </div>
        </Row>
        <Row index={1} className="mt-5 flex flex-wrap gap-2">
          {world.barbers.slice(0, 3).map((barber) => (
            <span key={barber} className="rounded-md border border-border-strong px-3 py-1.5 text-xs text-ink-700">
              {barber}
            </span>
          ))}
          {world.barbers.length > 1 ? (
            <span className="rounded-md border border-accent-600 bg-accent-600 px-3 py-1.5 text-xs font-medium text-on-accent">
              {t('business.stage.anyBarber')}
            </span>
          ) : (
            <span className="rounded-md border border-accent-600 bg-accent-600 px-3 py-1.5 text-xs font-medium text-on-accent">
              {t('business.stage.addToQueue')}
            </span>
          )}
        </Row>
      </div>
    </Panel>
  )
}

/**
 * The queue, advancing. The position genuinely moves — a customer who was #3
 * becomes #2 becomes next — because a still image of a list cannot show the one
 * thing that makes a live queue different from a waiting room.
 */
function QueueStage({ world }: { world: DemoWorld }) {
  const { t } = useTranslation('landing')
  const reduced = useReducedMotion()
  const steps = [
    { position: 3, eta: 22, ahead: ['Ines D.', 'Karim B.'] },
    { position: 2, eta: 14, ahead: ['Karim B.'] },
    { position: 1, eta: 0, ahead: [] },
  ]
  const step = useQueueStep(steps.length, reduced === true)
  const current = steps[step]!

  return (
    <Panel>
      <PanelHead
        icon={<Radio className="h-4 w-4 text-accent-700" />}
        title={t('business.stage.queueLabel')}
        meta={world.locations.length > 1 ? world.locations[0] : t('business.stage.waiting')}
      />
      <div className="p-5">
        <div className="flex items-center gap-4">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={current.position}
              initial={reduced ? false : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? { opacity: 1 } : { opacity: 0, y: -14 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className={cn(
                'flex h-16 w-16 shrink-0 items-center justify-center rounded-full font-mono text-2xl tabular-nums',
                current.position === 1 ? 'bg-accent-600 text-on-accent' : 'bg-paper-100 text-ink-950',
              )}
            >
              {current.position}
            </motion.span>
          </AnimatePresence>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink-950">{world.customer}</p>
            <p className="mt-0.5 text-sm text-ink-500">
              {current.position === 1
                ? t('business.stage.youreNext')
                : t('business.stage.aboutMinutes', { count: current.eta })}
            </p>
          </div>
        </div>

        <ul className="mt-5 space-y-1.5" aria-hidden="true">
          {current.ahead.map((name) => (
            <li key={name} className="truncate rounded-md bg-paper-50 px-3 py-2 text-xs text-ink-500">
              {name}
            </li>
          ))}
          {current.ahead.length === 0 ? (
            <li className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-ink-300">
              {t('business.stage.nobodyAhead')}
            </li>
          ) : null}
        </ul>
      </div>
    </Panel>
  )
}

/** Advances the demo queue on a timer, settling on the first state under reduced motion. */
function useQueueStep(length: number, reduced: boolean): number {
  const [step, setStep] = useState(0)
  useIntervalEffect(() => setStep((current) => (current + 1) % length), reduced ? null : 2400)
  return reduced ? 0 : step
}

function BarberStage({ world }: { world: DemoWorld }) {
  const { t } = useTranslation('landing')
  return (
    <Panel>
      <PanelHead icon={<Users className="h-4 w-4 text-ink-500" />} title={t('business.stage.chairLabel')} />
      <LayoutGroup>
        <div className="divide-y divide-border">
          {world.barbers.map((barber, index) => (
            <BarberLane
              key={barber}
              name={barber}
              index={index}
              occupant={index === 0 ? world.customer : null}
              freeLabel={t('business.stage.free')}
            />
          ))}
        </div>
      </LayoutGroup>
    </Panel>
  )
}

function ChairStage({ world }: { world: DemoWorld }) {
  const { t } = useTranslation('landing')
  return (
    <Panel>
      <PanelHead
        icon={<Scissors className="h-4 w-4 text-accent-700" />}
        title={t('business.stage.inChair')}
        meta={world.barbers[0]}
      />
      <div className="p-5">
        <Row>
          <p className="font-display text-2xl text-ink-950">{world.customer}</p>
          <p className="mt-1 text-sm text-ink-500">{world.service}</p>
        </Row>
        <Row index={1} className="mt-5 rounded-lg border border-border bg-paper-50 p-4">
          <p className="text-[11px] uppercase tracking-[0.14em] text-ink-500">{t('business.stage.lastTime')}</p>
          <p className="mt-1.5 text-sm text-ink-950">{t('business.stage.lastCutDetail')}</p>
        </Row>
        <Row index={2} className="mt-5 flex gap-2">
          <span className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent-600 px-4 py-2.5 text-sm font-medium text-on-accent">
            <Check className="h-4 w-4" aria-hidden="true" />
            {t('business.stage.complete')}
          </span>
          <span className="inline-flex items-center rounded-lg border border-border-strong px-4 py-2.5 text-sm text-ink-700">
            {t('business.stage.next')}
          </span>
        </Row>
      </div>
    </Panel>
  )
}

function PassportStage({ world }: { world: DemoWorld }) {
  const { t } = useTranslation('landing')
  const rows = [
    [t('business.stage.passportFade'), t('business.stage.passportFadeValue')],
    [t('business.stage.passportTop'), t('business.stage.passportTopValue')],
    [t('business.stage.passportBeard'), t('business.stage.passportBeardValue')],
    [t('business.stage.passportRhythm'), t('business.stage.everyWeeks', { count: 3 })],
  ]
  return (
    <Panel className="border-white/10 bg-forest-soft">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-3.5">
        <p className="truncate text-sm font-medium text-on-forest">Fade Passport · {world.customer}</p>
        <span className="shrink-0 rounded-full border border-white/20 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-on-forest-dim">
          {t('business.stage.everyPlan')}
        </span>
      </div>
      <dl className="divide-y divide-white/10">
        {rows.map(([label, value], index) => (
          <Row key={label} index={index} className="flex items-baseline justify-between gap-4 px-5 py-3.5">
            <dt className="text-[11px] uppercase tracking-[0.14em] text-on-forest-dim">{label}</dt>
            <dd className="text-end text-sm text-on-forest">{value}</dd>
          </Row>
        ))}
      </dl>
    </Panel>
  )
}

function HistoryStage({ world }: { world: DemoWorld }) {
  const { t } = useTranslation('landing')
  const visits = ['JAN', 'FEB', 'MAR', 'APR']
  return (
    <Panel>
      <PanelHead
        icon={<UserRound className="h-4 w-4 text-ink-500" />}
        title={world.customer}
        meta={`4 ${t('business.stage.visits')}`}
      />
      <div className="p-5">
        <div className="flex items-end justify-between gap-3">
          {visits.map((month, index) => (
            <Row key={month} index={index} className="flex flex-1 flex-col items-center gap-2">
              <span
                className="w-full rounded-t bg-accent-600/80"
                style={{ height: `${40 + index * 14}px` }}
                aria-hidden="true"
              />
              <span className="text-[11px] uppercase tracking-[0.1em] text-ink-500">{month}</span>
            </Row>
          ))}
        </div>
        <p className="mt-5 text-sm text-ink-700">{t('business.stage.everyWeeks', { count: 3 })}</p>
      </div>
    </Panel>
  )
}

/**
 * Retention. The one stage that shows something FadeUp does not do yet, so it
 * is drawn as a roadmap card rather than as a working screen — dashed, labelled,
 * and with no fabricated numbers on it.
 */
function RetentionStage({ world }: { world: DemoWorld }) {
  const { t } = useTranslation('landing')
  const items = [
    t('business.stage.retentionCycle'),
    t('business.stage.retentionReminder'),
    t('business.stage.retentionInactive'),
  ]
  return (
    <Panel className="border-dashed">
      <div className="flex items-center justify-between gap-3 border-b border-dashed border-border px-5 py-3.5">
        <p className="inline-flex items-center gap-2 text-sm font-medium text-ink-950">
          <Clock className="h-4 w-4 text-ink-500" aria-hidden="true" />
          {t('business.stage.retentionTitle')}
        </p>
        <span className="shrink-0 rounded-full bg-paper-100 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-ink-500">
          {t('business.stage.roadmap')}
        </span>
      </div>
      <div className="p-5">
        <p className="text-sm text-ink-700">{t('business.stage.retentionLead', { name: world.customer })}</p>
        <ul className="mt-4 space-y-2">
          {items.map((item, index) => (
            <Row
              key={item}
              index={index}
              className="rounded-lg border border-dashed border-border px-3.5 py-2.5 text-sm text-ink-500"
            >
              {item}
            </Row>
          ))}
        </ul>
      </div>
    </Panel>
  )
}

function ControlStage({ world }: { world: DemoWorld }) {
  const { t } = useTranslation('landing')

  // Each mode's operations screen answers a different question, so it shows a
  // different set of things. No invented metrics — these are counts of objects
  // the product actually has.
  const CONTROLS: Record<BusinessMode, string[]> = {
    independent: [
      t('business.stage.ctrlSchedule'),
      t('business.stage.ctrlAvailability'),
      t('business.stage.ctrlServices'),
      t('business.stage.ctrlCustomers'),
    ],
    barbershop: [
      t('business.stage.ctrlAppointments'),
      t('business.stage.ctrlQueue'),
      t('business.stage.ctrlBarbers'),
      t('business.stage.ctrlChairs'),
      t('business.stage.ctrlCustomers'),
      t('business.stage.ctrlServices'),
    ],
    multi_location: [
      t('business.stage.ctrlLocations'),
      t('business.stage.ctrlTeams'),
      t('business.stage.ctrlQueue'),
      t('business.stage.ctrlChairs'),
      t('business.stage.ctrlCustomers'),
      t('business.stage.ctrlServices'),
    ],
  }

  return (
    <Panel>
      <PanelHead icon={<Store className="h-4 w-4 text-ink-500" />} title={world.shopName} />
      <LocationStrip world={world} />
      <div className="grid grid-cols-2 gap-px bg-border">
        {CONTROLS[world.mode].map((item, index) => (
          <Row key={item} index={index} className="bg-paper-0 px-4 py-4 text-sm text-ink-950">
            {item}
          </Row>
        ))}
      </div>
    </Panel>
  )
}

function TeamStage({ world }: { world: DemoWorld }) {
  const { t } = useTranslation('landing')
  const roles = [
    t('business.stage.roleOwner'),
    t('business.stage.roleBarber'),
    t('business.stage.roleBarber'),
    t('business.stage.roleReception'),
    t('business.stage.roleManager'),
  ]
  return (
    <Panel>
      <PanelHead
        icon={<Users className="h-4 w-4 text-ink-500" />}
        title={t('business.stage.teamLabel')}
        meta={world.locations.length > 1 ? t('business.stage.perLocation') : undefined}
      />
      <ul className="divide-y divide-border">
        {world.barbers.map((member, index) => (
          <li key={member}>
            <Row index={index} className="flex items-center gap-3 px-5 py-3.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-paper-100 text-xs font-semibold text-ink-700">
                {member.slice(0, 2).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink-950">{member}</span>
              <span className="shrink-0 text-xs text-ink-500">{roles[index] ?? roles[1]}</span>
              {world.locations.length > 1 ? (
                <span className="hidden shrink-0 text-xs text-ink-300 sm:inline">
                  {world.locations[index % world.locations.length]}
                </span>
              ) : null}
            </Row>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

/** From here the stage becomes the CUSTOMER's phone — the same shop, seen from outside. */
function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[19rem] overflow-hidden rounded-[1.75rem] border border-border-strong bg-paper-0 p-3 shadow-md">
      <div className="overflow-hidden rounded-[1.25rem] border border-border">{children}</div>
    </div>
  )
}

function MarketplaceStage({ world }: { world: DemoWorld }) {
  const { t } = useTranslation('landing')
  return (
    <PhoneFrame>
      <div className="bg-paper-0">
        <div className="border-b border-border px-4 py-3.5">
          <p className="truncate font-display text-lg text-ink-950">{world.shopName}</p>
          <p className="truncate text-xs text-ink-500">
            {world.locations[0]} · {t('business.stage.publicProfile')}
          </p>
        </div>
        <ul className="divide-y divide-border">
          {world.barbers.slice(0, 3).map((barber, index) => (
            <li key={barber}>
              <Row index={index} className="flex items-center gap-3 px-4 py-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-100 text-[11px] font-semibold text-accent-800">
                  {barber.slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink-950">{barber}</span>
              </Row>
            </li>
          ))}
        </ul>
        <div className="flex gap-2 border-t border-border p-3">
          <span className="flex-1 rounded-lg bg-accent-600 px-3 py-2 text-center text-xs font-medium text-on-accent">
            {t('business.stage.book')}
          </span>
          <span className="flex-1 rounded-lg border border-border-strong px-3 py-2 text-center text-xs text-ink-700">
            {t('business.stage.joinQueue')}
          </span>
        </div>
      </div>
    </PhoneFrame>
  )
}

function DiscoveryStage({ world }: { world: DemoWorld }) {
  const { t } = useTranslation('landing')
  const results = [world.shopName, 'Studio Nord', 'Le Barbier']
  return (
    <PhoneFrame>
      <div className="bg-paper-0">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-ink-300" aria-hidden="true" />
          <span className="truncate text-sm text-ink-500">{t('business.stage.searchPlaceholder')}</span>
        </div>
        <ul className="divide-y divide-border">
          {results.map((shop, index) => (
            <li key={shop}>
              <Row index={index} className="flex items-center gap-3 px-4 py-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-paper-100">
                  <Scissors className="h-3.5 w-3.5 text-ink-500" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink-950">{shop}</p>
                  <p className="truncate text-[11px] text-ink-500">{world.locations[0]}</p>
                </div>
                {index === 0 ? (
                  <span className="shrink-0 rounded-md bg-accent-100 px-2 py-0.5 text-[10px] font-medium text-accent-800">
                    {t('business.stage.openNow')}
                  </span>
                ) : null}
              </Row>
            </li>
          ))}
        </ul>
      </div>
    </PhoneFrame>
  )
}

function RebookStage({ world }: { world: DemoWorld }) {
  const { t } = useTranslation('landing')
  return (
    <PhoneFrame>
      <div className="bg-paper-0 p-4">
        <p className="text-xs text-ink-500">{t('business.stage.daysSince', { count: 18 })}</p>
        <p className="mt-3 truncate font-display text-xl text-ink-950">
          {world.barbers[0]} · {world.shopName}
        </p>
        <p className="mt-1 text-sm text-ink-500">{world.service}</p>
        <span className="mt-5 block rounded-lg bg-ink-950 px-4 py-2.5 text-center text-sm font-medium text-paper-0">
          {t('business.stage.rebook')}
        </span>
        <div className="mt-5 border-t border-border pt-4">
          <p className="text-[11px] uppercase tracking-[0.12em] text-ink-500">{t('business.stage.today')}</p>
          <p className="mt-2 font-mono text-sm tabular-nums text-accent-700">10:00 · {world.customer}</p>
        </div>
      </div>
    </PhoneFrame>
  )
}

const STAGES: Record<SceneId, (props: { world: DemoWorld }) => React.ReactElement> = {
  today: TodayStage,
  appointments: AppointmentsStage,
  walkins: WalkInsStage,
  queue: QueueStage,
  barber: BarberStage,
  chair: ChairStage,
  passport: PassportStage,
  history: HistoryStage,
  retention: RetentionStage,
  control: ControlStage,
  team: TeamStage,
  marketplace: MarketplaceStage,
  discovery: DiscoveryStage,
  rebook: RebookStage,
}

/**
 * Renders one scene of the stage for one business mode.
 *
 * `aria-hidden` because the narrative column already carries the same
 * information as text — a screen reader should hear the story once, not once per
 * illustration. Remove every pixel of this component and the page still makes
 * its whole argument, in order.
 */
export function ProductStage({
  scene,
  mode,
  className,
}: {
  scene: SceneId
  mode: BusinessMode
  className?: string
}) {
  const Stage = STAGES[scene]
  const world = worldForMode(mode)
  return (
    <div className={cn('w-full', className)} aria-hidden="true">
      <Stage world={world} />
    </div>
  )
}

/* ------------------------------------------------------------- utilities */

/**
 * Runs a callback on an interval, pausing while the tab is hidden.
 *
 * Local and deliberately not exported: the queue demo is the only place on this
 * page that animates on a clock rather than on scroll or interaction, and a
 * marketing loop burning cycles in a background tab is pure battery cost.
 */
function useIntervalEffect(callback: () => void, delay: number | null) {
  const saved = useRef(callback)
  saved.current = callback

  useEffect(() => {
    if (delay === null) return
    // A demo looping in a background tab is pure battery cost.
    let timer: number | null = null
    function start() {
      if (timer === null) timer = window.setInterval(() => saved.current(), delay!)
    }
    function stop() {
      if (timer !== null) {
        window.clearInterval(timer)
        timer = null
      }
    }
    function onVisibility() {
      if (document.visibilityState === 'visible') start()
      else stop()
    }
    onVisibility()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [delay])
}
