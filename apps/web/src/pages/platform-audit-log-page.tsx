import { usePlatformAuditLog } from '@/lib/queries/platform'
import { Container } from '@/components/ui/container'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableStateRow } from '@/components/ui/table'
import { useTranslation } from 'react-i18next'

const ACTION_LABELS: Record<string, string> = {
  platform_owner_bootstrap_claimed: 'Platform owner bootstrap claimed',
  platform_owner_bootstrap_token_reissued: 'Bootstrap token reissued',
  platform_invitation_created: 'Platform invitation created',
  platform_invitation_accepted: 'Platform invitation accepted',
  platform_invitation_revoked: 'Platform invitation revoked',
  platform_support_session_started: 'Support view started',
  platform_support_session_ended: 'Support view ended',
}

/** /platform/audit — platform_audit_log, most recent first. Read-only, platform_owner/platform_admin only (RLS). */
export function PlatformAuditLogPage() {
  const { t } = useTranslation()
  const auditQuery = usePlatformAuditLog()

  return (
    <Container size="lg" className="py-8">
      <h1 className="text-xl font-semibold text-ink-950">{t('platform:auditLog.auditLog')}</h1>
      <p className="mt-1 text-sm text-ink-500">{t('platform:auditLog.platformlevelSecurityEventsMostRecent')}</p>

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
              {auditQuery.data.length === 0 ? (
                <TableStateRow colSpan={4}>
                  <EmptyState title={t('platform:auditLog.noPlatformActivityYet')} className="border-none" />
                </TableStateRow>
              ) : (
                auditQuery.data.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap text-ink-500">
                      {new Date(entry.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-medium text-ink-950">
                      {ACTION_LABELS[entry.action] ?? entry.action}
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
