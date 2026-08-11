import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useCancelProspectJob, useProspectJobSources, useProspectJobs, type ProspectJob } from '@/lib/queries/acquisition/jobs'
import { JobSourceStatusBadge, JobStatusBadge } from '@/components/acquisition/badges'
import { Button } from '@/components/ui/button'
import { SelectField } from '@/components/ui/select-field'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableStateRow } from '@/components/ui/table'
import { useToast } from '@/components/ui/toast'
import { getErrorMessage } from '@/lib/get-error-message'
import { usePlatformRole } from '@/routes/require-platform-role'
import { PROSPECT_JOB_STATUSES, type ProspectJobStatus } from '@/lib/queries/acquisition/types'

const WRITE_ROLES = new Set(['platform_owner', 'platform_admin'])
const CANCELLABLE_STATUSES = new Set<ProspectJobStatus>(['queued', 'retry', 'running'])

/** /platform/acquisition/jobs — full prospect_jobs history, filterable by status, with per-job source progress and cancellation. */
export function PlatformAcquisitionJobsPage() {
  const role = usePlatformRole()
  const canCancel = WRITE_ROLES.has(role)
  const { toast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const statusFilter = (searchParams.get('status') as ProspectJobStatus | null) ?? undefined
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null)

  const jobsQuery = useProspectJobs({ status: statusFilter })
  const cancelJob = useCancelProspectJob()

  function handleStatusChange(value: string) {
    if (!value) {
      setSearchParams({})
    } else {
      setSearchParams({ status: value })
    }
  }

  async function handleCancel(job: ProspectJob) {
    try {
      await cancelJob.mutateAsync(job.id)
      toast({ title: 'Job cancelled', variant: 'success' })
    } catch (error) {
      toast({ title: "Couldn't cancel job", description: getErrorMessage(error), variant: 'error' })
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="sm:max-w-xs">
        <SelectField
          label="Status"
          value={statusFilter ?? ''}
          onChange={(event) => handleStatusChange(event.target.value)}
          options={[{ value: '', label: 'All statuses' }, ...PROSPECT_JOB_STATUSES.map((status) => ({ value: status, label: status }))]}
        />
      </div>

      {jobsQuery.isPending ? (
        <JobsSkeleton />
      ) : jobsQuery.isError ? (
        <ErrorState title="Couldn't load jobs" description={jobsQuery.error.message} />
      ) : jobsQuery.data.length === 0 ? (
        <EmptyState title="No jobs" description="No prospect jobs match this filter yet." />
      ) : (
        <Table label="Prospect jobs">
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Attempts</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Last error</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobsQuery.data.map((job) => (
              <JobRow
                key={job.id}
                job={job}
                canCancel={canCancel}
                isExpanded={expandedJobId === job.id}
                onToggleExpand={() => setExpandedJobId((current) => (current === job.id ? null : job.id))}
                onCancel={() => void handleCancel(job)}
                isCancelling={cancelJob.isPending && cancelJob.variables === job.id}
              />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

function JobRow({
  job,
  canCancel,
  isExpanded,
  onToggleExpand,
  onCancel,
  isCancelling,
}: {
  job: ProspectJob
  canCancel: boolean
  isExpanded: boolean
  onToggleExpand: () => void
  onCancel: () => void
  isCancelling: boolean
}) {
  const jobSourcesQuery = useProspectJobSources(isExpanded ? job.id : undefined)
  const isCancellable = CANCELLABLE_STATUSES.has(job.status)

  return (
    <>
      <TableRow>
        <TableCell className="font-medium text-ink-950">{job.jobType}</TableCell>
        <TableCell>
          <JobStatusBadge status={job.status} />
        </TableCell>
        <TableCell className="text-ink-500">{job.priority}</TableCell>
        <TableCell className="text-ink-500">
          {job.attempts}/{job.maxAttempts}
        </TableCell>
        <TableCell className="whitespace-nowrap text-ink-500">{new Date(job.createdAt).toLocaleString()}</TableCell>
        <TableCell className="max-w-[16rem] truncate text-danger-700">{job.lastError ?? '—'}</TableCell>
        <TableCell className="text-right">
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={onToggleExpand}>
              {isExpanded ? 'Hide sources' : 'Sources'}
            </Button>
            {canCancel ? (
              <Button variant="danger" size="sm" disabled={!isCancellable} isLoading={isCancelling} onClick={onCancel}>
                Cancel
              </Button>
            ) : null}
          </div>
        </TableCell>
      </TableRow>
      {isExpanded ? (
        <TableStateRow colSpan={7}>
          <div className="border-t border-border bg-paper-50 p-4">
            {jobSourcesQuery.isPending ? (
              <Skeleton className="h-16 w-full" />
            ) : jobSourcesQuery.isError ? (
              <ErrorState title="Couldn't load source progress" description={jobSourcesQuery.error.message} className="border-none py-4" />
            ) : jobSourcesQuery.data.length === 0 ? (
              <EmptyState title="No source progress recorded" className="border-none py-4" />
            ) : (
              <ul className="flex flex-col gap-2">
                {jobSourcesQuery.data.map((jobSource) => (
                  <li key={jobSource.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="font-medium text-ink-950">{jobSource.sourceDisplayName}</span>
                    <div className="flex items-center gap-3">
                      <JobSourceStatusBadge status={jobSource.status} />
                      <span className="text-ink-500">{jobSource.candidatesFound} candidates</span>
                      {jobSource.error ? <span className="max-w-[16rem] truncate text-danger-700">{jobSource.error}</span> : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </TableStateRow>
      ) : null}
    </>
  )
}

function JobsSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-4" aria-hidden="true">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-3/4" />
    </div>
  )
}
