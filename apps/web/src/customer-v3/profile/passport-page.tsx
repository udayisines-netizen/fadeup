/**
 * FadeUp V3 — Fade Passport: the signature object.
 *
 * A pass on the BG-06 reveal, never a form: real passport fields render as
 * pass rows (null rows collapse), the QR appears only when a REAL share
 * token exists (server-generated, TTL server-clamped, returned exactly
 * once), and editing opens a separate plain form under the scene. Tilt is
 * hover-only and dies under reduced motion.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import QRCode from 'qrcode'

import { useAuth } from '@/lib/auth-context'
import { useMyCustomerProfile } from '@/lib/queries/customer-profile'
import {
  useMyPassport,
  useUpsertMyPassport,
  useCreatePassportShare,
  type Passport,
} from '@/lib/queries/passport'
import { useDocumentMeta } from '@/lib/use-document-meta'

export function CustomerV3PassportPage() {
  const { t } = useTranslation('v3')
  useDocumentMeta({ title: t('passport.metaTitle'), description: t('passport.metaDescription'), noIndex: true })

  const { user, loading } = useAuth()
  const profile = useMyCustomerProfile(user?.id)
  const passport = useMyPassport(user?.id)
  const createShare = useCreatePassportShare()

  const [qr, setQr] = useState<{ url: string; dataUrl: string } | null>(null)
  const [editing, setEditing] = useState(false)

  if (!loading && !user) {
    return (
      <div className="v3a-empty">
        <p className="v3a-empty-title">{t('account.signedOutTitle')}</p>
        <a href="/login" className="v3-btn v3-btn--primary-ink v3-press">
          {t('landing.nav.signIn')}
        </a>
      </div>
    )
  }

  const displayName = profile.data?.displayName ?? user?.email ?? ''
  const pass = passport.data ?? null

  const rows: Array<{ key: string; label: string; value: string }> = pass
    ? [
        { key: 'usualHaircut', label: t('passport.fields.usualHaircut'), value: pass.usualHaircut ?? '' },
        { key: 'fadeType', label: t('passport.fields.fadeType'), value: pass.fadeType ?? '' },
        { key: 'sideLength', label: t('passport.fields.sideLength'), value: pass.sideLength ?? '' },
        { key: 'topLength', label: t('passport.fields.topLength'), value: pass.topLength ?? '' },
        { key: 'beardPreferences', label: t('passport.fields.beard'), value: pass.beardPreferences ?? '' },
        { key: 'preferencesNotes', label: t('passport.fields.notes'), value: pass.preferencesNotes ?? '' },
      ].filter((row) => row.value.trim() !== '')
    : []

  return (
    <div>
      <div className="v3pp-scene v3-bg-reveal v3-on-dark v3-grain">
        <article className="v3pp-pass" aria-label={t('landing.passport.cardLabel')}>
          <span className="v3pr-pass-mini-label">{t('landing.passport.cardLabel')}</span>
          <span className="v3pr-pass-mini-name" style={{ fontSize: '1.375rem' }}>
            <bdi>{displayName}</bdi>
          </span>
          {passport.isPending ? (
            <div className="v3-skeleton" style={{ blockSize: '3rem', background: 'rgb(232 240 234 / 0.1)' }} aria-hidden="true" />
          ) : rows.length > 0 ? (
            <dl className="v3pp-rows">
              {rows.map((row) => (
                <div key={row.key} className="v3pp-row">
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="v3-meta" style={{ color: 'var(--v3-on-graphite-dim)' }}>
              {t('passport.emptyBody')}
            </p>
          )}
          {qr ? (
            <span className="v3pp-qr">
              <img src={qr.dataUrl} alt={t('passport.qrAlt')} />
            </span>
          ) : null}
        </article>
      </div>

      <div className="v3pp-actions">
        <button
          type="button"
          className="v3-btn v3-btn--primary-ink v3-press"
          disabled={createShare.isPending}
          onClick={() => {
            createShare.mutate(
              {},
              {
                onSuccess: async ({ token }) => {
                  const url = `${window.location.origin}/passport/shared/${token}`
                  setQr({ url, dataUrl: await QRCode.toDataURL(url, { width: 264, margin: 1 }) })
                },
              },
            )
          }}
        >
          {createShare.isPending ? t('passport.sharing') : t('passport.share')}
        </button>
        {createShare.isError ? (
          <p role="alert" className="v3a-error">
            {t('app.errors.load')}
          </p>
        ) : null}
        {qr ? <p className="v3-meta">{t('passport.shareHint')}</p> : null}
        <button type="button" className="v3-btn v3-btn--quiet v3-press" onClick={() => setEditing((v) => !v)}>
          {editing ? t('passport.closeEdit') : t('passport.edit')}
        </button>
      </div>

      {editing && user ? <PassportForm userId={user.id} pass={pass} onSaved={() => setEditing(false)} /> : null}
    </div>
  )
}

function PassportForm({ userId, pass, onSaved }: { userId: string; pass: Passport | null; onSaved: () => void }) {
  const { t } = useTranslation('v3')
  const upsert = useUpsertMyPassport()

  const [usualHaircut, setUsualHaircut] = useState(pass?.usualHaircut ?? '')
  const [fadeType, setFadeType] = useState(pass?.fadeType ?? '')
  const [sideLength, setSideLength] = useState(pass?.sideLength ?? '')
  const [topLength, setTopLength] = useState(pass?.topLength ?? '')
  const [beard, setBeard] = useState(pass?.beardPreferences ?? '')
  const [notes, setNotes] = useState(pass?.preferencesNotes ?? '')

  const fields: Array<[string, string, (v: string) => void]> = [
    [t('passport.fields.usualHaircut'), usualHaircut, setUsualHaircut],
    [t('passport.fields.fadeType'), fadeType, setFadeType],
    [t('passport.fields.sideLength'), sideLength, setSideLength],
    [t('passport.fields.topLength'), topLength, setTopLength],
    [t('passport.fields.beard'), beard, setBeard],
    [t('passport.fields.notes'), notes, setNotes],
  ]

  return (
    <form
      className="v3pp-form"
      onSubmit={(event) => {
        event.preventDefault()
        upsert.mutate(
          {
            userId,
            usualHaircut: usualHaircut.trim() || null,
            fadeType: fadeType.trim() || null,
            sideLength: sideLength.trim() || null,
            topLength: topLength.trim() || null,
            beardPreferences: beard.trim() || null,
            preferencesNotes: notes.trim() || null,
          },
          { onSuccess: onSaved },
        )
      }}
    >
      {fields.map(([label, value, set]) => (
        <label key={label} className="v3b-field">
          <span>{label}</span>
          <input type="text" value={value} onChange={(event) => set(event.target.value)} />
        </label>
      ))}
      {upsert.isError ? (
        <p role="alert" className="v3a-error">
          {t('app.errors.load')}
        </p>
      ) : null}
      <button type="submit" className="v3-btn v3-btn--book v3-press" disabled={upsert.isPending}>
        {upsert.isPending ? t('passport.saving') : t('passport.save')}
      </button>
    </form>
  )
}
