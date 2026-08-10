import { Link } from 'react-router-dom'
import { useAllOrganizations } from '@/lib/queries/platform'
import { Container } from '@/components/ui/container'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableStateRow } from '@/components/ui/table'

/** /platform/organizations — every FadeUp tenant, entry point to the tenant explorer (CLAUDE.md section 10). */
export function PlatformOrganizationsPage() {
  const organizationsQuery = useAllOrganizations()

  return (
    <Container size="lg" className="py-8">
      <h1 className="text-xl font-semibold text-ink-950">Organizations</h1>
      <p className="mt-1 text-sm text-ink-500">Every barbershop tenant on FadeUp.</p>

      <div className="mt-6">
        {organizationsQuery.isPending ? (
          <OrganizationsSkeleton />
        ) : organizationsQuery.isError ? (
          <ErrorState title="Couldn't load organizations" description={organizationsQuery.error.message} />
        ) : (
          <Table label="Organizations">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {organizationsQuery.data.length === 0 ? (
                <TableStateRow colSpan={3}>
                  <EmptyState title="No organizations yet" className="border-none" />
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
