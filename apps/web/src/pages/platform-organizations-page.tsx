import { Link } from 'react-router-dom'
import { useAllOrganizations } from '@/lib/queries/platform'
import { Container } from '@/components/ui/container'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableStateRow } from '@/components/ui/table'
import { useTranslation } from 'react-i18next'

/** /platform/organizations — every FadeUp tenant, entry point to the tenant explorer (CLAUDE.md section 10). */
export function PlatformOrganizationsPage() {
  const { t } = useTranslation()
  const organizationsQuery = useAllOrganizations()

  return (
    <Container size="lg" className="py-8">
      <h1 className="text-xl font-semibold text-ink-950">{t('common:entity.organizations')}</h1>
      <p className="mt-1 text-sm text-ink-500">{t('platform:organizations.everyBarbershopTenantOnFadeup')}</p>

      <div className="mt-6">
        {organizationsQuery.isPending ? (
          <OrganizationsSkeleton />
        ) : organizationsQuery.isError ? (
          <ErrorState title={t('platform:organizations.couldntLoadOrganizations')} description={organizationsQuery.error.message} />
        ) : (
          <Table label={t('common:entity.organizations')}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('common:field.name')}</TableHead>
                <TableHead>{t('platform:organizations.slug')}</TableHead>
                <TableHead>{t('common:field.created')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {organizationsQuery.data.length === 0 ? (
                <TableStateRow colSpan={3}>
                  <EmptyState title={t('platform:organizations.noOrganizationsYet')} className="border-none" />
                </TableStateRow>
              ) : (
                organizationsQuery.data.map((organization) => (
                  <TableRow key={organization.id}>
                    <TableCell>
                      <Link
                        to={`/platform/organizations/${organization.id}`}
                        className="font-medium text-ink-950 underline-offset-2 hover:underline"
                      >
                        {organization.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-ink-500">{organization.slug}</TableCell>
                    <TableCell className="text-ink-500">
                      {new Date(organization.createdAt).toLocaleDateString()}
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

function OrganizationsSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-4" aria-hidden="true">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-3/4" />
    </div>
  )
}
