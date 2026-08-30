import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDocumentMeta } from '@/lib/use-document-meta'
import {
  BUSINESS_TYPES,
  useApplyStarterServices,
  useApplyWeeklyHours,
  useCompleteOnboarding,
  useEnsureOwnerProfessional,
  useOrganizationReadiness,
  useSaveBusinessProfile,
  type BusinessType,
} from '@/lib/queries/onboarding'
import { templateFor } from '@/lib/onboarding/templates'
import {
  useOrganizationMarketplaceVisibility,
  useSetMarketplaceVisibility,
} from '@/lib/queries/organization-marketplace'
import { useOrgLocations, useUpdateLocation, type Location } from '@/lib/queries/locations'
import {
  useOrgStaffProfiles,
  useUpdateStaffProfile,
  type StaffProfile,
} from '@/lib/queries/staff-profiles'
import { useOrgBarbers } from '@/lib/queries/barbers'
import { getErrorMessage } from '@/lib/get-error-message'
import type { MembershipRole } from '@/lib/types'
import { useProScope } from '@/pro-v2/shell/pro-v2-shell'

/**
 * The business profile editor and the honest tail of onboarding.
 *
 * ============================================================================
 * READINESS IS THE SERVER'S VERDICT, NEVER THE UI'S
 * ============================================================================
 *
 * The setup checklist renders `get_organization_readiness` verbatim — twelve
 * server-computed requirements. Publishing goes through `complete_onboarding`,
 * whose own gate "never forces either": an incomplete business gets its
 * honest readiness report back, and the publication flag is guarded by a
 * table trigger that cannot be routed around from here.
 *
 * The quick actions are the same RPCs the onboarding wizard uses — starter
 * services from the shared per-business-type template (names localized at
 * apply time, so they persist in the operator's language), default weekly
 * hours applied only on an explicit tap and editable afterwards, and
 * `ensure_owner_professional` to make the owner bookable. Nothing is applied
 * silently.
 *
 * ============================================================================
 * ROLE BOUNDARIES MIRROR RLS
 * ============================================================================
 *
 * Business profile, marketplace visibility, locations and staff profiles are
 * all owner/manager writes at the RLS layer; the editors only render for
 * those roles and hiding them is a courtesy, never the security boundary.
 * A barber sees the read-only facts.
 *
 * WHAT IS DELIBERATELY MISSING: avatar upload — no legacy upload surface or
 * storage helper exists for staff avatars, so none is invented here
 * (recorded as a gap); `avatarUrl` and `locationId` pass through unchanged
 * on staff edits.
 */

const MANAGING_ROLES = new Set<MembershipRole>(['owner', 'manager'])

/** Mon–Sat 09:00–19:00, closed Sunday — a starting point the operator applies explicitly and can edit. */
const DEFAULT_WEEK = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
  dayOfWeek,
  isClosed: dayOfWeek === 0,
  openTime: dayOfWeek === 0 ? null : '09:00',
  closeTime: dayOfWeek === 0 ? null : '19:00',
}))

const inputClass =
  'h-11 w-full rounded-v2-2 border border-v2-edge bg-v2-paper px-3 text-v2-body text-v2-ink'
const labelClass = 'flex flex-col gap-1 text-v2-meta font-medium text-v2-ink'
const primaryButton =
  'v2-press rounded-v2-2 bg-v2-green px-4 py-2.5 text-v2-body font-semibold text-white disabled:opacity-60'
const smallButton =
  'v2-press rounded-v2-1 px-2 py-1 text-v2-caption font-semibold text-v2-green hover:underline'

export function ProV2ProfilePage() {
  const { t } = useTranslation()
  const scope = useProScope()
  const canManage = MANAGING_ROLES.has(scope.role)

  const readiness = useOrganizationReadiness(scope.organizationId)
  const listing = useOrganizationMarketplaceVisibility(scope.organizationId)
  const locations = useOrgLocations(scope.organizationId)
  const staffProfiles = useOrgStaffProfiles(scope.organizationId)
  const barbers = useOrgBarbers(scope.organizationId)

  useDocumentMeta({
    title: t('app:v2pro.profilePage.documentTitle'),
    description: t('app:v2pro.profilePage.documentDescription'),
    noIndex: true,
  })

  const location: Location | null =
    (locations.data ?? []).find((row) => row.id === scope.locationId) ??
    (locations.data ?? [])[0] ??
    null

  const ready = readiness.data ?? null

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-v2-lead font-semibold tracking-[-0.02em] text-v2-ink">
        {t('app:v2pro.nav.profile')}
      </h1>

      <SetupPlate
        canManage={canManage}
        location={location}
        barberId={(barbers.data ?? [])[0]?.id ?? null}
      />

      <ListingPlate canManage={canManage} />

      {canManage ? (
        <>
          {/* Mounted only once both sources resolved — the form seeds local
              state from props, so mounting early would freeze empty values. */}
          {listing.data && ready ? (
            <BusinessPlate
              key={`${listing.data.name}|${ready.businessType ?? ''}|${ready.currency ?? ''}`}
              currentName={listing.data.name}
              currentType={ready.businessType}
              currentCurrency={ready.currency ?? ''}
            />
          ) : null}
          {location ? <LocationPlate location={location} /> : null}
          <TeamPlate staff={staffProfiles.data ?? []} />
        </>
      ) : null}
    </div>
  )
}

/* ── Setup & publishing ─────────────────────────────────────────────────── */

function SetupPlate({
  canManage,
  location,
  barberId,
}: {
  canManage: boolean
  location: Location | null
  barberId: string | null
}) {
  const { t } = useTranslation()
  const scope = useProScope()
  const readiness = useOrganizationReadiness(scope.organizationId)
  const complete = useCompleteOnboarding(scope.organizationId)
  const starterServices = useApplyStarterServices(scope.organizationId)
  const weeklyHours = useApplyWeeklyHours(scope.organizationId)
  const ensureOwner = useEnsureOwnerProfessional(scope.organizationId)
  const [error, setError] = useState<string | null>(null)

  const ready = readiness.data ?? null
  const onError = (cause: unknown) => setError(getErrorMessage(cause) ?? null)

  if (readiness.isPending) {
    return (
      <section className="v2-plate p-4 md:p-5">
        <div className="v2-skeleton h-6 w-1/2 rounded-v2-1" />
      </section>
    )
  }
  if (!ready) return null

  const missing = ready.missingRequirements

  return (
    <section aria-labelledby="v2pro-setup" className="v2-plate overflow-hidden">
      <div className="flex items-baseline justify-between gap-3 px-4 py-3 md:px-5">
        <h2 id="v2pro-setup" className="text-v2-title font-semibold text-v2-ink">
          {t('app:v2pro.profilePage.setupTitle')}
        </h2>
        <p
          className={`text-v2-meta font-semibold ${ready.isPublished ? 'text-v2-green' : 'text-v2-ink-soft'}`}
        >
          {ready.isPublished
            ? t('app:v2pro.profilePage.published')
            : t('app:v2pro.profilePage.notPublished')}
        </p>
      </div>

      {missing.length > 0 ? (
        <ul className="border-t border-v2-hairline px-4 py-3 md:px-5">
          {missing.map((requirement) => (
            <li key={requirement} className="flex items-center gap-2 py-1 text-v2-meta text-v2-ink">
              <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-v2-alert" />
              {t(`app:v2pro.profilePage.requirement.${requirement}`)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-t border-v2-hairline px-4 py-3 text-v2-meta text-v2-green md:px-5">
          {t('app:v2pro.profilePage.allSet')}
        </p>
      )}

      {canManage ? (
        <div className="flex flex-wrap gap-2 border-t border-v2-hairline px-4 py-3 md:px-5">
          {!ready.hasProfessional && location ? (
            <button
              type="button"
              disabled={ensureOwner.isPending}
              onClick={() =>
                ensureOwner.mutate(
                  { organizationId: scope.organizationId, locationId: location.id },
                  { onError },
                )
              }
              className={primaryButton}
            >
              {t('app:v2pro.profilePage.makeMeBookable')}
            </button>
          ) : null}

          {!ready.hasService && location ? (
            <button
              type="button"
              disabled={starterServices.isPending}
              onClick={() =>
                starterServices.mutate(
                  {
                    organizationId: scope.organizationId,
                    locationId: location.id,
                    barberId,
                    services: templateFor(ready.businessType)
                      .filter((service) => service.recommended)
                      .map((service) => ({
                        name: t(`onboarding:services.templates.${service.id}`),
                        durationMinutes: service.durationMinutes,
                        priceCents: service.priceCents,
                      })),
                  },
                  { onError },
                )
              }
              className={primaryButton}
            >
              {t('app:v2pro.profilePage.addStarterServices')}
            </button>
          ) : null}

          {(!ready.hasLocationHours || !ready.hasProfessionalHours) && location ? (
            <button
              type="button"
              disabled={weeklyHours.isPending}
              onClick={() => {
                if (!ready.hasLocationHours) {
                  weeklyHours.mutate(
                    { organizationId: scope.organizationId, locationId: location.id, days: DEFAULT_WEEK },
                    { onError },
                  )
                }
                if (!ready.hasProfessionalHours && barberId) {
                  weeklyHours.mutate(
                    { organizationId: scope.organizationId, barberId, days: DEFAULT_WEEK },
                    { onError },
                  )
                }
              }}
              className={primaryButton}
            >
              {t('app:v2pro.profilePage.applyDefaultHours')}
            </button>
          ) : null}

          {ready.readyToPublish && !ready.isPublished ? (
            <button
              type="button"
              disabled={complete.isPending}
              onClick={() =>
                complete.mutate({ organizationId: scope.organizationId, publish: true }, { onError })
              }
              className={primaryButton}
            >
              {t('app:v2pro.profilePage.publish')}
            </button>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="border-t border-v2-hairline px-4 py-2.5 text-v2-meta text-v2-alert md:px-5">
          {error}
        </p>
      ) : null}
    </section>
  )
}

/* ── Public listing ─────────────────────────────────────────────────────── */

function ListingPlate({ canManage }: { canManage: boolean }) {
  const { t } = useTranslation()
  const scope = useProScope()
  const listing = useOrganizationMarketplaceVisibility(scope.organizationId)
  const setVisibility = useSetMarketplaceVisibility(scope.organizationId)

  if (!listing.data) return null
  const { marketplaceVisible, slug } = listing.data

  return (
    <section aria-labelledby="v2pro-listing" className="v2-plate p-4 md:p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id="v2pro-listing" className="text-v2-title font-semibold text-v2-ink">
            {t('app:v2pro.profilePage.listingTitle')}
          </h2>
          <p className="mt-0.5 truncate text-v2-meta text-v2-ink-soft" dir="ltr">
            /s/{slug}
          </p>
          <p className="mt-1 text-v2-meta text-v2-ink-soft">
            {marketplaceVisible
              ? t('app:v2pro.profilePage.listingOn')
              : t('app:v2pro.profilePage.listingOff')}
          </p>
        </div>
        {canManage ? (
          <button
            type="button"
            role="switch"
            aria-checked={marketplaceVisible}
            disabled={setVisibility.isPending}
            onClick={() => setVisibility.mutate(!marketplaceVisible)}
            className={`v2-press relative h-7 w-12 shrink-0 rounded-full transition-colors ${
              marketplaceVisible ? 'bg-v2-green' : 'bg-v2-fill'
            }`}
          >
            <span className="sr-only">{t('app:v2pro.profilePage.listingToggle')}</span>
            <span
              aria-hidden="true"
              className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${
                marketplaceVisible ? 'start-6' : 'start-1'
              }`}
            />
          </button>
        ) : null}
      </div>
    </section>
  )
}

/* ── Business profile ───────────────────────────────────────────────────── */

function BusinessPlate({
  currentName,
  currentType,
  currentCurrency,
}: {
  currentName: string
  currentType: BusinessType | null
  currentCurrency: string
}) {
  const { t } = useTranslation()
  const scope = useProScope()
  const save = useSaveBusinessProfile(scope.organizationId)
  const [name, setName] = useState(currentName)
  const [businessType, setBusinessType] = useState<BusinessType | ''>(currentType ?? '')
  const [currency, setCurrency] = useState(currentCurrency)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const dirty =
    name !== currentName || (businessType || null) !== currentType || currency !== currentCurrency

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setSaved(false)
    save.mutate(
      {
        organizationId: scope.organizationId,
        name: name.trim() || null,
        businessType: businessType || null,
        currency: currency.trim().toUpperCase() || null,
      },
      {
        onSuccess: () => setSaved(true),
        onError: (cause: unknown) => setError(getErrorMessage(cause) ?? null),
      },
    )
  }

  return (
    <section aria-labelledby="v2pro-business" className="v2-plate p-4 md:p-5">
      <h2 id="v2pro-business" className="text-v2-title font-semibold text-v2-ink">
        {t('app:v2pro.profilePage.businessTitle')}
      </h2>
      <form onSubmit={submit} className="mt-3 flex flex-col gap-3">
        <label className={labelClass}>
          {t('app:v2pro.profilePage.businessName')}
          <input value={name} onChange={(event) => setName(event.target.value)} className={inputClass} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className={labelClass}>
            {t('app:v2pro.profilePage.businessType')}
            <select
              value={businessType}
              onChange={(event) => setBusinessType(event.target.value as BusinessType | '')}
              className={inputClass}
            >
              <option value="">—</option>
              {BUSINESS_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`app:v2pro.profilePage.type.${type}`)}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            {t('app:v2pro.profilePage.currency')}
            <input
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
              maxLength={3}
              className={`${inputClass} uppercase`}
              dir="ltr"
            />
          </label>
        </div>
        {error ? <p className="text-v2-meta text-v2-alert">{error}</p> : null}
        {saved && !dirty ? (
          <p className="text-v2-meta text-v2-green">{t('app:v2pro.profilePage.saved')}</p>
        ) : null}
        <button type="submit" disabled={!dirty || save.isPending} className={`${primaryButton} self-start`}>
          {t('app:v2pro.profilePage.save')}
        </button>
      </form>
    </section>
  )
}

/* ── Location ───────────────────────────────────────────────────────────── */

function LocationPlate({ location }: { location: Location }) {
  const { t } = useTranslation()
  const update = useUpdateLocation()
  const [draft, setDraft] = useState({
    name: location.name,
    addressLine1: location.addressLine1 ?? '',
    city: location.city ?? '',
    postalCode: location.postalCode ?? '',
    country: location.country ?? '',
    timezone: location.timezone,
  })
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const timezones = useMemo(() => Intl.supportedValuesOf('timeZone'), [])

  const dirty =
    draft.name !== location.name ||
    draft.addressLine1 !== (location.addressLine1 ?? '') ||
    draft.city !== (location.city ?? '') ||
    draft.postalCode !== (location.postalCode ?? '') ||
    draft.country !== (location.country ?? '') ||
    draft.timezone !== location.timezone

  const field = (key: keyof typeof draft) => ({
    value: draft[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setDraft((current) => ({ ...current, [key]: event.target.value }))
    },
  })

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setSaved(false)
    update.mutate(
      {
        id: location.id,
        organizationId: location.organizationId,
        name: draft.name.trim(),
        addressLine1: draft.addressLine1.trim() || null,
        addressLine2: location.addressLine2,
        city: draft.city.trim() || null,
        region: location.region,
        postalCode: draft.postalCode.trim() || null,
        country: draft.country.trim() || null,
        timezone: draft.timezone,
        isActive: location.isActive,
      },
      {
        onSuccess: () => setSaved(true),
        onError: (cause: unknown) => setError(getErrorMessage(cause) ?? null),
      },
    )
  }

  return (
    <section aria-labelledby="v2pro-location" className="v2-plate p-4 md:p-5">
      <h2 id="v2pro-location" className="text-v2-title font-semibold text-v2-ink">
        {t('app:v2pro.profilePage.locationTitle')}
      </h2>
      <form onSubmit={submit} className="mt-3 flex flex-col gap-3">
        <label className={labelClass}>
          {t('app:v2pro.profilePage.locationName')}
          <input {...field('name')} className={inputClass} />
        </label>
        <label className={labelClass}>
          {t('app:v2pro.profilePage.address')}
          <input {...field('addressLine1')} className={inputClass} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className={labelClass}>
            {t('app:v2pro.profilePage.city')}
            <input {...field('city')} className={inputClass} />
          </label>
          <label className={labelClass}>
            {t('app:v2pro.profilePage.postalCode')}
            <input {...field('postalCode')} className={inputClass} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className={labelClass}>
            {t('app:v2pro.profilePage.country')}
            <input {...field('country')} maxLength={2} className={`${inputClass} uppercase`} dir="ltr" />
          </label>
          <label className={labelClass}>
            {t('app:v2pro.profilePage.timezone')}
            <select {...field('timezone')} className={inputClass}>
              {timezones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error ? <p className="text-v2-meta text-v2-alert">{error}</p> : null}
        {saved && !dirty ? (
          <p className="text-v2-meta text-v2-green">{t('app:v2pro.profilePage.saved')}</p>
        ) : null}
        <button type="submit" disabled={!dirty || update.isPending} className={`${primaryButton} self-start`}>
          {t('app:v2pro.profilePage.save')}
        </button>
      </form>
    </section>
  )
}

/* ── Team ───────────────────────────────────────────────────────────────── */

function TeamPlate({ staff }: { staff: StaffProfile[] }) {
  const { t } = useTranslation()
  const [editingId, setEditingId] = useState<string | null>(null)

  return (
    <section aria-labelledby="v2pro-team" className="v2-plate overflow-hidden">
      <h2 id="v2pro-team" className="px-4 py-3 text-v2-title font-semibold text-v2-ink md:px-5">
        {t('app:v2pro.profilePage.teamTitle')}
      </h2>
      {staff.length > 0 ? (
        <ul>
          {staff.map((member) =>
            editingId === member.id ? (
              <li key={member.id} className="border-t border-v2-hairline">
                <TeamMemberEditor member={member} onClose={() => setEditingId(null)} />
              </li>
            ) : (
              <li
                key={member.id}
                className="flex items-center gap-3 border-t border-v2-hairline px-4 py-2.5 md:px-5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-v2-body font-medium text-v2-ink">
                    <bdi>{member.displayName}</bdi>
                    {member.title ? (
                      <span className="text-v2-ink-soft"> · {member.title}</span>
                    ) : null}
                  </p>
                  <p className="text-v2-meta text-v2-ink-soft">
                    {member.isPublic
                      ? t('app:v2pro.profilePage.memberPublic')
                      : t('app:v2pro.profilePage.memberPrivate')}
                  </p>
                </div>
                <button type="button" onClick={() => setEditingId(member.id)} className={smallButton}>
                  {t('app:v2pro.profilePage.edit')}
                </button>
              </li>
            ),
          )}
        </ul>
      ) : (
        <p className="border-t border-v2-hairline px-4 py-4 text-v2-meta text-v2-ink-soft md:px-5">
          {t('app:v2pro.profilePage.teamEmpty')}
        </p>
      )}
    </section>
  )
}

function TeamMemberEditor({ member, onClose }: { member: StaffProfile; onClose: () => void }) {
  const { t } = useTranslation()
  const update = useUpdateStaffProfile()
  const [displayName, setDisplayName] = useState(member.displayName)
  const [title, setTitle] = useState(member.title ?? '')
  const [bio, setBio] = useState(member.bio ?? '')
  const [isPublic, setIsPublic] = useState(member.isPublic)
  const [error, setError] = useState<string | null>(null)

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    update.mutate(
      {
        id: member.id,
        organizationId: member.organizationId,
        displayName: displayName.trim(),
        title: title.trim() || null,
        bio: bio.trim() || null,
        locationId: member.locationId,
        avatarUrl: member.avatarUrl,
        isPublic,
      },
      {
        onSuccess: onClose,
        onError: (cause: unknown) => setError(getErrorMessage(cause) ?? null),
      },
    )
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 px-4 py-4 md:px-5">
      <label className={labelClass}>
        {t('app:v2pro.profilePage.memberName')}
        <input
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        {t('app:v2pro.profilePage.memberRole')}
        <input value={title} onChange={(event) => setTitle(event.target.value)} className={inputClass} />
      </label>
      <label className={labelClass}>
        {t('app:v2pro.profilePage.memberBio')}
        <textarea
          value={bio}
          onChange={(event) => setBio(event.target.value)}
          rows={3}
          className="w-full rounded-v2-2 border border-v2-edge bg-v2-paper px-3 py-2 text-v2-body text-v2-ink"
        />
      </label>
      <label className="flex items-center gap-2 text-v2-meta font-medium text-v2-ink">
        <input
          type="checkbox"
          checked={isPublic}
          onChange={(event) => setIsPublic(event.target.checked)}
          className="h-4 w-4"
        />
        {t('app:v2pro.profilePage.memberPublicToggle')}
      </label>
      {error ? <p className="text-v2-meta text-v2-alert">{error}</p> : null}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={displayName.trim().length === 0 || update.isPending}
          className={primaryButton}
        >
          {t('app:v2pro.profilePage.save')}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="v2-press rounded-v2-2 px-4 py-2.5 text-v2-body font-semibold text-v2-ink-soft"
        >
          {t('app:v2pro.profilePage.cancel')}
        </button>
      </div>
    </form>
  )
}
