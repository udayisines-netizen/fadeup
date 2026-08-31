/**
 * FadeUp V3 — Profile editor: building a public identity, not configuring
 * enterprise software.
 *
 * YOUR PUBLIC LISTING leads — the org's own row from the real public search
 * RPC rendered through the real V3 marketplace grammar, so the operator
 * sees exactly what customers see (or the honest unpublished state).
 * The setup checklist is `get_organization_readiness` verbatim; publishing
 * goes through `complete_onboarding` only; quick actions are the same RPCs
 * onboarding uses (starter services localized, default hours, make-me-
 * bookable). Section forms (business, location, team) follow, demoted
 * beneath the identity. Role gates mirror RLS: editors owner/manager.
 */
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useDocumentMeta } from '@/lib/use-document-meta'
import { getErrorMessage } from '@/lib/get-error-message'
import type { MembershipRole } from '@/lib/types'
import {
  useOrganizationReadiness,
  useCompleteOnboarding,
  useApplyStarterServices,
  useApplyWeeklyHours,
  useEnsureOwnerProfessional,
  useSaveBusinessProfile,
  BUSINESS_TYPES,
  type BusinessType,
} from '@/lib/queries/onboarding'
import {
  useOrganizationMarketplaceVisibility,
  useSetMarketplaceVisibility,
} from '@/lib/queries/organization-marketplace'
import { useOrgLocations, useUpdateLocation, type Location } from '@/lib/queries/locations'
import { useOrgStaffProfiles, useUpdateStaffProfile, type StaffProfile } from '@/lib/queries/staff-profiles'
import { useOrgBarbers } from '@/lib/queries/barbers'
import { useSearchPublicProfessionals } from '@/lib/queries/marketplace'
import { templateFor, DEFAULT_WEEK } from '@/lib/onboarding/templates'
import { ResultRow } from '@/customer-v3/ui/result-row'
import { useProV3Scope } from '@/pro-v3/shell/pro-v3-shell'

const MANAGING_ROLES = new Set<MembershipRole>(['owner', 'manager'])

export function ProV3ProfilePage() {
  const { t } = useTranslation('v3')
  const scope = useProV3Scope()
  const canManage = MANAGING_ROLES.has(scope.role)

  const readiness = useOrganizationReadiness(scope.organizationId)
  const listing = useOrganizationMarketplaceVisibility(scope.organizationId)
  const locations = useOrgLocations(scope.organizationId)
  const staffProfiles = useOrgStaffProfiles(scope.organizationId)
  const barbers = useOrgBarbers(scope.organizationId)

  useDocumentMeta({ title: t('pro.editor.metaTitle'), description: t('pro.editor.metaDescription'), noIndex: true })

  const location: Location | null =
    (locations.data ?? []).find((row) => row.id === scope.locationId) ??
    (locations.data ?? [])[0] ??
    null
  const ready = readiness.data ?? null

  return (
    <div style={{ display: 'grid', gap: '1rem', maxInlineSize: '52rem' }}>
      <div className="v3pro-head">
        <h1 className="v3-h1">{t('pro.nav.profile')}</h1>
      </div>

      <ListingMirror canManage={canManage} />

      <SetupPanel canManage={canManage} location={location} barberId={(barbers.data ?? [])[0]?.id ?? null} />

      {canManage ? (
        <>
          {listing.data && ready ? (
            <BusinessPanel
              key={`${listing.data.name}|${ready.businessType ?? ''}|${ready.currency ?? ''}`}
              currentName={listing.data.name}
              currentType={ready.businessType}
              currentCurrency={ready.currency ?? ''}
            />
          ) : null}
          {location ? <LocationPanel location={location} /> : null}
          <TeamPanel staff={staffProfiles.data ?? []} />
        </>
      ) : null}
    </div>
  )
}

/* ── Your public listing — the mirror ──────────────────────────────────── */

function ListingMirror({ canManage }: { canManage: boolean }) {
  const { t } = useTranslation('v3')
  const scope = useProV3Scope()
  const listing = useOrganizationMarketplaceVisibility(scope.organizationId)
  const setVisibility = useSetMarketplaceVisibility(scope.organizationId)

  /* The org's own public row, from the SAME anon search contract customers
     hit — the operator sees exactly what the marketplace serves, and an
     unpublished org truthfully finds nothing. */
  const mirror = useSearchPublicProfessionals(
    { query: listing.data?.name ?? null, entityType: 'shop', limit: 5 },
    {},
  )
  const ownRows = useMemo(
    () => (mirror.data ?? []).filter((row) => row.organizationId === scope.organizationId),
    [mirror.data, scope.organizationId],
  )

  if (!listing.data) return null
  const { marketplaceVisible, slug } = listing.data

  return (
    <section className="v3pro-panel" aria-labelledby="v3ed-listing">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', borderBlockEnd: '1px solid var(--v3-hairline)' }}>
        <h2 id="v3ed-listing" className="v3pro-panel-title" style={{ borderBlockEnd: 0 }}>
          {t('pro.editor.listingTitle')}
        </h2>
        {canManage ? (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', paddingInlineEnd: '1rem', fontSize: '0.8438rem', fontWeight: 600 }}>
            {t('pro.editor.visible')}
            <input
              type="checkbox"
              role="switch"
              style={{ inlineSize: 24, blockSize: 24 }}
              checked={marketplaceVisible}
              disabled={setVisibility.isPending}
              onChange={() => setVisibility.mutate(!marketplaceVisible)}
            />
          </label>
        ) : null}
      </div>

      {marketplaceVisible && ownRows.length > 0 ? (
        <div>
          {ownRows.map((row) => (
            <ResultRow key={row.locationId} result={row} currency={undefined} />
          ))}
        </div>
      ) : (
        <p className="v3pro-empty">
          {marketplaceVisible ? t('pro.editor.listingResolving') : t('pro.editor.listingHidden')}
        </p>
      )}

      <p className="v3-meta" style={{ padding: '0.5rem 1rem 0.75rem' }} dir="ltr">
        /s/{slug}
      </p>
    </section>
  )
}

/* ── Setup & publishing ─────────────────────────────────────────────────── */

function SetupPanel({
  canManage,
  location,
  barberId,
}: {
  canManage: boolean
  location: Location | null
  barberId: string | null
}) {
  const { t } = useTranslation('v3')
  const scope = useProV3Scope()
  const readiness = useOrganizationReadiness(scope.organizationId)
  const complete = useCompleteOnboarding(scope.organizationId)
  const starterServices = useApplyStarterServices(scope.organizationId)
  const weeklyHours = useApplyWeeklyHours(scope.organizationId)
  const ensureOwner = useEnsureOwnerProfessional(scope.organizationId)
  const [error, setError] = useState<string | null>(null)

  const ready = readiness.data ?? null
  const onError = (cause: unknown) => setError(getErrorMessage(cause) ?? null)

  if (readiness.isPending) {
    return <div className="v3-skeleton" style={{ blockSize: '4rem' }} aria-hidden="true" />
  }
  if (!ready) return null

  const missing = ready.missingRequirements

  return (
    <section className="v3pro-panel" aria-labelledby="v3ed-setup">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBlockEnd: '1px solid var(--v3-hairline)' }}>
        <h2 id="v3ed-setup" className="v3pro-panel-title" style={{ borderBlockEnd: 0 }}>
          {t('pro.editor.setupTitle')}
        </h2>
        <span
          className="v3-label"
          style={{
            paddingInlineEnd: '1rem',
            color: ready.isPublished ? 'var(--v3-green-ink)' : 'var(--v3-ink-mute)',
            fontWeight: 700,
          }}
        >
          {ready.isPublished ? t('pro.editor.published') : t('pro.editor.notPublished')}
        </span>
      </div>

      {missing.length > 0 ? (
        <ul style={{ padding: '0.625rem 1rem', display: 'grid', gap: '0.375rem' }}>
          {missing.map((requirement) => (
            <li key={requirement} style={{ listStyle: 'none', display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.875rem' }}>
              <span aria-hidden="true" style={{ inlineSize: 6, blockSize: 6, borderRadius: 999, background: 'var(--v3-alert)', flexShrink: 0 }} />
              {t(`pro.editor.requirement.${requirement}`)}
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ padding: '0.625rem 1rem', fontSize: '0.875rem', color: 'var(--v3-green-ink)', fontWeight: 600 }}>
          {t('pro.editor.allSet')}
        </p>
      )}

      {canManage ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', padding: '0.625rem 1rem 0.875rem', borderBlockStart: '1px solid var(--v3-hairline)' }}>
          {!ready.hasProfessional && location ? (
            <button
              type="button"
              className="v3-btn v3-btn--quiet v3-press"
              disabled={ensureOwner.isPending}
              onClick={() =>
                ensureOwner.mutate({ organizationId: scope.organizationId, locationId: location.id }, { onError })
              }
            >
              {t('pro.editor.makeMeBookable')}
            </button>
          ) : null}
          {!ready.hasService && location ? (
            <button
              type="button"
              className="v3-btn v3-btn--quiet v3-press"
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
            >
              {t('pro.editor.addStarterServices')}
            </button>
          ) : null}
          {(!ready.hasLocationHours || !ready.hasProfessionalHours) && location ? (
            <button
              type="button"
              className="v3-btn v3-btn--quiet v3-press"
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
            >
              {t('pro.editor.applyDefaultHours')}
            </button>
          ) : null}
          {ready.readyToPublish && !ready.isPublished ? (
            <button
              type="button"
              className="v3-btn v3-btn--book v3-press"
              disabled={complete.isPending}
              onClick={() =>
                complete.mutate({ organizationId: scope.organizationId, publish: true }, { onError })
              }
            >
              {t('pro.editor.publish')}
            </button>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="v3a-error" style={{ margin: '0 1rem 0.875rem' }}>
          {error}
        </p>
      ) : null}
    </section>
  )
}

/* ── Section forms ──────────────────────────────────────────────────────── */

const fieldStyle = {
  minBlockSize: 48,
  borderRadius: 'var(--v3-radius-m)',
  border: '1px solid var(--v3-hairline)',
  font: 'inherit',
  paddingInline: '0.75rem',
} as const

function BusinessPanel({
  currentName,
  currentType,
  currentCurrency,
}: {
  currentName: string
  currentType: BusinessType | null
  currentCurrency: string
}) {
  const { t } = useTranslation('v3')
  const scope = useProV3Scope()
  const save = useSaveBusinessProfile(scope.organizationId)
  const [name, setName] = useState(currentName)
  const [businessType, setBusinessType] = useState<BusinessType | ''>(currentType ?? '')
  const [currency, setCurrency] = useState(currentCurrency)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const dirty =
    name !== currentName || (businessType || null) !== currentType || currency !== currentCurrency

  return (
    <section className="v3pro-panel" aria-labelledby="v3ed-business">
      <h2 id="v3ed-business" className="v3pro-panel-title">
        {t('pro.editor.businessTitle')}
      </h2>
      <form
        className="v3b-form"
        style={{ borderBlockStart: 0 }}
        onSubmit={(event) => {
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
        }}
      >
        <label className="v3b-field">
          <span>{t('pro.editor.businessName')}</span>
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '0.75rem' }}>
          <label className="v3b-field">
            <span>{t('pro.editor.businessType')}</span>
            <select
              value={businessType}
              onChange={(event) => setBusinessType(event.target.value as BusinessType | '')}
              style={fieldStyle}
            >
              <option value="">—</option>
              {BUSINESS_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`pro.editor.type.${type}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="v3b-field">
            <span>{t('pro.editor.currency')}</span>
            <input
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
              maxLength={3}
              style={{ textTransform: 'uppercase' }}
              dir="ltr"
            />
          </label>
        </div>
        {error ? <p className="v3a-error">{error}</p> : null}
        {saved && !dirty ? (
          <p style={{ fontSize: '0.875rem', color: 'var(--v3-green-ink)', fontWeight: 600 }}>{t('pro.editor.saved')}</p>
        ) : null}
        <button type="submit" className="v3-btn v3-btn--primary-ink v3-press" disabled={!dirty || save.isPending} style={{ justifySelf: 'start' }}>
          {t('pro.editor.save')}
        </button>
      </form>
    </section>
  )
}

function LocationPanel({ location }: { location: Location }) {
  const { t } = useTranslation('v3')
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

  const bind = (key: keyof typeof draft) => ({
    value: draft[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setDraft((current) => ({ ...current, [key]: event.target.value })),
  })

  return (
    <section className="v3pro-panel" aria-labelledby="v3ed-location">
      <h2 id="v3ed-location" className="v3pro-panel-title">
        {t('pro.editor.locationTitle')}
      </h2>
      <form
        className="v3b-form"
        style={{ borderBlockStart: 0 }}
        onSubmit={(event) => {
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
        }}
      >
        <label className="v3b-field">
          <span>{t('pro.editor.locationName')}</span>
          <input {...bind('name')} />
        </label>
        <label className="v3b-field">
          <span>{t('pro.editor.address')}</span>
          <input {...bind('addressLine1')} />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '0.75rem' }}>
          <label className="v3b-field">
            <span>{t('pro.editor.city')}</span>
            <input {...bind('city')} />
          </label>
          <label className="v3b-field">
            <span>{t('pro.editor.postalCode')}</span>
            <input {...bind('postalCode')} />
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '0.75rem' }}>
          <label className="v3b-field">
            <span>{t('pro.editor.country')}</span>
            <input {...bind('country')} maxLength={2} style={{ textTransform: 'uppercase' }} dir="ltr" />
          </label>
          <label className="v3b-field">
            <span>{t('pro.editor.timezone')}</span>
            <select {...bind('timezone')} style={fieldStyle}>
              {timezones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error ? <p className="v3a-error">{error}</p> : null}
        {saved && !dirty ? (
          <p style={{ fontSize: '0.875rem', color: 'var(--v3-green-ink)', fontWeight: 600 }}>{t('pro.editor.saved')}</p>
        ) : null}
        <button type="submit" className="v3-btn v3-btn--primary-ink v3-press" disabled={!dirty || update.isPending} style={{ justifySelf: 'start' }}>
          {t('pro.editor.save')}
        </button>
      </form>
    </section>
  )
}

function TeamPanel({ staff }: { staff: StaffProfile[] }) {
  const { t } = useTranslation('v3')
  const [editingId, setEditingId] = useState<string | null>(null)

  return (
    <section className="v3pro-panel" aria-labelledby="v3ed-team">
      <h2 id="v3ed-team" className="v3pro-panel-title">
        {t('pro.editor.teamTitle')}
      </h2>
      {staff.length === 0 ? (
        <p className="v3pro-empty">{t('pro.editor.teamEmpty')}</p>
      ) : (
        staff.map((member) =>
          editingId === member.id ? (
            <TeamMemberEditor key={member.id} member={member} onClose={() => setEditingId(null)} />
          ) : (
            <div key={member.id} className="v3pro-row" style={{ gridTemplateColumns: '1fr auto' }}>
              <span style={{ minInlineSize: 0 }}>
                <span style={{ fontWeight: 600 }}>
                  <bdi>{member.displayName}</bdi>
                </span>
                {member.title ? <span style={{ color: 'var(--v3-ink-soft)' }}> · {member.title}</span> : null}
                <br />
                <span className="v3-meta">
                  {member.isPublic ? t('pro.editor.memberPublic') : t('pro.editor.memberPrivate')}
                </span>
              </span>
              <button
                type="button"
                className="v3-btn v3-btn--quiet v3-press"
                style={{ minBlockSize: 44, paddingInline: '0.75rem', fontSize: '0.8125rem' }}
                onClick={() => setEditingId(member.id)}
              >
                {t('pro.editor.edit')}
              </button>
            </div>
          ),
        )
      )}
    </section>
  )
}

function TeamMemberEditor({ member, onClose }: { member: StaffProfile; onClose: () => void }) {
  const { t } = useTranslation('v3')
  const update = useUpdateStaffProfile()
  const [displayName, setDisplayName] = useState(member.displayName)
  const [title, setTitle] = useState(member.title ?? '')
  const [bio, setBio] = useState(member.bio ?? '')
  const [isPublic, setIsPublic] = useState(member.isPublic)
  const [error, setError] = useState<string | null>(null)

  return (
    <form
      className="v3b-form"
      onSubmit={(event) => {
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
      }}
    >
      <label className="v3b-field">
        <span>{t('pro.editor.memberName')}</span>
        <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required />
      </label>
      <label className="v3b-field">
        <span>{t('pro.editor.memberRole')}</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label className="v3b-field">
        <span>{t('pro.editor.memberBio')}</span>
        <textarea
          value={bio}
          onChange={(event) => setBio(event.target.value)}
          rows={3}
          style={{ ...fieldStyle, paddingBlock: '0.625rem', resize: 'vertical' }}
        />
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', fontWeight: 600 }}>
        <input type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} />
        {t('pro.editor.memberPublicToggle')}
      </label>
      {error ? (
        <p role="alert" className="v3a-error">
          {error}
        </p>
      ) : null}
      <div style={{ display: 'flex', gap: '0.625rem' }}>
        <button type="submit" className="v3-btn v3-btn--primary-ink v3-press" disabled={displayName.trim().length === 0 || update.isPending}>
          {t('pro.editor.save')}
        </button>
        <button type="button" className="v3-btn v3-btn--quiet v3-press" onClick={onClose}>
          {t('pro.editor.cancel')}
        </button>
      </div>
    </form>
  )
}
