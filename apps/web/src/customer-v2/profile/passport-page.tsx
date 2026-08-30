import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import QRCode from 'qrcode'
import { useAuth } from '@/lib/auth-context'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { useOwnProfile } from '@/lib/queries/profile'
import { useMyCustomerProfile } from '@/lib/queries/customer-profile'
import {
  useCreatePassportShare,
  useMyPassport,
  useUpsertMyPassport,
  type Passport,
} from '@/lib/queries/passport'
import { Notice } from '@/customer-v2/ui/notice'
import { V2_ROUTES } from '@/customer-v2/routes'

/**
 * The Fade Passport — the customer's haircut, as a card a barber can read.
 *
 * ============================================================================
 * WHAT THIS PASSPORT ACTUALLY IS
 * ============================================================================
 *
 * The passport contract stores exactly one thing: how this customer likes
 * their hair cut — usual cut, fade type, side/top lengths, beard, notes. No
 * loyalty balance, no membership tier, no points: none of that exists in the
 * schema, and §32's rule is explicit that none of it may be invented. What
 * makes the card worth opening repeatedly is the SHARE: a QR that hands any
 * barber — including one not on FadeUp — an expiring read-only page of the
 * customer's preferences, via the existing `create_passport_share` token flow
 * and the existing `/passport/shared/:token` viewer.
 *
 * It is automatic and integrated: no "Get Fade Passport" funnel, no upsell —
 * the card exists the moment the customer does, and empty fields invite
 * filling rather than gate anything.
 */
export function CustomerV2PassportPage() {
  const { t } = useTranslation()
  const { user, loading } = useAuth()

  const passport = useMyPassport(user?.id)
  const upsert = useUpsertMyPassport()
  const createShare = useCreatePassportShare()
  const ownName = useOwnProfile(user?.id)
  const customerProfile = useMyCustomerProfile(user?.id)

  const [editing, setEditing] = useState(false)
  const [qr, setQr] = useState<{ url: string; dataUrl: string } | null>(null)

  useDocumentMeta({
    title: t('customer-app:v2.passport.documentTitle'),
    description: t('customer-app:v2.passport.documentDescription'),
    noIndex: true,
  })

  if (!loading && !user) {
    return (
      <div className="mx-auto max-w-[26rem]">
        <h1 className="mb-4 text-v2-lead font-semibold tracking-[-0.02em] text-v2-ink">
          {t('customer-app:v2.passport.title')}
        </h1>
        <Notice
          tone="empty"
          title={t('customer-app:v2.profilePage.signInTitle')}
          body={t('customer-app:v2.passport.signInBody')}
          actionLabel={null}
          onAction={null}
        />
        <Link
          to={`/login?redirect=${encodeURIComponent(`${V2_ROUTES.profile}/passport`)}`}
          className="v2-press mt-3 inline-flex h-11 w-full items-center justify-center rounded-v2-2 bg-v2-ink px-4 text-v2-meta font-semibold text-v2-paper hover:bg-v2-ink/90"
        >
          {t('customer-app:v2.appointments.signInAction')}
        </Link>
      </div>
    )
  }

  if (loading || !user) return <div className="min-h-64" />

  const data = passport.data ?? null
  const displayName = customerProfile.data?.displayName ?? ownName.data ?? user.email ?? ''

  const facts: Array<{ key: string; value: string | null }> = [
    { key: 'usualHaircut', value: data?.usualHaircut ?? null },
    { key: 'fadeType', value: data?.fadeType ?? null },
    { key: 'sideLength', value: data?.sideLength ?? null },
    { key: 'topLength', value: data?.topLength ?? null },
    { key: 'beardPreferences', value: data?.beardPreferences ?? null },
    { key: 'preferencesNotes', value: data?.preferencesNotes ?? null },
  ]
  const known = facts.filter((fact) => fact.value)

  const share = () => {
    createShare.mutate(
      { ttlHours: 168 },
      {
        onSuccess: async (result) => {
          const url = `${window.location.origin}/passport/shared/${result.token}`
          setQr({ url, dataUrl: await QRCode.toDataURL(url, { width: 256, margin: 1 }) })
        },
      },
    )
  }

  return (
    <div className="mx-auto flex max-w-[26rem] flex-col gap-4">
      <h1 className="text-v2-lead font-semibold tracking-[-0.02em] text-v2-ink">
        {t('customer-app:v2.passport.title')}
      </h1>

      {/* ── The card ─────────────────────────────────────────────────────── */}
      <section className="v2-plate overflow-hidden">
        <div className="bg-v2-green-tint px-5 py-4">
          <p className="text-v2-caption font-semibold uppercase tracking-[0.08em] text-v2-green-ink">
            FadeUp
          </p>
          <p className="mt-1 truncate text-v2-lead font-semibold text-v2-ink">
            <bdi>{displayName}</bdi>
          </p>
        </div>

        {known.length > 0 ? (
          <dl className="px-5 py-4">
            {known.map((fact) => (
              <div key={fact.key} className="flex items-baseline justify-between gap-4 py-1.5">
                <dt className="shrink-0 text-v2-meta text-v2-ink-soft">
                  {t(`customer-app:v2.passport.fields.${fact.key}`)}
                </dt>
                <dd className="min-w-0 truncate text-v2-body font-medium text-v2-ink">
                  {fact.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="px-5 py-4 text-v2-meta text-v2-ink-soft">
            {t('customer-app:v2.passport.emptyHint')}
          </p>
        )}

        <div className="border-t border-v2-hairline px-5 py-3">
          <button
            type="button"
            onClick={() => setEditing((current) => !current)}
            className="v2-press text-v2-meta font-semibold text-v2-green hover:underline"
          >
            {editing ? t('customer-app:v2.booking.done') : t('customer-app:v2.passport.edit')}
          </button>
        </div>
      </section>

      {editing ? (
        <PassportForm
          userId={user.id}
          passport={data}
          upsert={upsert}
          onSaved={() => setEditing(false)}
        />
      ) : null}

      {/* ── Share ────────────────────────────────────────────────────────── */}
      <section aria-labelledby="v2-passport-share" className="v2-plate p-5">
        <h2 id="v2-passport-share" className="text-v2-title font-semibold text-v2-ink">
          {t('customer-app:v2.passport.shareTitle')}
        </h2>
        <p className="mt-1 text-v2-meta text-v2-ink-soft">
          {t('customer-app:v2.passport.shareBody')}
        </p>

        {qr ? (
          <div className="mt-4 text-center">
            <img
              src={qr.dataUrl}
              alt={t('customer-app:v2.passport.qrAlt')}
              className="mx-auto h-40 w-40"
            />
            <p className="mt-2 break-all text-v2-caption text-v2-ink-mute">{qr.url}</p>
          </div>
        ) : (
          <button
            type="button"
            onClick={share}
            disabled={createShare.isPending}
            className="v2-press mt-4 inline-flex h-11 w-full items-center justify-center rounded-v2-2 bg-v2-green px-4 text-v2-meta font-semibold text-v2-paper hover:bg-v2-green-deep disabled:opacity-60"
          >
            {t('customer-app:v2.passport.createShare')}
          </button>
        )}

        {createShare.isError ? (
          <p role="alert" className="mt-3 text-v2-meta font-medium text-v2-alert">
            {t('customer-app:v2.discovery.errorTitle')}
          </p>
        ) : null}
      </section>
    </div>
  )
}

function PassportForm({
  userId,
  passport,
  upsert,
  onSaved,
}: {
  userId: string
  passport: Passport | null
  upsert: ReturnType<typeof useUpsertMyPassport>
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const [values, setValues] = useState({
    usualHaircut: passport?.usualHaircut ?? '',
    fadeType: passport?.fadeType ?? '',
    sideLength: passport?.sideLength ?? '',
    topLength: passport?.topLength ?? '',
    beardPreferences: passport?.beardPreferences ?? '',
    preferencesNotes: passport?.preferencesNotes ?? '',
  })

  const fields = Object.keys(values) as Array<keyof typeof values>

  return (
    <form
      className="v2-plate flex flex-col gap-3 p-5"
      onSubmit={(event) => {
        event.preventDefault()
        upsert.mutate(
          {
            userId,
            usualHaircut: values.usualHaircut.trim() || null,
            fadeType: values.fadeType.trim() || null,
            sideLength: values.sideLength.trim() || null,
            topLength: values.topLength.trim() || null,
            beardPreferences: values.beardPreferences.trim() || null,
            preferencesNotes: values.preferencesNotes.trim() || null,
          },
          { onSuccess: onSaved },
        )
      }}
    >
      {fields.map((field) => (
        <label key={field} className="flex flex-col gap-1.5">
          <span className="text-v2-meta font-medium text-v2-ink">
            {t(`customer-app:v2.passport.fields.${field}`)}
          </span>
          <input
            type="text"
            value={values[field]}
            onChange={(event) =>
              setValues((current) => ({ ...current, [field]: event.target.value }))
            }
            className="h-11 rounded-v2-2 border border-v2-edge bg-v2-paper px-3.5 text-v2-body text-v2-ink"
          />
        </label>
      ))}

      <button
        type="submit"
        disabled={upsert.isPending}
        className="v2-press inline-flex h-11 items-center justify-center rounded-v2-2 bg-v2-ink px-4 text-v2-meta font-semibold text-v2-paper hover:bg-v2-ink/90 disabled:opacity-60"
      >
        {t('customer-app:v2.passport.save')}
      </button>
    </form>
  )
}
