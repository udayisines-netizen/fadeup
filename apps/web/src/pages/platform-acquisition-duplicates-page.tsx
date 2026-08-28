import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useProspectDuplicates, useResolveProspectDuplicate, type ProspectDuplicatePair } from '@/lib/queries/acquisition/duplicates'
import { useProspectPrimaryLocationsByIds, useProspectsByIds } from '@/lib/queries/acquisition/prospects'
import { ProspectTypeBadge } from '@/components/acquisition/badges'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/components/ui/toast'
import { getErrorMessage } from '@/lib/get-error-message'
import { usePlatformRole } from '@/routes/require-platform-role'
import type { Prospect, ProspectLocation } from '@/lib/queries/acquisition/prospects'

const WRITE_ROLES = new Set(['platform_owner', 'platform_admin'])

/** /platform/acquisition/duplicates — prospect_duplicates candidate pairs, never auto-merged. Confirm/reject flips `status`; a trigger stamps the reviewer. */
export function PlatformAcquisitionDuplicatesPage() {
  const pendingQuery = useProspectDuplicates('pending')
  const resolvedQuery = useProspectDuplicates()

  const resolvedOnly = useMemo(
    () => (resolvedQuery.data ?? []).filter((pair) => pair.status !== 'pending'),
    [resolvedQuery.data],
  )

  return (
    <Tabs defaultValue="pending">
      <TabsList>
        <TabsTrigger value="pending">Pending review{pendingQuery.data ? ` (${pendingQuery.data.length})` : ''}</TabsTrigger>
        <TabsTrigger value="resolved">Resolved</TabsTrigger>
      </TabsList>
      <TabsContent value="pending">
        {pendingQuery.isPending ? (
          <DuplicatesSkeleton />
        ) : pendingQuery.isError ? (
          <ErrorState title="Couldn't load duplicate candidates" description={pendingQuery.error.message} />
        ) : pendingQuery.data.length === 0 ? (
          <EmptyState title="No pending duplicates" description="Nothing needs review right now." />
        ) : (
          <div className="flex flex-col gap-4">
            {pendingQuery.data.map((pair) => (
              <DuplicatePairCard key={pair.id} pair={pair} showActions />
            ))}
          </div>
        )}
      </TabsContent>
      <TabsContent value="resolved">
        {resolvedQuery.isPending ? (
          <DuplicatesSkeleton />
        ) : resolvedQuery.isError ? (
          <ErrorState title="Couldn't load resolved duplicates" description={resolvedQuery.error.message} />
        ) : resolvedOnly.length === 0 ? (
          <EmptyState title="No resolved duplicates yet" />
        ) : (
          <div className="flex flex-col gap-4">
            {resolvedOnly.map((pair) => (
              <DuplicatePairCard key={pair.id} pair={pair} showActions={false} />
            ))}
          </div>
        )}
      </TabsContent>
    </Tabs>
  )
}

function DuplicatePairCard({ pair, showActions }: { pair: ProspectDuplicatePair; showActions: boolean }) {
  const { toast } = useToast()
  const role = usePlatformRole()
  const canResolve = WRITE_ROLES.has(role)
  const resolve = useResolveProspectDuplicate()

  const ids = useMemo(() => [pair.prospectId, pair.duplicateOfProspectId], [pair.prospectId, pair.duplicateOfProspectId])
  const prospectsQuery = useProspectsByIds(ids)
  const locationsQuery = useProspectPrimaryLocationsByIds(ids)

  async function handleResolve(status: 'confirmed_duplicate' | 'confirmed_distinct') {
    try {
      await resolve.mutateAsync({ id: pair.id, status })
      toast({
        title: status === 'confirmed_duplicate' ? 'Marked as duplicate' : 'Marked as distinct businesses',
        variant: 'success',
      })
    } catch (error) {
      toast({ title: "Couldn't update duplicate candidate", description: getErrorMessage(error), variant: 'error' })
    }
  }

  const isLoading = prospectsQuery.isPending || locationsQuery.isPending

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium text-ink-950">{Math.round(pair.confidence * 100)}% confidence</span>
            <Badge variant="neutral">{pair.status.replace(/_/g, ' ')}</Badge>
          </div>
          <span className="text-xs text-ink-500">{new Date(pair.createdAt).toLocaleString()}</span>
        </div>

        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ProspectSummary prospect={prospectsQuery.data?.get(pair.prospectId)} location={locationsQuery.data?.get(pair.prospectId)} />
            <ProspectSummary
              prospect={prospectsQuery.data?.get(pair.duplicateOfProspectId)}
              location={locationsQuery.data?.get(pair.duplicateOfProspectId)}
            />
          </div>
        )}

        <p className="text-sm text-ink-500">
          <span className="font-medium text-ink-700">Why: </span>
          {pair.reason}
        </p>

        {showActions && canResolve ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="sm"
              isLoading={resolve.isPending && resolve.variables?.status === 'confirmed_duplicate' && resolve.variables.id === pair.id}
              onClick={() => void handleResolve('confirmed_duplicate')}
            >
              Confirm duplicate
            </Button>
            <Button
              variant="secondary"
              size="sm"
              isLoading={resolve.isPending && resolve.variables?.status === 'confirmed_distinct' && resolve.variables.id === pair.id}
              onClick={() => void handleResolve('confirmed_distinct')}
            >
              Not a duplicate
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function ProspectSummary({ prospect, location }: { prospect: Prospect | undefined; location: ProspectLocation | undefined }) {
  if (!prospect) {
    return <div className="rounded-md border border-dashed border-border p-3 text-sm text-ink-500">Prospect not found</div>
  }

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <Link
          to={`/platform/acquisition/prospects/${prospect.id}`}
          className="font-medium text-ink-950 underline-offset-2 hover:underline"
        >
          {prospect.canonicalName}
        </Link>
        <ProspectTypeBadge type={prospect.type} />
      </div>
      <p className="mt-1 text-sm text-ink-500">
        {[location?.city, location?.country ?? prospect.country].filter(Boolean).join(', ') || 'No location on file'}
      </p>
    </div>
  )
}

function DuplicatesSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  )
}
