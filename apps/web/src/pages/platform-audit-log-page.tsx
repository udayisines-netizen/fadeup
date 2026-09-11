import { useMemo, useState } from 'react'
import { usePlatformAuditLog } from '@/lib/queries/platform'
import { usePlatformPermissions } from '@/routes/require-platform-role'
import { SelectField } from '@/components/ui/select-field'
import { TextField } from '@/components/ui/text-field'
import { Container } from '@/components/ui/container'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableStateRow } from '@/components/ui/table'
import { useTranslation } from 'react-i18next'

/**
 * Les actions que PLAT-1 exige de tracer, plus celles qui existaient déjà.
 * Une action inconnue s'affiche telle quelle plutôt que de disparaître : un
 * journal qui cache ce qu'il ne sait pas nommer ne vaut rien.
 */
const ACTION_KEYS = [
  'platform_owner_bootstrap_claimed',
  'platform_owner_bootstrap_token_reissued',
  'platform_invitation_created',
  'platform_invitation_accepted',
  'platform_invitation_revoked',
  'platform_support_session_started',
  'platform_support_session_ended',
  'platform_member_granted',
  'platform_member_role_changed',
  'platform_member_revoked',
  'platform_member_zones_set',
  'platform_zone_created',
  'field_prospect_captured',
  'external_professional_published',
  'external_professional_withdrawn',
  'marketplace_withdrawal_requested',
  'marketplace_withdrawal_completed',
  'professional_application_submitted',
  'professional_application_approved',
  'professional_application_rejected',
  'professional_claim_approved',
  'professional_claim_rejected',
  'review_moderated',
  'review_report_resolved',
  'post_moderated',
  'appointment_cancelled_by_platform',
  'barber_deleted_by_platform',
] as const

/** /platform/audit — platform_audit_log, most recent first. Read-only, platform_owner/platform_admin only (RLS). */
export function PlatformAuditLogPage() {
  const { t } = useTranslation()
  const { can } = usePlatformPermissions()
  const auditQuery = usePlatformAuditLog()
  const [action, setAction] = useState('')
  const [search, setSearch] = useState('')

  /*
   * Le journal est lu par le fondateur et les admins SEULEMENT — sinon le
   * support et les modérateurs verraient les actions les uns des autres. La
   * garde qui compte est la policy platform_audit_log_select ; ce qui suit
   * évite seulement de rendre une page vide à qui n'a rien à y voir.
   */
  // Référence stable : `auditQuery.data ?? []` fabriquerait un tableau neuf à
  // chaque rendu et referait les deux mémos pour rien.
  const entries = useMemo(() => auditQuery.data ?? [], [auditQuery.data])
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return entries.filter((entry) => {
      if (action && entry.action !== action) return false
      if (!needle) return true
      return (
        entry.action.toLowerCase().includes(needle) ||
        (entry.actorUserId ?? '').toLowerCase().includes(needle) ||
        (entry.targetType ?? '').toLowerCase().includes(needle) ||
        (entry.targetId ?? '').toLowerCase().includes(needle)
      )
    })
  }, [entries, action, search])

  const presentActions = useMemo(
    () => [...new Set(entries.map((entry) => entry.action))].sort(),
    [entries],
  )

  if (!can('audit.read')) {
    return (
      <Container size="lg" className="py-8">
        <h1 className="text-xl font-semibold text-ink-950">{t('platform:auditLog.auditLog')}</h1>
        <EmptyState className="mt-6" title={t('platform:auditLog.reservedToFounderAndAdmins')} />
      </Container>
    )
  }

  return (
    <Container size="lg" className="py-8">
      <h1 className="text-xl font-semibold text-ink-950">{t('platform:auditLog.auditLog')}</h1>
      <p className="mt-1 text-sm text-ink-500">{t('platform:auditLog.platformlevelSecurityEventsMostRecent')}</p>

      <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="sm:w-72">
          <SelectField
            label={t('platform:auditLog.filterByAction')}
            value={action}
            onChange={(event) => setAction(event.target.value)}
            options={[
              { value: '', label: t('platform:auditLog.allActions') },
              ...presentActions.map((value) => ({ value, label: actionLabel(t, value) })),
            ]}
          />
        </div>
        <div className="flex-1">
          <TextField
            label={t('platform:auditLog.search')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
      </div>

      <div className="mt-6">
        {auditQuery.isPending ? (
          <AuditSkeleton />
        ) : auditQuery.isError ? (
          <ErrorState title={t('platform:auditLog.couldntLoadAuditLog')} description={auditQuery.error.message} />
        ) : (
          <Table label={t('platform:auditLog.auditLog')}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('common:field.when')}</TableHead>
                <TableHead>{t('platform:auditLog.action')}</TableHead>
                <TableHead>{t('platform:auditLog.actor')}</TableHead>
                <TableHead>{t('common:field.target')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableStateRow colSpan={4}>
                  <EmptyState title={t('platform:auditLog.noPlatformActivityYet')} className="border-none" />
                </TableStateRow>
              ) : (
                filtered.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap text-ink-500">
                      {new Date(entry.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-medium text-ink-950">
                      {actionLabel(t, entry.action)}
                    </TableCell>
                    <TableCell className="max-w-[12rem] truncate font-mono text-xs text-ink-500">
                      {entry.actorUserId ?? '—'}
                    </TableCell>
                    <TableCell className="max-w-[12rem] truncate font-mono text-xs text-ink-500">
                      {entry.targetType ? `${entry.targetType}: ${entry.targetId ?? '—'}` : '—'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </div>
    </Container>
  )
}

function AuditSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-4" aria-hidden="true">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-3/4" />
    </div>
  )
}

/** Le libellé traduit d'une action, ou la clé brute si le journal en porte une que l'interface ne connaît pas. */
function actionLabel(t: (key: string, options?: Record<string, unknown>) => string, action: string): string {
  if ((ACTION_KEYS as readonly string[]).includes(action)) {
    return t(`platform:auditActions.${action}`)
  }
  return action
}
