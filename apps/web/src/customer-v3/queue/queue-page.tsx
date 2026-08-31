/**
 * FadeUp V3 — Live Queue: the signature screen.
 *
 * A boarding-pass scene on the graphite spotlight (BG-05). The ticket shows
 * the REAL position and people ahead — never estimated minutes, which have
 * no contract and never will. There are ZERO join affordances here: joining
 * happens through QR + proximity at the shop, and the empty state says so
 * instead of pretending otherwise. Position changes roll with one restrained
 * spring; reduced motion collapses to opacity.
 */
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuth } from '@/lib/auth-context'
import { useMyQueueStatus, type MyQueueEntry } from '@/lib/queries/customer-app'
import { useDocumentMeta } from '@/lib/use-document-meta'

export function CustomerV3QueuePage() {
  const { t } = useTranslation('v3')
  useDocumentMeta({ title: t('queue.metaTitle'), description: t('queue.metaDescription'), noIndex: true })

  const { user, loading } = useAuth()
  const queue = useMyQueueStatus(Boolean(user))
  const entries = queue.data ?? []

  return (
    <div className="v3q-scene v3-bg-spotlight v3-on-dark v3-grain">
      <h1 className="v3-sr-only">{t('queue.metaTitle')}</h1>
      {!loading && !user ? (
        <div className="v3q-empty">
          <p className="v3-section-h" style={{ color: '#fff' }}>
            {t('queue.signedOutTitle')}
          </p>
          <p className="v3-meta">{t('queue.emptyBody')}</p>
          <Link to="/login" className="v3-btn v3-btn--on-dark v3-press">
            {t('landing.nav.signIn')}
          </Link>
        </div>
      ) : queue.isError ? (
        <p className="v3a-error" role="alert">
          {t('app.errors.load')}
        </p>
      ) : queue.isPending ? (
        <div className="v3q-ticket" aria-hidden="true">
          <div className="v3-skeleton" style={{ blockSize: '6rem', background: 'rgb(232 240 234 / 0.1)' }} />
        </div>
      ) : entries.length === 0 ? (
        <div className="v3q-empty">
          <p className="v3-section-h" style={{ color: '#fff' }}>
            {t('queue.emptyTitle')}
          </p>
          {/* The truth about joining: at the shop, by QR, in range. */}
          <p className="v3-meta">{t('queue.emptyBody')}</p>
        </div>
      ) : (
        entries.map((entry) => <QueueTicket key={entry.id} entry={entry} />)
      )}
    </div>
  )
}

function QueueTicket({ entry }: { entry: MyQueueEntry }) {
  const { t, i18n } = useTranslation('v3')
  const positionFormat = new Intl.NumberFormat(i18n.language, { minimumIntegerDigits: 2 })

  /* One vertical roll per REAL position change — nothing else animates. */
  const previous = useRef<number | null>(entry.queuePosition)
  const [rollKey, setRollKey] = useState(0)
  useEffect(() => {
    if (entry.queuePosition !== previous.current) {
      previous.current = entry.queuePosition
      setRollKey((k) => k + 1)
    }
  }, [entry.queuePosition])

  const ahead = entry.queuePosition != null ? Math.max(0, entry.queuePosition - 1) : null

  return (
    <article className="v3q-ticket" aria-label={t('queue.ticketLabel', { name: entry.locationName })}>
      {entry.status === 'waiting' && entry.queuePosition != null ? (
        <>
          <span className="v3-kicker">{t('landing.queue.positionLabel')}</span>
          <span key={rollKey} className="v3-num--display v3q-position v3q-roll">
            {positionFormat.format(entry.queuePosition)}
          </span>
          {entry.queuePosition === 1 ? (
            <span className="v3q-ahead">{t('queue.youAreNextSoon')}</span>
          ) : ahead != null ? (
            <span className="v3q-ahead">{t('landing.queue.ahead', { count: ahead })}</span>
          ) : null}
        </>
      ) : entry.status === 'called' ? (
        <span className="v3q-next v3q-roll">{t('queue.youAreNext')}</span>
      ) : (
        <span className="v3q-next">{t('queue.inService')}</span>
      )}

      <hr className="v3q-rule" />

      <div className="v3q-venue">
        <strong>
          <bdi>{entry.locationName}</bdi>
        </strong>
        {entry.barberDisplayName ? (
          <span>
            <bdi>{entry.barberDisplayName}</bdi>
          </span>
        ) : null}
      </div>
    </article>
  )
}
