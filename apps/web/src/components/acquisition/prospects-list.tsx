import { useDeferredValue, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useProspects } from '@/lib/queries/acquisition/prospects'
import { PipelineStageBadge, ProspectTypeBadge, ScoreBucketBadge } from '@/components/acquisition/badges'
import { TextField } from '@/components/ui/text-field'
import { SelectField } from '@/components/ui/select-field'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableStateRow } from '@/components/ui/table'
import {
  PROSPECT_PIPELINE_STAGES,
  PROSPECT_SCORE_BUCKETS,
  PROSPECT_TYPES,
  type ProspectPipelineStage,
  type ProspectScoreBucket,
  type ProspectType,
} from '@/lib/queries/acquisition/types'

/**
 * Shared filterable prospect table — the Prospects/Barbershops/Independent
 * Barbers pages are all this one component with a different (or no)
 * `presetType`, per the spec's "reuse the Prospects list component with a
 * prop, don't duplicate it." Initial `status` filter can come from the URL
 * (`?status=`) so Pipeline/Overview stage links land pre-filtered.
 */
export function ProspectsListView({ presetType }: { presetType?: ProspectType }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [type, setType] = useState<ProspectType | ''>(presetType ?? '')
  const [status, setStatus] = useState<ProspectPipelineStage | ''>((searchParams.get('status') as ProspectPipelineStage | null) ?? '')
  const [scoreBucket, setScoreBucket] = useState<ProspectScoreBucket | ''>('')
  const [country, setCountry] = useState('')

  const prospectsQuery = useProspects({
    search: deferredSearch || undefined,
    type: presetType ?? (type || undefined),
    status: status || undefined,
    scoreBucket: scoreBucket || undefined,
    country: country || undefined,
  })

  function handleStatusChange(value: string) {
    setStatus(value as ProspectPipelineStage | '')
    if (value) setSearchParams({ status: value })
    else setSearchParams({})
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <TextField label="Search" placeholder="Business name" value={search} onChange={(event) => setSearch(event.target.value)} />
        {!presetType ? (
          <SelectField
            label="Type"
            value={type}
            onChange={(event) => setType(event.target.value as ProspectType | '')}
            options={[{ value: '', label: 'All types' }, ...PROSPECT_TYPES.map((t) => ({ value: t, label: t }))]}
          />
        ) : null}
        <SelectField
          label="Pipeline stage"
          value={status}
          onChange={(event) => handleStatusChange(event.target.value)}
          options={[{ value: '', label: 'All stages' }, ...PROSPECT_PIPELINE_STAGES.map((s) => ({ value: s, label: s }))]}
        />
        <SelectField
          label="Score bucket"
          value={scoreBucket}
          onChange={(event) => setScoreBucket(event.target.value as ProspectScoreBucket | '')}
          options={[{ value: '', label: 'All buckets' }, ...PROSPECT_SCORE_BUCKETS.map((b) => ({ value: b, label: b }))]}
        />
        <TextField
          label="Country"
          placeholder="e.g. FR"
          value={country}
          onChange={(event) => setCountry(event.target.value)}
          maxLength={2}
        />
      </div>

      {prospectsQuery.isPending ? (
        <ProspectsSkeleton />
      ) : prospectsQuery.isError ? (
        <ErrorState title="Couldn't load prospects" description={prospectsQuery.error.message} />
      ) : prospectsQuery.data.length === 0 ? (
        <EmptyState title="No prospects match these filters" />
      ) : (
        <Table label="Prospects">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              {!presetType ? <TableHead>Type</TableHead> : null}
              <TableHead>Pipeline stage</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Country</TableHead>
              <TableHead>Discovered</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {prospectsQuery.data.length === 0 ? (
              <TableStateRow colSpan={presetType ? 5 : 6}>
                <EmptyState title="No matches" className="border-none" />
              </TableStateRow>
            ) : (
              prospectsQuery.data.map((prospect) => (
                <TableRow key={prospect.id}>
                  <TableCell>
                    <Link
                      to={`/platform/acquisition/prospects/${prospect.id}`}
                      className="font-medium text-ink-950 underline-offset-2 hover:underline"
                    >
                      {prospect.canonicalName}
                    </Link>
                    {prospect.doNotContact ? <span className="ml-2 text-xs text-danger-700">Do not contact</span> : null}
                  </TableCell>
                  {!presetType ? (
                    <TableCell>
                      <ProspectTypeBadge type={prospect.type} />
                    </TableCell>
                  ) : null}
                  <TableCell>
                    <PipelineStageBadge stage={prospect.status} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <ScoreBucketBadge bucket={prospect.currentScoreBucket} />
                      {prospect.currentScore != null ? <span className="text-ink-500">{prospect.currentScore}</span> : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-ink-500">{prospect.country}</TableCell>
                  <TableCell className="whitespace-nowrap text-ink-500">
                    {new Date(prospect.firstDiscoveredAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

function ProspectsSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-4" aria-hidden="true">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-3/4" />
    </div>
  )
}
