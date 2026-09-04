import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { celebrateSuccess, flashUpdate, measureTop, playReorder, pop } from '@/shared/motion'
import { useTheme, useApplySurfaceTheme } from '@/shared/theme/useTheme'
import type { SurfaceTheme } from '@/shared/theme/ThemeProvider'
import { cn } from '@/shared/lib/cn'
import { Avatar } from '@/shared/ui/Avatar'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Checkbox } from '@/shared/ui/Checkbox'
import { Chip } from '@/shared/ui/Chip'
import { ClaimBadge } from '@/shared/ui/ClaimBadge'
import { Combobox } from '@/shared/ui/Combobox'
import { DateTime } from '@/shared/ui/DateTime'
import { Dialog } from '@/shared/ui/Dialog'
import { Duration } from '@/shared/ui/Duration'
import { EmptyState } from '@/shared/ui/EmptyState'
import { IconButton } from '@/shared/ui/IconButton'
import { Input } from '@/shared/ui/Input'
import { MediaFrame } from '@/shared/ui/MediaFrame'
import { MetricValue, type MetricValueProps } from '@/shared/ui/MetricValue'
import { Money } from '@/shared/ui/Money'
import { OTPInput } from '@/shared/ui/OTPInput'
import { Pagination } from '@/shared/ui/Pagination'
import { Popover } from '@/shared/ui/Popover'
import { QRScanner, type QRScanError } from '@/shared/ui/QRScanner'
import { Radio } from '@/shared/ui/Radio'
import { Rating } from '@/shared/ui/Rating'
import { Row } from '@/shared/ui/Row'
import { SegmentedControl } from '@/shared/ui/SegmentedControl'
import { Select } from '@/shared/ui/Select'
import { Sheet } from '@/shared/ui/Sheet'
import { SkeletonCircle, SkeletonRect, SkeletonRow, SkeletonText } from '@/shared/ui/Skeleton'
import { Spinner } from '@/shared/ui/Spinner'
import { StateBadge, type FadeUpState } from '@/shared/ui/StateBadge'
import { StickyActionBar } from '@/shared/ui/StickyActionBar'
import { Switch } from '@/shared/ui/Switch'
import { Tabs } from '@/shared/ui/Tabs'
import { Textarea } from '@/shared/ui/Textarea'
import { useToast } from '@/shared/ui/Toast'
import * as Icons from '@/shared/ui/icons'
import { IconFilter, IconLocation, IconSearch, IconShare } from '@/shared/ui/icons'

const ALL_STATES: FadeUpState[] = [
  'bookable',
  'not-bookable',
  'available',
  'unavailable',
  'pending-request',
  'confirmed',
  'queue-open',
  'queue-full',
  'queue-closed',
  'called',
  'missed',
  'offline',
  'reconnecting',
  'partial-data',
]

const METRICS: MetricValueProps['kind'][] = ['followers', 'verified-clients', 'rating', 'reviews', 'likes']

/** §4 P1c — chaque comportement motion, déclenchable à la main. */
function MotionSection() {
  const { t } = useTranslation('v2')
  const [followed, setFollowed] = useState(false)
  const [liked, setLiked] = useState(false)
  const [revealKey, setRevealKey] = useState(0)
  const [pageKey, setPageKey] = useState(0)
  const [passportKey, setPassportKey] = useState(0)
  const [calledKey, setCalledKey] = useState(0)
  const [order, setOrder] = useState<[number, number]>([1, 2])
  const followRef = useRef<HTMLButtonElement | null>(null)
  const likeRef = useRef<HTMLButtonElement | null>(null)
  const rowRef = useRef<HTMLDivElement | null>(null)
  const moverRef = useRef<HTMLDivElement | null>(null)
  const successRef = useRef<HTMLSpanElement | null>(null)

  return (
    <Section title="Motion (P1c) — chaque geste répond à une action">
      <div className="flex flex-wrap items-center gap-3">
        {/* Pression : maintenir n'importe quel bouton (classe fu-press). */}
        <Button variant="primary">{t('common.action.confirm')}</Button>
        <Button
          ref={followRef}
          variant="secondary"
          iconStart={<Icons.IconFollow />}
          aria-pressed={followed}
          onClick={() => {
            setFollowed((value) => !value)
            if (followRef.current) pop(followRef.current)
          }}
        >
          {t('states.metric.followers')}
        </Button>
        <IconButton
          ref={likeRef}
          aria-label={t('states.metric.likes')}
          aria-pressed={liked}
          variant="outline"
          onClick={() => {
            setLiked((value) => !value)
            if (likeRef.current) pop(likeRef.current)
          }}
        >
          <Icons.IconLike className={cn(liked && 'fill-current text-[var(--fu-accent-text)]')} />
        </IconButton>
        <Button variant="secondary" onClick={() => setRevealKey((key) => key + 1)}>
          fu-rise-in
        </Button>
        <Button variant="secondary" onClick={() => setPageKey((key) => key + 1)}>
          fu-page-in
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            if (rowRef.current) flashUpdate(rowRef.current)
          }}
        >
          realtime flash
        </Button>
        <Button variant="secondary" onClick={() => setCalledKey((key) => key + 1)}>
          called
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            const el = moverRef.current
            if (!el) return
            const top = measureTop(el)
            setOrder(([a, b]) => [b, a])
            requestAnimationFrame(() => playReorder(el, top))
          }}
        >
          file : réordonner
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            if (successRef.current) celebrateSuccess(successRef.current)
          }}
        >
          succès de réservation
        </Button>
        <Button variant="secondary" onClick={() => setPassportKey((key) => key + 1)}>
          Passport
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div key={revealKey} className="fu-rise-in">
          <Card variant="subtle">
            <p className="text-fu-sm text-[var(--fu-text-secondary)]">fu-rise-in — révélation, UNE par écran</p>
          </Card>
        </div>
        <div key={pageKey} className="fu-page-in">
          <Card variant="subtle">
            <p className="text-fu-sm text-[var(--fu-text-secondary)]">fu-page-in — changement de page, fondu seul</p>
          </Card>
        </div>
      </div>

      <div className="rounded-[var(--radius-card)] border border-[var(--fu-border)]">
        <div ref={rowRef}>
          <Row title={t('states.connection.partialData')} subtitle="realtime : seul l'élément modifié flashe" />
        </div>
        <div key={calledKey} className="fu-called">
          <Row title={t('states.queue.called')} subtitle="fu-called — le moment de marque de la file" />
        </div>
        {order.map((n) => (
          <div key={n} ref={n === 1 ? moverRef : undefined}>
            <Row
              title={`${t('nav.pro.queue')} ${n}`}
              subtitle={n === 1 ? 'seul cet élément est animé (FLIP)' : '—'}
            />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-6">
        <span
          ref={successRef}
          className="inline-flex size-12 items-center justify-center rounded-[var(--radius-avatar)] bg-[var(--fu-accent)] text-[var(--fu-accent-fg)]"
        >
          <Icons.IconCheck aria-hidden="true" className="size-6" />
        </span>
        <div key={passportKey} className="fu-passport-in inline-block">
          <div
            data-theme="editorial"
            className="rounded-[var(--radius-card)] bg-[var(--fu-canvas)] px-5 py-4 text-[var(--fu-text-primary)]"
          >
            <p className="font-fu-mono text-fu-xs tracking-widest text-[var(--fu-text-secondary)]">FADE PASSPORT</p>
            <p className="mt-1 text-fu-base font-semibold">fu-passport-in</p>
          </div>
        </div>
      </div>
    </Section>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-[var(--fu-border)] py-6">
      <h2 className="mb-4 font-fu-mono text-fu-sm text-[var(--fu-text-secondary)]">{title}</h2>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  )
}

function GalleryControls({
  reducedMotion,
  onReducedMotion,
}: {
  reducedMotion: boolean
  onReducedMotion: (value: boolean) => void
}) {
  const { i18n } = useTranslation('v2')
  const { surface, setSurface } = useTheme()
  const [dir, setDir] = useState(() => document.documentElement.getAttribute('dir') ?? 'ltr')

  useEffect(() => {
    const previous = document.documentElement.getAttribute('dir') ?? 'ltr'
    document.documentElement.setAttribute('dir', dir)
    return () => document.documentElement.setAttribute('dir', previous)
  }, [dir])

  return (
    <div className="sticky top-0 z-[var(--fu-z-nav)] flex flex-wrap items-center gap-3 border-b border-[var(--fu-border)] bg-[var(--fu-canvas)] py-3">
      <SegmentedControl
        label="Theme"
        options={[
          { value: 'consumer', label: 'consumer' },
          { value: 'pro', label: 'pro' },
          { value: 'editorial', label: 'editorial' },
        ]}
        value={surface ?? 'consumer'}
        onValueChange={(value) => setSurface(value as SurfaceTheme)}
      />
      <SegmentedControl
        label="Langue"
        options={[
          { value: 'fr', label: 'FR' },
          { value: 'en', label: 'EN' },
        ]}
        value={i18n.language === 'fr' ? 'fr' : 'en'}
        onValueChange={(value) => void i18n.changeLanguage(value)}
      />
      <SegmentedControl
        label="Direction"
        options={[
          { value: 'ltr', label: 'LTR' },
          { value: 'rtl', label: 'RTL' },
        ]}
        value={dir}
        onValueChange={setDir}
      />
      <Switch label="prefers-reduced-motion" checked={reducedMotion} onCheckedChange={onReducedMotion} />
    </div>
  )
}

export function DevUiPage() {
  useApplySurfaceTheme('consumer')
  const { t } = useTranslation('v2')
  const { toast } = useToast()
  const [page, setPage] = useState(2)
  const [chipOn, setChipOn] = useState(true)
  const [segment, setSegment] = useState('a')
  const [otp, setOtp] = useState('')
  const [combo, setCombo] = useState<string | null>(null)
  const [scanActive, setScanActive] = useState(false)
  const [scanResult, setScanResult] = useState<string | null>(null)
  const [scanError, setScanError] = useState<QRScanError | null>(null)
  const [reducedMotion, setReducedMotion] = useState(false)

  // Simulation prefers-reduced-motion : réplique la règle globale de theme.css.
  useEffect(() => {
    if (!reducedMotion) return
    const style = document.createElement('style')
    style.textContent =
      '*,*::before,*::after{animation-duration:0.01ms!important;animation-iteration-count:1!important;transition-duration:100ms!important;transition-property:opacity!important;scroll-behavior:auto!important}'
    document.head.appendChild(style)
    return () => style.remove()
  }, [reducedMotion])

  const sampleDate = useMemo(() => new Date(Date.now() + 3 * 3600_000).toISOString(), [])

  return (
    <main className="mx-auto w-full max-w-3xl bg-[var(--fu-canvas)] px-4 pb-32 font-fu-sans text-[var(--fu-text-primary)]">
      <h1 className="pt-6 text-fu-xl font-semibold">{t('nav.devui.title')}</h1>
      <GalleryControls reducedMotion={reducedMotion} onReducedMotion={setReducedMotion} />

      <MotionSection />

      <Section title="Button">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">{t('common.action.confirm')}</Button>
          <Button variant="secondary">{t('common.action.cancel')}</Button>
          <Button variant="tertiary">{t('common.action.back')}</Button>
          <Button variant="destructive">{t('common.action.close')}</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" size="sm">{t('common.action.save')}</Button>
          <Button variant="primary" size="md">{t('common.action.save')}</Button>
          <Button variant="primary" size="lg">{t('common.action.save')}</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" loading>{t('common.action.save')}</Button>
          <Button variant="secondary" loading>{t('common.action.save')}</Button>
          <Button variant="primary" disabled>{t('common.action.save')}</Button>
          <Button variant="secondary" disabled>{t('common.action.save')}</Button>
          <Button variant="secondary" iconStart={<IconFilter />}>{t('common.action.filter')}</Button>
          <Button variant="secondary" iconEnd={<IconShare />}>{t('common.action.share')}</Button>
        </div>
        <Button variant="primary" fullWidth>{t('common.action.continue')}</Button>
      </Section>

      <Section title="IconButton">
        <div className="flex flex-wrap items-center gap-3">
          <IconButton aria-label={t('common.action.search')}><IconSearch /></IconButton>
          <IconButton aria-label={t('common.action.search')} variant="outline"><IconSearch /></IconButton>
          <IconButton aria-label={t('common.action.search')} loading><IconSearch /></IconButton>
          <IconButton aria-label={t('common.action.search')} disabled><IconSearch /></IconButton>
        </div>
      </Section>

      <Section title="Input / Textarea">
        <Input label={t('auth.login.email')} type="email" />
        <Input label={t('auth.login.email')} hint={t('auth.signup.passwordHint')} iconStart={<IconSearch />} />
        <Input label={t('auth.login.email')} error={t('auth.validation.emailInvalid')} defaultValue="fadeup@" />
        <Input label={t('auth.login.email')} disabled defaultValue="disabled@fadeup.example" />
        <Input label={t('common.money.from', { amount: '' })} suffix={<span className="text-fu-sm">EUR</span>} inputMode="decimal" />
        <Textarea label={t('common.action.save')} hint={t('auth.signup.passwordHint')} />
        <Textarea label={t('common.action.save')} error={t('errors.data.validation')} />
      </Section>

      <Section title="Select / Combobox / SegmentedControl">
        <Select
          label={t('common.language.label')}
          placeholder={t('common.action.search')}
          options={[
            { value: 'fr', label: t('common.language.fr') },
            { value: 'en', label: t('common.language.en') },
            { value: 'x', label: 'Disabled', disabled: true },
          ]}
        />
        <Select label={t('common.language.label')} error={t('errors.data.validation')} options={[{ value: 'fr', label: t('common.language.fr') }]} />
        <Combobox
          label={t('common.action.search')}
          placeholder={t('common.action.search')}
          value={combo}
          onValueChange={setCombo}
          options={[
            { value: '1', label: 'Fade' },
            { value: '2', label: 'Taper' },
            { value: '3', label: 'Burst fade' },
            { value: '4', label: 'Dégradé américain' },
          ]}
        />
        <SegmentedControl
          label="Segments"
          options={[
            { value: 'a', label: t('nav.tabs.home') },
            { value: 'b', label: t('nav.tabs.search') },
          ]}
          value={segment}
          onValueChange={setSegment}
        />
      </Section>

      <Section title="Checkbox / Radio / Switch / Chip / OTP">
        <Checkbox label={t('common.action.confirm')} defaultChecked />
        <Checkbox label={t('common.action.confirm')} />
        <Checkbox label={t('common.action.confirm')} disabled />
        <Radio
          label={t('common.language.label')}
          defaultValue="fr"
          options={[
            { value: 'fr', label: t('common.language.fr') },
            { value: 'en', label: t('common.language.en') },
            { value: 'x', label: 'Disabled', disabled: true },
          ]}
        />
        <Switch label={t('nav.connection.live')} defaultChecked />
        <Switch label={t('nav.connection.offline')} disabled />
        <div className="flex flex-wrap gap-2">
          <Chip selected={chipOn} onClick={() => setChipOn((value) => !value)}>Fade</Chip>
          <Chip selected={!chipOn} onClick={() => setChipOn((value) => !value)}>Taper</Chip>
        </div>
        <OTPInput label={t('auth.otp.code')} value={otp} onValueChange={setOtp} />
        <OTPInput label={t('auth.otp.code')} value="" onValueChange={() => undefined} error={t('auth.errors.otpInvalid')} />
      </Section>

      <Section title="Money / Duration / DateTime">
        <div className="flex flex-wrap items-center gap-4">
          <Money cents={2500} currency="EUR" />
          <Money cents={2500} currency="EUR" from />
          <Money cents={123450} currency="GBP" />
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Duration minutes={45} />
          <Duration minutes={45} format="long" />
          <Duration minutes={75} />
          <Duration minutes={120} />
        </div>
        <div className="flex flex-col gap-1.5">
          <DateTime value={sampleDate} timezone="Europe/Paris" format="time" />
          <DateTime value={sampleDate} timezone="Europe/Paris" format="date" />
          <DateTime value={sampleDate} timezone="Europe/Paris" format="datetime" />
          <DateTime value={sampleDate} timezone="Europe/Paris" format="relative" />
          <DateTime value={sampleDate} timezone="Europe/Paris" format="weekday" />
          {/* Fuseau du lieu ≠ fuseau de l'appareil : la mention apparaît. */}
          <DateTime value={sampleDate} timezone="Europe/London" format="time" showTimezone />
        </div>
      </Section>

      <Section title="Rating / MetricValue">
        <div className="flex flex-wrap items-center gap-4">
          <Rating value={null} />
          <Rating value={4.8} count={127} />
          <Rating value={3.5} count={1} size="sm" />
          <Rating value={5} showCount={false} />
        </div>
        <div className="flex flex-col items-start gap-2">
          {METRICS.map((kind) => (
            <MetricValue key={kind} kind={kind} value={kind === 'rating' ? 4.8 : 1247} />
          ))}
          <MetricValue kind="followers" value={null} />
        </div>
      </Section>

      <Section title="ClaimBadge / StateBadge">
        <div className="flex flex-wrap gap-2">
          <ClaimBadge state="unclaimed" />
          <ClaimBadge state="claimed" />
          <ClaimBadge state="verified" />
          <ClaimBadge state="unclaimed" size="sm" />
        </div>
        <div className="flex flex-wrap gap-2">
          {ALL_STATES.map((state) => (
            <StateBadge key={state} state={state} />
          ))}
        </div>
      </Section>

      <Section title="Avatar">
        <div className="flex flex-wrap items-center gap-3">
          <Avatar name="Mohamed El Amrani" size="sm" />
          <Avatar name="Mohamed El Amrani" />
          <Avatar name="Sofia Lindgren" size="lg" />
          <Avatar name="Barber Test" size="xl" />
          <Avatar name="FadeUp" src="/brand/fadeup-mark-primary.png" size="lg" />
        </div>
      </Section>

      <Section title="Row (primitive centrale)">
        <div className="rounded-[var(--radius-card)] border border-[var(--fu-border)]">
          <Row
            leading={<Avatar name="Mohamed El Amrani" />}
            title="Mohamed El Amrani"
            subtitle={<span className="inline-flex items-center gap-1"><IconLocation aria-hidden="true" className="size-3.5" />Antony · 1,7 km</span>}
            trailing={<Money cents={2500} currency="EUR" from />}
          />
          <Row
            as="link"
            to="/dev/ui"
            leading={<Avatar name="Side Agency" />}
            title="Side Agency"
            subtitle="19 rue Danton, Antony"
            trailing={<StateBadge state="queue-open" size="sm" />}
            chevron
          />
          <Row
            as="button"
            onClick={() => toast({ title: t('states.booking.confirmed'), tone: 'success' })}
            leading={<Avatar name="Barber Test" />}
            title="Barber Test"
            subtitle={<Rating value={null} />}
            trailing={<ClaimBadge state="unclaimed" size="sm" />}
          />
        </div>
      </Section>

      <Section title="Card / Badge">
        <div className="grid gap-3 md:grid-cols-3">
          <Card>
            <Badge>{t('states.metric.reviews')}</Badge>
            <p className="mt-2 text-fu-sm text-[var(--fu-text-secondary)]">outline</p>
          </Card>
          <Card variant="subtle">
            <Badge variant="brand">{t('states.claim.verified')}</Badge>
            <p className="mt-2 text-fu-sm text-[var(--fu-text-secondary)]">subtle</p>
          </Card>
          <Card variant="brand">
            <Badge variant="outline">{t('states.booking.bookable')}</Badge>
            <p className="mt-2 text-fu-sm text-[var(--fu-text-secondary)]">brand</p>
          </Card>
        </div>
      </Section>

      <Section title="Sheet / Dialog / Popover / Toast / Tabs">
        <div className="flex flex-wrap gap-3">
          <Sheet title={t('common.action.filter')} trigger={<Button variant="secondary">Sheet</Button>}>
            <p className="text-fu-sm text-[var(--fu-text-secondary)]">{t('empty.generic.description')}</p>
          </Sheet>
          <Dialog title={t('common.action.confirm')} description={t('empty.generic.description')} trigger={<Button variant="secondary">Dialog</Button>}>
            <Button variant="primary" fullWidth>{t('common.action.confirm')}</Button>
          </Dialog>
          <Popover trigger={<Button variant="secondary">Popover</Button>}>
            <p className="text-fu-sm text-[var(--fu-text-secondary)]">{t('empty.generic.description')}</p>
          </Popover>
          <Button variant="secondary" onClick={() => toast({ title: t('states.booking.confirmed'), tone: 'success' })}>
            Toast success
          </Button>
          <Button variant="secondary" onClick={() => toast({ title: t('errors.data.network'), tone: 'error' })}>
            Toast error
          </Button>
        </div>
        <Tabs
          label="Tabs"
          items={[
            { value: 'one', label: t('nav.tabs.home'), content: <p className="text-fu-sm">1</p> },
            { value: 'two', label: t('nav.tabs.search'), content: <p className="text-fu-sm">2</p> },
          ]}
        />
      </Section>

      <Section title="Skeleton / Spinner / EmptyState / Pagination">
        <div className="flex items-center gap-4">
          <SkeletonCircle />
          <SkeletonText className="w-40" />
          <SkeletonRect className="w-24" />
          <Spinner size="sm" />
          <Spinner />
          <Spinner size="lg" />
        </div>
        <div className="rounded-[var(--radius-card)] border border-[var(--fu-border)]">
          <SkeletonRow />
          <SkeletonRow />
        </div>
        <EmptyState
          title={t('empty.generic.title')}
          description={t('empty.generic.description')}
          action={<Button variant="secondary">{t('common.action.back')}</Button>}
        />
        <Pagination page={page} totalPages={9} onPageChange={setPage} />
      </Section>

      <Section title="MediaFrame">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MediaFrame alt="" ratio="square" />
          <MediaFrame alt="" ratio="portrait" />
          <MediaFrame alt="" ratio="landscape" />
          <MediaFrame alt="FadeUp" ratio="video" src="/brand/fadeup-mark-primary.png" />
        </div>
      </Section>

      <Section title="QRScanner">
        <div className="flex flex-col items-start gap-3">
          <Button variant="secondary" onClick={() => { setScanError(null); setScanActive((value) => !value) }}>
            {scanActive ? t('common.action.close') : 'Scanner'}
          </Button>
          {scanActive && (
            <QRScanner
              active={scanActive}
              onScan={(value) => { setScanResult(value); setScanActive(false) }}
              onError={(error) => { setScanError(error); setScanActive(false) }}
              className="max-w-60"
            />
          )}
          {scanResult && <p className="font-fu-mono text-fu-sm">{scanResult}</p>}
          {scanError && <p className="text-fu-sm text-[var(--fu-danger)]">{scanError}</p>}
        </div>
      </Section>

      <Section title="icons.ts">
        <div className="grid grid-cols-6 gap-3 md:grid-cols-10">
          {Object.entries(Icons).map(([name, Icon]) => (
            <div key={name} className="flex flex-col items-center gap-1" title={name}>
              <Icon aria-hidden="true" className={cn('size-5')} />
              <span className="truncate text-fu-xs text-[var(--fu-text-secondary)]">{name.replace(/^Icon/, '')}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="StickyActionBar">
        <div className="relative h-28 overflow-hidden rounded-[var(--radius-card)] border border-[var(--fu-border)]">
          <StickyActionBar className="absolute">
            <Button variant="primary" size="lg">{t('common.action.confirm')}</Button>
          </StickyActionBar>
        </div>
      </Section>
    </main>
  )
}
