import { useTranslation } from 'react-i18next'
import { motion, useReducedMotion } from 'motion/react'
import { CalendarDays, Check, Radio, Scissors, Search, Store, UserRound, Users } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * The persistent visual world of /for-business.
 *
 * Every scene below draws the SAME shop — the same barbers, the same three
 * chairs, the same customer — at a different moment in its day. That is the
 * whole argument of the page: these are not twelve features, they are one
 * loop. A customer who arrives in `walkins` is the one waiting in `queue`, is
 * the one in the chair in `chair`, is the one whose Passport opens in
 * `passport`, is the one rebooking at the end.
 *
 * All values are fixed and illustrative. Nothing here touches the database,
 * and every stage is captioned as an illustration where it could plausibly be
 * mistaken for live data.
 */

export type SceneId =
  | 'appointments'
  | 'walkins'
  | 'queue'
  | 'barber'
  | 'chair'
  | 'passport'
  | 'history'
  | 'floor'
  | 'owner'
  | 'team'
  | 'marketplace'
  | 'discovery'
  | 'rebook'

export const SCENE_IDS: SceneId[] = [
  'appointments',
  'walkins',
  'queue',
  'barber',
  'chair',
  'passport',
  'history',
  'floor',
  'owner',
  'team',
  'marketplace',
  'discovery',
  'rebook',
]

/** The cast, reused across every scene so the story stays one story. */
const CUSTOMER = 'Malik R.'
const BARBERS = ['Yanis', 'Sofia', 'Deniz'] as const

const SCHEDULE = [
  { time: '09:00', who: 'Théo B.', barber: 'Yanis' },
  { time: '09:30', who: 'Amine K.', barber: 'Sofia' },
  { time: '10:00', who: null, barber: null },
  { time: '10:30', who: 'Luca P.', barber: 'Deniz' },
] as const

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
      <p className="inline-flex items-center gap-2 text-sm font-medium text-ink-950">
        {icon}
        {title}
      </p>
      {meta ? <span className="text-xs uppercase tracking-[0.12em] text-ink-500">{meta}</span> : null}
    </div>
  )
}

/** Softly animates a row in. Disabled under reduced motion, where it just appears. */
function Row({ children, index = 0, className }: { children: React.ReactNode; index?: number; className?: string }) {
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

/* ---------------------------------------------------------------- scenes */

function AppointmentsStage() {
  const { t } = useTranslation('landing')
  return (
    <Panel>
      <PanelHead icon={<CalendarDays className="h-4 w-4 text-ink-500" />} title={t('business.stage.today')} meta="Yanis · Sofia · Deniz" />
      <ul className="divide-y divide-border">
        {SCHEDULE.map((slot, index) => (
          <li key={slot.time}>
            <Row index={index} className="flex items-center gap-4 px-5 py-3.5">
              <span className="w-14 shrink-0 font-mono text-sm tabular-nums text-ink-500">{slot.time}</span>
              {slot.who ? (
                <>
                  <span className="min-w-0 flex-1 truncate text-sm text-ink-950">{slot.who}</span>
                  <span className="shrink-0 text-xs text-ink-500">{slot.barber}</span>
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

function WalkInsStage() {
  const { t } = useTranslation('landing')
  return (
    <Panel>
      <PanelHead icon={<UserRound className="h-4 w-4 text-accent-700" />} title={t('business.stage.walkIn')} />
      <div className="p-5">
        <Row className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent-100 text-sm font-semibold text-accent-800">
            MR
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink-950">{CUSTOMER}</p>
            <p className="text-xs text-ink-500">Skin fade + beard</p>
          </div>
        </Row>
        <Row index={1} className="mt-5 flex flex-wrap gap-2">
          {BARBERS.map((barber) => (
            <span key={barber} className="rounded-md border border-border-strong px-3 py-1.5 text-xs text-ink-700">
              {barber}
            </span>
          ))}
          <span className="rounded-md border border-accent-600 bg-accent-600 px-3 py-1.5 text-xs font-medium text-on-accent">
            {t('business.stage.anyBarber')}
          </span>
        </Row>
      </div>
    </Panel>
  )
}

const QUEUE = [
  { name: CUSTOMER, position: 3, eta: 22 },
  { name: 'Ines D.', position: 2, eta: 14 },
  { name: 'Karim B.', position: 1, eta: 6 },
] as const

function QueueStage() {
  const { t } = useTranslation('landing')
  return (
    <Panel>
      <PanelHead icon={<Radio className="h-4 w-4 text-accent-700" />} title={t('business.stage.queueLabel')} meta={t('business.stage.waiting')} />
      <ul className="divide-y divide-border">
        {[...QUEUE].reverse().map((entry, index) => (
          <li key={entry.name}>
            <Row index={index} className="flex items-center gap-4 px-5 py-3.5">
              <span
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-mono text-sm tabular-nums',
                  entry.position === 1 ? 'bg-accent-600 text-on-accent' : 'bg-paper-100 text-ink-700',
                )}
              >
                {entry.position}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink-950">{entry.name}</span>
              <span className="shrink-0 font-mono text-xs tabular-nums text-ink-500">≈{entry.eta}m</span>
            </Row>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function BarberStage() {
  const { t } = useTranslation('landing')
  return (
    <Panel>
      <PanelHead icon={<Users className="h-4 w-4 text-ink-500" />} title={t('business.stage.chairLabel')} />
      <ul className="divide-y divide-border">
        {BARBERS.map((barber, index) => (
          <li key={barber}>
            <Row index={index} className="flex items-center gap-4 px-5 py-3.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-paper-100 text-xs font-semibold text-ink-700">
                {barber.slice(0, 2).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink-950">{barber}</span>
              {index === 0 ? (
                <span className="shrink-0 rounded-md bg-accent-100 px-2.5 py-1 text-xs font-medium text-accent-800">
                  {CUSTOMER}
                </span>
              ) : (
                <span className="shrink-0 text-xs text-ink-300">{t('business.stage.free')}</span>
              )}
            </Row>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function ChairStage() {
  const { t } = useTranslation('landing')
  return (
    <Panel>
      <PanelHead icon={<Scissors className="h-4 w-4 text-accent-700" />} title={t('business.stage.inChair')} meta="Yanis" />
      <div className="p-5">
        <Row>
          <p className="font-display text-2xl text-ink-950">{CUSTOMER}</p>
          <p className="mt-1 text-sm text-ink-500">Skin fade + beard</p>
        </Row>
        <Row index={1} className="mt-5 rounded-lg border border-border bg-paper-50 p-4">
          <p className="text-[11px] uppercase tracking-[0.14em] text-ink-500">{t('business.stage.lastTime')}</p>
          <p className="mt-1.5 text-sm text-ink-950">Skin fade, low · 4 on top · beard lined up</p>
        </Row>
        <Row index={2} className="mt-5 flex gap-2">
          <span className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent-600 px-4 py-2.5 text-sm font-medium text-on-accent">
            <Check className="h-4 w-4" />
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

function PassportStage() {
  const { t } = useTranslation('landing')
  const rows = [
    ['Fade', 'Skin fade, low'],
    ['Top', '4, textured'],
    ['Beard', 'Lined up, short'],
    ['Rhythm', t('business.stage.everyWeeks', { count: 3 })],
  ]
  return (
    <Panel className="border-white/10 bg-forest-soft">
      <div className="border-b border-white/10 px-5 py-3.5">
        <p className="text-sm font-medium text-on-forest">Fade Passport · {CUSTOMER}</p>
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

const VISITS = ['JAN', 'FEB', 'MAR', 'APR'] as const

function HistoryStage() {
  const { t } = useTranslation('landing')
  return (
    <Panel>
      <PanelHead icon={<UserRound className="h-4 w-4 text-ink-500" />} title={CUSTOMER} meta={`4 ${t('business.stage.visits')}`} />
      <div className="p-5">
        <div className="flex items-end justify-between gap-3">
          {VISITS.map((month, index) => (
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

function FloorStage() {
  const { t } = useTranslation('landing')
  const chairs = [
    { barber: 'Yanis', who: CUSTOMER },
    { barber: 'Sofia', who: 'Ines D.' },
    { barber: 'Deniz', who: null },
  ]
  return (
    <Panel>
      <PanelHead icon={<Store className="h-4 w-4 text-ink-500" />} title={t('business.stage.today')} meta="3 · 1 · 2" />
      <div className="grid gap-px bg-border sm:grid-cols-3">
        {chairs.map((chair, index) => (
          <Row key={chair.barber} index={index} className="bg-paper-0 p-4">
            <p className="text-[11px] uppercase tracking-[0.12em] text-ink-500">
              {t('business.stage.chairLabel')} {index + 1}
            </p>
            <p className="mt-2 text-sm font-medium text-ink-950">{chair.barber}</p>
            <p className={cn('mt-1 truncate text-xs', chair.who ? 'text-accent-700' : 'text-ink-300')}>
              {chair.who ?? t('business.stage.free')}
            </p>
          </Row>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3.5 text-sm">
        <span className="inline-flex items-center gap-2 text-ink-700">
          <Radio className="h-3.5 w-3.5 text-accent-700" />
          {t('business.stage.queueLabel')} · 2
        </span>
        <span className="font-mono text-xs tabular-nums text-ink-500">10:30 · Luca P.</span>
      </div>
    </Panel>
  )
}

function OwnerStage() {
  const { t } = useTranslation('landing')
  const secondary = ['Locations', 'Team', 'Services', 'Customers']
  return (
    <Panel>
      <PanelHead icon={<Store className="h-4 w-4 text-ink-500" />} title={t('business.stage.today')} />
      <div className="p-5">
        <div className="grid grid-cols-3 gap-3">
          {[
            ['12', 'Appointments'],
            ['5', 'Walk-ins'],
            ['2', t('business.stage.queueLabel')],
          ].map(([value, label], index) => (
            <Row key={label} index={index} className="rounded-lg border border-border bg-paper-50 p-3">
              <p className="font-mono text-2xl tabular-nums text-ink-950">{value}</p>
              <p className="mt-0.5 text-[11px] uppercase tracking-[0.1em] text-ink-500">{label}</p>
            </Row>
          ))}
        </div>
        <Row index={3} className="mt-5 flex flex-wrap gap-2">
          {secondary.map((item) => (
            <span key={item} className="rounded-md border border-border px-3 py-1.5 text-xs text-ink-500">
              {item}
            </span>
          ))}
        </Row>
      </div>
    </Panel>
  )
}

function TeamStage() {
  const { t } = useTranslation('landing')
  const team = [
    { name: 'Yanis', role: 'Barber', where: 'Combs' },
    { name: 'Sofia', role: 'Barber', where: 'Combs' },
    { name: 'Nora', role: 'Reception', where: 'Combs' },
  ]
  return (
    <Panel>
      <PanelHead icon={<Users className="h-4 w-4 text-ink-500" />} title="Team" meta={`${t('business.stage.role')} · ${t('business.stage.location')}`} />
      <ul className="divide-y divide-border">
        {team.map((member, index) => (
          <li key={member.name}>
            <Row index={index} className="flex items-center gap-4 px-5 py-3.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-paper-100 text-xs font-semibold text-ink-700">
                {member.name.slice(0, 2).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink-950">{member.name}</span>
              <span className="shrink-0 text-xs text-ink-500">{member.role}</span>
              <span className="shrink-0 text-xs text-ink-300">{member.where}</span>
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

function MarketplaceStage() {
  const { t } = useTranslation('landing')
  return (
    <PhoneFrame>
      <div className="bg-paper-0">
        <div className="border-b border-border px-4 py-3.5">
          <p className="font-display text-lg text-ink-950">Fade City</p>
          <p className="text-xs text-ink-500">Combs · {t('business.stage.publicProfile')}</p>
        </div>
        <ul className="divide-y divide-border">
          {BARBERS.map((barber, index) => (
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

function DiscoveryStage() {
  const { t } = useTranslation('landing')
  return (
    <PhoneFrame>
      <div className="bg-paper-0">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-ink-300" />
          <span className="truncate text-sm text-ink-500">{t('business.stage.searchPlaceholder')}</span>
        </div>
        <ul className="divide-y divide-border">
          {['Fade City', 'Studio Nord', 'Le Barbier'].map((shop, index) => (
            <li key={shop}>
              <Row index={index} className="flex items-center gap-3 px-4 py-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-paper-100">
                  <Scissors className="h-3.5 w-3.5 text-ink-500" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink-950">{shop}</p>
                  <p className="truncate text-[11px] text-ink-500">Combs</p>
                </div>
              </Row>
            </li>
          ))}
        </ul>
      </div>
    </PhoneFrame>
  )
}

function RebookStage() {
  const { t } = useTranslation('landing')
  return (
    <PhoneFrame>
      <div className="bg-paper-0 p-4">
        <p className="text-xs text-ink-500">{t('business.stage.daysSince', { count: 18 })}</p>
        <p className="mt-3 font-display text-xl text-ink-950">Yanis · Fade City</p>
        <p className="mt-1 text-sm text-ink-500">Skin fade + beard</p>
        <span className="mt-5 block rounded-lg bg-ink-950 px-4 py-2.5 text-center text-sm font-medium text-paper-0">
          {t('business.stage.rebook')}
        </span>
        <div className="mt-5 border-t border-border pt-4">
          <p className="text-[11px] uppercase tracking-[0.12em] text-ink-500">{t('business.stage.today')}</p>
          <p className="mt-2 font-mono text-sm tabular-nums text-accent-700">10:00 · {CUSTOMER}</p>
        </div>
      </div>
    </PhoneFrame>
  )
}

const STAGES: Record<SceneId, () => React.ReactElement> = {
  appointments: AppointmentsStage,
  walkins: WalkInsStage,
  queue: QueueStage,
  barber: BarberStage,
  chair: ChairStage,
  passport: PassportStage,
  history: HistoryStage,
  floor: FloorStage,
  owner: OwnerStage,
  team: TeamStage,
  marketplace: MarketplaceStage,
  discovery: DiscoveryStage,
  rebook: RebookStage,
}

/**
 * Renders one scene of the stage. `aria-hidden` because the narrative column
 * already carries the same information as text — a screen reader should hear
 * the story once, not once per illustration.
 */
export function ProductStage({ scene, className }: { scene: SceneId; className?: string }) {
  const Stage = STAGES[scene]
  return (
    <div className={cn('w-full', className)} aria-hidden="true">
      <Stage />
    </div>
  )
}
