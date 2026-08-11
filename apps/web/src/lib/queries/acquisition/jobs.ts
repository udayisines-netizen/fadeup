import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'
import { ACTIVE_JOB_STATUSES, type ProspectJobSourceStatus, type ProspectJobStatus, type ProspectJobType } from './types'

export interface ProspectJob {
  id: string
  jobType: ProspectJobType
  status: ProspectJobStatus
  priority: number
  payload: Record<string, unknown>
  result: Record<string, unknown>
  attempts: number
  maxAttempts: number
  scheduledAt: string
  workerId: string | null
  startedAt: string | null
  completedAt: string | null
  failedAt: string | null
  lastError: string | null
  createdBy: string | null
  createdAt: string
}

interface ProspectJobRow {
  id: string
  job_type: string
  status: ProspectJobStatus
  priority: number
  payload: Record<string, unknown>
  result: Record<string, unknown>
  attempts: number
  max_attempts: number
  scheduled_at: string
  worker_id: string | null
  started_at: string | null
  completed_at: string | null
  failed_at: string | null
  last_error: string | null
  created_by: string | null
  created_at: string
}

function mapJob(row: ProspectJobRow): ProspectJob {
  return {
    id: row.id,
    jobType: row.job_type as ProspectJobType,
    status: row.status,
    priority: row.priority,
    payload: row.payload,
    result: row.result,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    scheduledAt: row.scheduled_at,
    workerId: row.worker_id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    failedAt: row.failed_at,
    lastError: row.last_error,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }
}

const JOB_COLUMNS =
  'id, job_type, status, priority, payload, result, attempts, max_attempts, scheduled_at, worker_id, started_at, completed_at, failed_at, last_error, created_by, created_at'

export interface ProspectJobFilters {
  status?: ProspectJobStatus
}

/** Job queue history, most recent first. Readable by any platform role. */
export function useProspectJobs(filters: ProspectJobFilters = {}) {
  return useQuery({
    queryKey: ['acquisition', 'jobs', filters],
    queryFn: async (): Promise<ProspectJob[]> => {
      const supabase = getSupabaseClient()
      let query = supabase.from('prospect_jobs').select(JOB_COLUMNS).order('created_at', { ascending: false }).limit(200)
      if (filters.status) query = query.eq('status', filters.status)
      const { data, error } = await query
      if (error) throw error
      return ((data ?? []) as ProspectJobRow[]).map(mapJob)
    },
  })
}

/**
 * The most recently created jobs, polled while any of them are still in
 * flight — used by the Search page to show live-ish status right after
 * submitting a discovery job, without a dedicated realtime subscription.
 */
export function useRecentProspectJobs(limit = 10) {
  return useQuery({
    queryKey: ['acquisition', 'jobs', 'recent', limit],
    queryFn: async (): Promise<ProspectJob[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.from('prospect_jobs').select(JOB_COLUMNS).order('created_at', { ascending: false }).limit(limit)
      if (error) throw error
      return ((data ?? []) as ProspectJobRow[]).map(mapJob)
    },
    refetchInterval: (query) => {
      const jobs = query.state.data ?? []
      const hasActiveJob = jobs.some((job) => (ACTIVE_JOB_STATUSES as readonly ProspectJobStatus[]).includes(job.status))
      return hasActiveJob ? 4000 : false
    },
  })
}

export interface ProspectJobSource {
  id: string
  jobId: string
  sourceId: string
  sourceKey: string
  sourceDisplayName: string
  status: ProspectJobSourceStatus
  candidatesFound: number
  error: string | null
  startedAt: string | null
  completedAt: string | null
}

interface ProspectJobSourceRow {
  id: string
  job_id: string
  source_id: string
  status: ProspectJobSourceStatus
  candidates_found: number
  error: string | null
  started_at: string | null
  completed_at: string | null
}

interface SourceLookupRow {
  id: string
  key: string
  display_name: string
}

/** Per-source progress for one job — a failed source does not fail the whole job, see prospect_job_sources comment in the schema. */
export function useProspectJobSources(jobId: string | undefined) {
  return useQuery({
    queryKey: ['acquisition', 'job-sources', jobId],
    queryFn: async (): Promise<ProspectJobSource[]> => {
      const supabase = getSupabaseClient()
      const [jobSourcesRes, sourcesRes] = await Promise.all([
        supabase
          .from('prospect_job_sources')
          .select('id, job_id, source_id, status, candidates_found, error, started_at, completed_at')
          .eq('job_id', jobId),
        supabase.from('prospect_sources').select('id, key, display_name'),
      ])
      if (jobSourcesRes.error) throw jobSourcesRes.error
      if (sourcesRes.error) throw sourcesRes.error

      const sourceById = new Map<string, SourceLookupRow>()
      for (const row of (sourcesRes.data ?? []) as SourceLookupRow[]) sourceById.set(row.id, row)

      return ((jobSourcesRes.data ?? []) as ProspectJobSourceRow[]).map((row) => {
        const source = sourceById.get(row.source_id)
        return {
          id: row.id,
          jobId: row.job_id,
          sourceId: row.source_id,
          sourceKey: source?.key ?? 'unknown',
          sourceDisplayName: source?.display_name ?? 'Unknown source',
          status: row.status,
          candidatesFound: row.candidates_found,
          error: row.error,
          startedAt: row.started_at,
          completedAt: row.completed_at,
        }
      })
    },
    enabled: Boolean(jobId),
  })
}

export interface CreateDiscoveryJobInput {
  jobType: ProspectJobType
  payload: Record<string, unknown>
  sourceKeys: string[] | null
  priority?: number
}

/** The one client-facing way to enqueue prospect work. Platform owner/admin only — see create_prospect_discovery_job. */
export function useCreateProspectDiscoveryJob() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateDiscoveryJobInput) => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('create_prospect_discovery_job', {
        p_job_type: input.jobType,
        p_payload: input.payload,
        p_source_keys: input.sourceKeys,
        p_priority: input.priority ?? 100,
      })
      if (error) throw error
      return mapJob(data as ProspectJobRow)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'jobs'] })
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'overview'] })
    },
  })
}

/** Cancels a queued/retry/running job. Platform owner/admin only — see cancel_prospect_job. */
export function useCancelProspectJob() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('cancel_prospect_job', { p_id: id })
      if (error) throw error
      return mapJob(data as ProspectJobRow)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'jobs'] })
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'overview'] })
    },
  })
}

/** Recovers jobs whose worker lease expired without completion. Callable by any platform role; the Worker also does this on its own sweep. */
export function useRecoverStaleProspectJobLeases() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('recover_stale_prospect_job_leases')
      if (error) throw error
      return data as number
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['acquisition', 'jobs'] })
    },
  })
}
