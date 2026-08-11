import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useEffect, useState } from 'react'
import { useProspectSources } from '@/lib/queries/acquisition/sources'
import { useCreateProspectDiscoveryJob, useRecentProspectJobs } from '@/lib/queries/acquisition/jobs'
import { JobStatusBadge } from '@/components/acquisition/badges'
import { TextField } from '@/components/ui/text-field'
import { SelectField } from '@/components/ui/select-field'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableStateRow } from '@/components/ui/table'
import { useToast } from '@/components/ui/toast'
import { getErrorMessage } from '@/lib/get-error-message'
import { usePlatformRole } from '@/routes/require-platform-role'
import type { ProspectSourceKey } from '@/lib/queries/acquisition/types'

const WRITE_ROLES = new Set(['platform_owner', 'platform_admin'])

function optionalNumberField(label: string) {
  return z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value === '' || !Number.isNaN(Number(value)), `${label} must be a number`)
}

const searchSchema = z.object({
  country: z
    .string()
    .trim()
    .min(2, 'Enter a 2-letter country code')
    .max(2, 'Enter a 2-letter country code')
    .transform((value) => value.toUpperCase()),
  city: z.string(),
  latitude: optionalNumberField('Latitude'),
  longitude: optionalNumberField('Longitude'),
  radiusKm: optionalNumberField('Radius'),
  entityType: z.enum(['barbershop', 'independent_barber', 'both']),
  keywords: z.string(),
  maxCandidates: optionalNumberField('Max candidates'),
  minQualificationScore: optionalNumberField('Minimum qualification score'),
})

type SearchFormValues = z.infer<typeof searchSchema>

const DEFAULT_VALUES: SearchFormValues = {
  country: 'FR',
  city: '',
  latitude: '',
  longitude: '',
  radiusKm: '10',
  entityType: 'both',
  keywords: '',
  maxCandidates: '50',
  minQualificationScore: '',
}

function toOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim()
  return trimmed === '' ? undefined : Number(trimmed)
}

/** /platform/acquisition/search — creates a `discovery` prospect_jobs row via create_prospect_discovery_job. Write action: platform_owner/platform_admin only. */
export function PlatformAcquisitionSearchPage() {
  const role = usePlatformRole()
  const canCreateJobs = WRITE_ROLES.has(role)
  const { toast } = useToast()

  const sourcesQuery = useProspectSources()
  const createJob = useCreateProspectDiscoveryJob()
  const recentJobsQuery = useRecentProspectJobs(10)

  const [selectedSources, setSelectedSources] = useState<Set<ProspectSourceKey>>(new Set())
  const [hasInitializedSources, setHasInitializedSources] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (hasInitializedSources || !sourcesQuery.data) return
    setSelectedSources(new Set(sourcesQuery.data.filter((source) => source.isEnabled).map((source) => source.key)))
    setHasInitializedSources(true)
  }, [sourcesQuery.data, hasInitializedSources])

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SearchFormValues>({
    resolver: zodResolver(searchSchema),
    defaultValues: DEFAULT_VALUES,
  })

  function toggleSource(key: ProspectSourceKey) {
    setSelectedSources((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function onSubmit(values: SearchFormValues) {
    setFormError(null)
    const entityTypes = values.entityType === 'both' ? ['barbershop', 'independent_barber'] : [values.entityType]
    const keywords = values.keywords
      .split(',')
      .map((keyword) => keyword.trim())
      .filter(Boolean)

    const payload = {
      country: values.country,
      city: values.city.trim() || null,
      latitude: toOptionalNumber(values.latitude) ?? null,
      longitude: toOptionalNumber(values.longitude) ?? null,
      radiusKm: toOptionalNumber(values.radiusKm) ?? null,
      entityTypes,
      keywords,
      maxCandidates: toOptionalNumber(values.maxCandidates) ?? null,
      minQualificationScore: toOptionalNumber(values.minQualificationScore) ?? null,
    }

    try {
      const job = await createJob.mutateAsync({
        jobType: 'discovery',
        payload,
        sourceKeys: [...selectedSources],
      })
      toast({ title: 'Discovery job created', description: `Job ${job.id.slice(0, 8)} queued.`, variant: 'success' })
    } catch (error) {
      setFormError(getErrorMessage(error) ?? 'Failed to create the discovery job.')
    }
  }

  if (!canCreateJobs) {
    return (
      <Alert variant="info">
        Only a Platform Owner or Platform Admin can create discovery jobs. Ask one of them, or browse existing prospects from the{' '}
        <Link to="/platform/acquisition/prospects" className="font-medium underline underline-offset-2">
          Prospects
        </Link>{' '}
        list.
      </Alert>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      <Card>
        <CardHeader>
          <CardTitle>New discovery search</CardTitle>
        </CardHeader>
        <CardContent>
          {sourcesQuery.isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : sourcesQuery.isError ? (
            <ErrorState title="Couldn't load sources" description={sourcesQuery.error.message} />
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
              {formError ? <Alert variant="error">{formError}</Alert> : null}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <TextField label="Country (ISO-2)" hint="e.g. FR" error={errors.country?.message} {...register('country')} />
                <TextField label="City (optional)" {...register('city')} />
                <SelectField
                  label="Entity type"
                  options={[
                    { value: 'both', label: 'Barbershops & independent barbers' },
                    { value: 'barbershop', label: 'Barbershops only' },
                    { value: 'independent_barber', label: 'Independent barbers only' },
                  ]}
                  {...register('entityType')}
                />
                <TextField label="Latitude (optional)" inputMode="decimal" error={errors.latitude?.message} {...register('latitude')} />
                <TextField label="Longitude (optional)" inputMode="decimal" error={errors.longitude?.message} {...register('longitude')} />
                <TextField label="Radius (km)" inputMode="decimal" error={errors.radiusKm?.message} {...register('radiusKm')} />
                <TextField label="Max candidates" inputMode="numeric" error={errors.maxCandidates?.message} {...register('maxCandidates')} />
                <TextField
                  label="Min qualification score (optional)"
                  hint="0-100, informational — not yet enforced by the Worker."
                  inputMode="numeric"
                  error={errors.minQualificationScore?.message}
                  {...register('minQualificationScore')}
                />
                <TextField label="Keywords (comma-separated, optional)" {...register('keywords')} />
              </div>

              <fieldset>
                <legend className="text-sm font-medium text-ink-950">Sources</legend>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {sourcesQuery.data.map((source) => (
                    <label
                      key={source.key}
                      className="flex items-start gap-2 rounded-md border border-border px-3 py-2 text-sm has-[:disabled]:opacity-50"
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 rounded border-border-strong text-accent-600"
                        checked={selectedSources.has(source.key)}
                        disabled={!source.isEnabled}
                        onChange={() => toggleSource(source.key)}
                      />
                      <span className="flex flex-col">
                        <span className="font-medium text-ink-950">{source.displayName}</span>
                        {!source.isEnabled ? <span className="text-xs text-ink-500">Disabled by an operator — see Sources</span> : null}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <Button type="submit" isLoading={isSubmitting || createJob.isPending} className="sm:self-start">
                Start discovery search
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Recent jobs</h2>
          <Link to="/platform/acquisition/jobs" className="text-sm font-medium text-accent-700 underline-offset-2 hover:underline">
            View all jobs
          </Link>
        </div>
        <div className="mt-3">
          {recentJobsQuery.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : recentJobsQuery.isError ? (
            <ErrorState title="Couldn't load recent jobs" description={recentJobsQuery.error.message} />
          ) : recentJobsQuery.data.length === 0 ? (
            <EmptyState title="No jobs yet" description="Jobs you create above will show up here." />
          ) : (
            <Table label="Recent jobs">
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentJobsQuery.data.length === 0 ? (
                  <TableStateRow colSpan={4}>
                    <EmptyState title="No jobs yet" className="border-none" />
                  </TableStateRow>
                ) : (
                  recentJobsQuery.data.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell className="font-medium text-ink-950">{job.jobType}</TableCell>
                      <TableCell>
                        <JobStatusBadge status={job.status} />
                      </TableCell>
                      <TableCell className="text-ink-500">
                        {job.attempts}/{job.maxAttempts}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-ink-500">{new Date(job.createdAt).toLocaleString()}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </section>
    </div>
  )
}
