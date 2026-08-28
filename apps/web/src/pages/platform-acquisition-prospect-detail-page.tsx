import { type ReactNode, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import {
  useAddProspectNote,
  useAddProspectOutreach,
  useAddProspectTag,
  useProspect,
  useProspectContacts,
  useProspectDuplicateCandidates,
  useProspectEvents,
  useProspectLocations,
  useProspectNotes,
  useProspectOutreach,
  useProspectScores,
  useProspectSocialProfiles,
  useProspectSourceRecords,
  useProspectTags,
  useProspectsByIds,
  useRemoveProspectTag,
  useSuppressProspect,
  useUpdateProspectStatus,
  type Prospect,
  type ProspectScoreEntry,
} from '@/lib/queries/acquisition/prospects'
import { PipelineStageBadge, ProspectTypeBadge, ScoreBucketBadge } from '@/components/acquisition/badges'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SelectField } from '@/components/ui/select-field'
import { TextField } from '@/components/ui/text-field'
import { Textarea } from '@/components/ui/textarea'
import { Container } from '@/components/ui/container'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { PageSpinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { getErrorMessage } from '@/lib/get-error-message'
import { usePlatformRole } from '@/routes/require-platform-role'
import {
  PROSPECT_OUTREACH_CHANNELS,
  PROSPECT_PIPELINE_STAGES,
  type ProspectOutreachChannel,
  type ProspectOutreachDirection,
  type ProspectPipelineStage,
} from '@/lib/queries/acquisition/types'

const WRITE_ROLES = new Set(['platform_owner', 'platform_admin'])

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
}

/**
 * /platform/acquisition/prospects/:prospectId — "Prospect 360": identity,
 * location, contacts, social, full source provenance ("Platform Owner must
 * clearly see where information came from" per the Worker V2 spec), score
 * breakdown, tags, duplicates, notes, timeline, outreach log, suppression.
 */
export function PlatformAcquisitionProspectDetailPage() {
  const { prospectId } = useParams<{ prospectId: string }>()
  const role = usePlatformRole()
  const canManage = WRITE_ROLES.has(role)
  const { toast } = useToast()

  const prospectQuery = useProspect(prospectId)
  const locationsQuery = useProspectLocations(prospectId)
  const contactsQuery = useProspectContacts(prospectId)
  const socialProfilesQuery = useProspectSocialProfiles(prospectId)
  const sourceRecordsQuery = useProspectSourceRecords(prospectId)
  const scoresQuery = useProspectScores(prospectId)
  const eventsQuery = useProspectEvents(prospectId)
  const tagsQuery = useProspectTags(prospectId)
  const duplicatesQuery = useProspectDuplicateCandidates(prospectId)
  const notesQuery = useProspectNotes(prospectId)
  const outreachQuery = useProspectOutreach(prospectId)

  const updateStatus = useUpdateProspectStatus()
  const [isSuppressOpen, setIsSuppressOpen] = useState(false)

  if (!prospectId) {
    return <Navigate to="/platform/acquisition/prospects" replace />
  }

  if (prospectQuery.isPending) {
    return <PageSpinner label="Loading prospect" />
  }

  if (prospectQuery.isError) {
    return (
      <Container size="lg" className="py-8">
        <ErrorState title="Couldn't load prospect" description={prospectQuery.error.message} />
      </Container>
    )
  }

  if (!prospectQuery.data) {
    return (
      <Container size="lg" className="py-8">
        <ErrorState title="Prospect not found" />
      </Container>
    )
  }

  const prospect = prospectQuery.data

  async function handleStatusChange(nextStatus: ProspectPipelineStage) {
    try {
      await updateStatus.mutateAsync({ id: prospect.id, status: nextStatus })
      toast({ title: 'Pipeline stage updated', variant: 'success' })
    } catch (error) {
      toast({ title: "Couldn't update pipeline stage", description: getErrorMessage(error), variant: 'error' })
    }
  }

  const latestScore = scoresQuery.data?.[0]

  return (
    <Container size="lg" className="py-8">
      <Link to="/platform/acquisition/prospects" className="text-sm text-ink-500 hover:text-ink-950">
        ← Prospects
      </Link>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-ink-950">{prospect.canonicalName}</h1>
            <ProspectTypeBadge type={prospect.type} />
            {prospect.doNotContact ? <Badge variant="danger">Do not contact</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-ink-500">
            {prospect.country} · Discovered {formatDateTime(prospect.firstDiscoveredAt)}
            {prospect.lastEnrichedAt ? ` · Last enriched ${formatDateTime(prospect.lastEnrichedAt)}` : ' · Not enriched yet'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canManage && !prospect.doNotContact ? (
            <Button variant="danger" size="sm" onClick={() => setIsSuppressOpen(true)}>
              Suppress this prospect
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mt-4 max-w-xs">
        {canManage ? (
          <SelectField
            label="Pipeline stage"
            value={prospect.status}
            disabled={updateStatus.isPending}
            onChange={(event) => void handleStatusChange(event.target.value as ProspectPipelineStage)}
            options={PROSPECT_PIPELINE_STAGES.map((stage) => ({ value: stage, label: stage }))}
          />
        ) : (
          <div>
            <p className="text-sm font-medium text-ink-950">Pipeline stage</p>
            <div className="mt-1.5">
              <PipelineStageBadge stage={prospect.status} />
            </div>
          </div>
        )}
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <IdentitySection prospect={prospect} />
          <LocationsSection query={locationsQuery} />
          <ContactsSection query={contactsQuery} />
          <SocialProfilesSection query={socialProfilesQuery} />
          <ProvenanceSection query={sourceRecordsQuery} />
          <ScoreSection latestScore={latestScore} history={scoresQuery.data ?? []} isLoading={scoresQuery.isPending} isError={scoresQuery.isError} />
          <DuplicatesSection prospectId={prospect.id} query={duplicatesQuery} />
          <EventsSection query={eventsQuery} />
        </div>
        <div className="flex flex-col gap-6">
          <TagsSection prospectId={prospect.id} query={tagsQuery} canManage={canManage} />
          <NotesSection prospectId={prospect.id} query={notesQuery} canManage={canManage} />
          <OutreachSection prospectId={prospect.id} query={outreachQuery} canManage={canManage} />
        </div>
      </div>

      {isSuppressOpen ? <SuppressDialog prospectId={prospect.id} onClose={() => setIsSuppressOpen(false)} /> : null}
    </Container>
  )
}

function IdentitySection({ prospect }: { prospect: Prospect }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Business identity</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Website">
          {prospect.websiteUrl ? (
            <a href={prospect.websiteUrl} target="_blank" rel="noreferrer" className="text-accent-700 underline underline-offset-2">
              {prospect.websiteDomain ?? prospect.websiteUrl}
            </a>
          ) : (
            '—'
          )}
        </Field>
        <Field label="Phone">{prospect.phoneE164 ?? '—'}</Field>
        <Field label="Email">{prospect.email ?? '—'}</Field>
        <Field label="Score">
          <div className="flex items-center gap-2">
            <ScoreBucketBadge bucket={prospect.currentScoreBucket} />
            {prospect.currentScore != null ? <span>{prospect.currentScore}/100</span> : null}
          </div>
        </Field>
      </CardContent>
    </Card>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
      <div className="mt-1 text-sm text-ink-950">{children}</div>
    </div>
  )
}

function LocationsSection({ query }: { query: ReturnType<typeof useProspectLocations> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Locations</CardTitle>
      </CardHeader>
      <CardContent>
        {query.isPending ? (
          <SkeletonLines />
        ) : query.isError ? (
          <ErrorState title="Couldn't load locations" description={query.error.message} className="border-none p-0 py-2" />
        ) : query.data.length === 0 ? (
          <EmptyState title="No locations on file" className="border-none p-0 py-2" />
        ) : (
          <ul className="flex flex-col gap-3">
            {query.data.map((location) => (
              <li key={location.id} className="rounded-md border border-border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-ink-950">
                    {[location.addressLine, location.postalCode, location.city].filter(Boolean).join(', ') || 'No address on file'}
                  </span>
                  {location.isPrimary ? <Badge variant="accent">Primary</Badge> : null}
                </div>
                <p className="mt-1 text-ink-500">
                  {[location.region, location.country].filter(Boolean).join(', ')}
                  {location.latitude != null && location.longitude != null ? ` · ${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function ContactsSection({ query }: { query: ReturnType<typeof useProspectContacts> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Contacts</CardTitle>
      </CardHeader>
      <CardContent>
        {query.isPending ? (
          <SkeletonLines />
        ) : query.isError ? (
          <ErrorState title="Couldn't load contacts" description={query.error.message} className="border-none p-0 py-2" />
        ) : query.data.length === 0 ? (
          <EmptyState title="No named contacts on file" className="border-none p-0 py-2" />
        ) : (
          <ul className="flex flex-col gap-3">
            {query.data.map((contact) => (
              <li key={contact.id} className="rounded-md border border-border p-3 text-sm">
                <p className="font-medium text-ink-950">{contact.fullName ?? 'Unnamed contact'}</p>
                {contact.roleTitle ? <p className="text-ink-500">{contact.roleTitle}</p> : null}
                <p className="mt-1 text-ink-700">{[contact.phoneE164, contact.email].filter(Boolean).join(' · ') || 'No contact details'}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function SocialProfilesSection({ query }: { query: ReturnType<typeof useProspectSocialProfiles> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Social profiles</CardTitle>
      </CardHeader>
      <CardContent>
        {query.isPending ? (
          <SkeletonLines />
        ) : query.isError ? (
          <ErrorState title="Couldn't load social profiles" description={query.error.message} className="border-none p-0 py-2" />
        ) : query.data.length === 0 ? (
          <EmptyState title="No social profiles on file" className="border-none p-0 py-2" />
        ) : (
          <ul className="flex flex-col gap-2">
            {query.data.map((profile) => (
              <li key={profile.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 text-sm">
                <div>
                  <span className="font-medium capitalize text-ink-950">{profile.platform}</span>{' '}
                  {profile.url ? (
                    <a href={profile.url} target="_blank" rel="noreferrer" className="text-accent-700 underline underline-offset-2">
                      {profile.handle ?? profile.url}
                    </a>
                  ) : (
                    <span className="text-ink-700">{profile.handle}</span>
                  )}
                </div>
                {profile.followerCount != null ? <span className="text-ink-500">{profile.followerCount.toLocaleString()} followers</span> : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function ProvenanceSection({ query }: { query: ReturnType<typeof useProspectSourceRecords> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Source provenance</CardTitle>
      </CardHeader>
      <CardContent>
        {query.isPending ? (
          <SkeletonLines />
        ) : query.isError ? (
          <ErrorState title="Couldn't load provenance" description={query.error.message} className="border-none p-0 py-2" />
        ) : query.data.length === 0 ? (
          <EmptyState title="No source records yet" className="border-none p-0 py-2" />
        ) : (
          <Table label="Source provenance">
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead>External ID</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead>Fetched</TableHead>
                <TableHead>
                  <span className="sr-only">Link</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.map((record) => (
                <TableRow key={record.id}>
                  <TableCell className="font-medium text-ink-950">{record.sourceDisplayName}</TableCell>
                  <TableCell className="max-w-[10rem] truncate font-mono text-xs text-ink-500">{record.externalId ?? '—'}</TableCell>
                  <TableCell className="text-ink-500">{record.confidence != null ? `${Math.round(record.confidence * 100)}%` : '—'}</TableCell>
                  <TableCell className="whitespace-nowrap text-ink-500">{formatDateTime(record.fetchedAt)}</TableCell>
                  <TableCell className="text-right">
                    {record.sourceUrl ? (
                      <a href={record.sourceUrl} target="_blank" rel="noreferrer" className="text-xs font-medium text-accent-700 underline underline-offset-2">
                        Open
                      </a>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

function ScoreSection({
  latestScore,
  history,
  isLoading,
  isError,
}: {
  latestScore: ProspectScoreEntry | undefined
  history: ProspectScoreEntry[]
  isLoading: boolean
  isError: boolean
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Score breakdown</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <SkeletonLines />
        ) : isError ? (
          <ErrorState title="Couldn't load score history" className="border-none p-0 py-2" />
        ) : !latestScore ? (
          <EmptyState title="Not scored yet" className="border-none p-0 py-2" />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <ScoreBucketBadge bucket={latestScore.bucket} />
              <span className="text-2xl font-semibold text-ink-950">{latestScore.score}</span>
              <span className="text-sm text-ink-500">/ 100 · scored {formatDateTime(latestScore.scoredAt)}</span>
            </div>
            {latestScore.factors.length === 0 ? (
              <p className="text-sm text-ink-500">No factor breakdown recorded for this score.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {latestScore.factors.map((factor, index) => (
                  <li key={`${factor.factor}-${index}`} className="rounded-md border border-border p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-ink-950">{factor.factor}</span>
                      <span className="text-ink-700">
                        {factor.points}/{factor.maxPoints}
                      </span>
                    </div>
                    {factor.explanation ? <p className="mt-1 text-ink-500">{factor.explanation}</p> : null}
                  </li>
                ))}
              </ul>
            )}
            {history.length > 1 ? (
              <details className="text-sm text-ink-500">
                <summary className="cursor-pointer font-medium text-ink-700">Score history ({history.length})</summary>
                <ul className="mt-2 flex flex-col gap-1">
                  {history.map((entry) => (
                    <li key={entry.id} className="flex items-center justify-between gap-2">
                      <span>{formatDateTime(entry.scoredAt)}</span>
                      <span>
                        {entry.score} ({entry.bucket})
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function DuplicatesSection({ prospectId, query }: { prospectId: string; query: ReturnType<typeof useProspectDuplicateCandidates> }) {
  const otherIds = (query.data ?? []).map((pair) => (pair.prospectId === prospectId ? pair.duplicateOfProspectId : pair.prospectId))
  const otherProspectsQuery = useProspectsByIds(otherIds)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Duplicate candidates</CardTitle>
      </CardHeader>
      <CardContent>
        {query.isPending ? (
          <SkeletonLines />
        ) : query.isError ? (
          <ErrorState title="Couldn't load duplicate candidates" description={query.error.message} className="border-none p-0 py-2" />
        ) : query.data.length === 0 ? (
          <EmptyState title="No duplicate candidates" className="border-none p-0 py-2" />
        ) : (
          <ul className="flex flex-col gap-2">
            {query.data.map((pair) => {
              const otherId = pair.prospectId === prospectId ? pair.duplicateOfProspectId : pair.prospectId
              const other = otherProspectsQuery.data?.get(otherId)
              return (
                <li key={pair.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 text-sm">
                  <div>
                    {other ? (
                      <Link to={`/platform/acquisition/prospects/${other.id}`} className="font-medium text-ink-950 underline-offset-2 hover:underline">
                        {other.canonicalName}
                      </Link>
                    ) : (
                      <span className="font-mono text-xs text-ink-500">{otherId}</span>
                    )}
                    <p className="text-ink-500">{pair.reason}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-ink-500">{Math.round(pair.confidence * 100)}%</span>
                    <Badge variant="neutral">{pair.status.replace(/_/g, ' ')}</Badge>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        <Link to="/platform/acquisition/duplicates" className="mt-3 inline-block text-sm font-medium text-accent-700 underline-offset-2 hover:underline">
          Review all duplicates
        </Link>
      </CardContent>
    </Card>
  )
}

function EventsSection({ query }: { query: ReturnType<typeof useProspectEvents> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Timeline</CardTitle>
      </CardHeader>
      <CardContent>
        {query.isPending ? (
          <SkeletonLines />
        ) : query.isError ? (
          <ErrorState title="Couldn't load timeline" description={query.error.message} className="border-none p-0 py-2" />
        ) : query.data.length === 0 ? (
          <EmptyState title="No events recorded yet" className="border-none p-0 py-2" />
        ) : (
          <ol className="flex flex-col gap-3 border-l border-border pl-4">
            {query.data.map((event) => (
              <li key={event.id} className="relative text-sm">
                <span className="absolute -left-[1.1rem] top-1.5 h-2 w-2 rounded-full bg-accent-600" aria-hidden="true" />
                <p className="font-medium text-ink-950">{event.eventType.replace(/_/g, ' ')}</p>
                <p className="text-xs text-ink-500">{formatDateTime(event.createdAt)}</p>
                {event.metadata && Object.keys(event.metadata).length > 0 ? (
                  <p className="mt-0.5 font-mono text-xs text-ink-500">{JSON.stringify(event.metadata)}</p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}

function TagsSection({ prospectId, query, canManage }: { prospectId: string; query: ReturnType<typeof useProspectTags>; canManage: boolean }) {
  const { toast } = useToast()
  const addTag = useAddProspectTag()
  const removeTag = useRemoveProspectTag()
  const [newTag, setNewTag] = useState('')

  async function handleAdd() {
    const tag = newTag.trim()
    if (!tag) return
    try {
      await addTag.mutateAsync({ prospectId, tag })
      setNewTag('')
    } catch (error) {
      toast({ title: "Couldn't add tag", description: getErrorMessage(error), variant: 'error' })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tags</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {query.isPending ? (
          <SkeletonLines />
        ) : query.isError ? (
          <ErrorState title="Couldn't load tags" description={query.error.message} className="border-none p-0 py-2" />
        ) : query.data.length === 0 ? (
          <p className="text-sm text-ink-500">No tags yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {query.data.map((tag) => (
              <span key={tag.id} className="inline-flex items-center gap-1 rounded-full bg-paper-200 px-2.5 py-0.5 text-xs font-medium text-ink-700">
                {tag.tag}
                {canManage ? (
                  <button
                    type="button"
                    aria-label={`Remove tag ${tag.tag}`}
                    className="text-ink-500 hover:text-danger-700"
                    onClick={() => removeTag.mutate({ id: tag.id, prospectId })}
                  >
                    ×
                  </button>
                ) : null}
              </span>
            ))}
          </div>
        )}
        {canManage ? (
          <div className="flex gap-2">
            <TextField
              label="Add tag"
              placeholder="e.g. high-priority"
              value={newTag}
              onChange={(event) => setNewTag(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void handleAdd()
                }
              }}
            />
            <Button type="button" variant="secondary" size="sm" isLoading={addTag.isPending} onClick={() => void handleAdd()}>
              Add
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function NotesSection({ prospectId, query, canManage }: { prospectId: string; query: ReturnType<typeof useProspectNotes>; canManage: boolean }) {
  const { toast } = useToast()
  const addNote = useAddProspectNote()
  const [body, setBody] = useState('')

  async function handleAdd() {
    const trimmed = body.trim()
    if (!trimmed) return
    try {
      await addNote.mutateAsync({ prospectId, body: trimmed })
      setBody('')
    } catch (error) {
      toast({ title: "Couldn't add note", description: getErrorMessage(error), variant: 'error' })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notes</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {canManage ? (
          <div className="flex flex-col gap-2">
            <Textarea label="Add a note" placeholder="Add a note…" rows={3} value={body} onChange={(event) => setBody(event.target.value)} />
            <Button type="button" size="sm" isLoading={addNote.isPending} className="self-start" onClick={() => void handleAdd()}>
              Add note
            </Button>
          </div>
        ) : null}
        {query.isPending ? (
          <SkeletonLines />
        ) : query.isError ? (
          <ErrorState title="Couldn't load notes" description={query.error.message} className="border-none p-0 py-2" />
        ) : query.data.length === 0 ? (
          <p className="text-sm text-ink-500">No notes yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {query.data.map((note) => (
              <li key={note.id} className="rounded-md border border-border p-3 text-sm">
                <p className="whitespace-pre-wrap text-ink-800">{note.body}</p>
                <p className="mt-1 text-xs text-ink-500">{formatDateTime(note.createdAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function OutreachSection({ prospectId, query, canManage }: { prospectId: string; query: ReturnType<typeof useProspectOutreach>; canManage: boolean }) {
  const { toast } = useToast()
  const addOutreach = useAddProspectOutreach()
  const [channel, setChannel] = useState<ProspectOutreachChannel>('email')
  const [direction, setDirection] = useState<ProspectOutreachDirection>('outbound')
  const [summary, setSummary] = useState('')

  async function handleAdd() {
    try {
      await addOutreach.mutateAsync({ prospectId, channel, direction, summary: summary.trim() || null })
      setSummary('')
      toast({ title: 'Outreach logged', variant: 'success' })
    } catch (error) {
      toast({ title: "Couldn't log outreach", description: getErrorMessage(error), variant: 'error' })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Outreach log</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {canManage ? (
          <div className="flex flex-col gap-2 rounded-md border border-border p-3">
            <div className="grid grid-cols-2 gap-2">
              <SelectField
                label="Channel"
                value={channel}
                onChange={(event) => setChannel(event.target.value as ProspectOutreachChannel)}
                options={PROSPECT_OUTREACH_CHANNELS.map((c) => ({ value: c, label: c }))}
              />
              <SelectField
                label="Direction"
                value={direction}
                onChange={(event) => setDirection(event.target.value as ProspectOutreachDirection)}
                options={[
                  { value: 'outbound', label: 'Outbound' },
                  { value: 'inbound', label: 'Inbound' },
                ]}
              />
            </div>
            <Textarea label="Summary" placeholder="What happened?" rows={2} value={summary} onChange={(event) => setSummary(event.target.value)} />
            <Button type="button" size="sm" isLoading={addOutreach.isPending} className="self-start" onClick={() => void handleAdd()}>
              Log outreach
            </Button>
          </div>
        ) : null}
        {query.isPending ? (
          <SkeletonLines />
        ) : query.isError ? (
          <ErrorState title="Couldn't load outreach log" description={query.error.message} className="border-none p-0 py-2" />
        ) : query.data.length === 0 ? (
          <p className="text-sm text-ink-500">No outreach logged yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {query.data.map((entry) => (
              <li key={entry.id} className="rounded-md border border-border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium capitalize text-ink-950">
                    {entry.channel} · {entry.direction}
                  </span>
                  <span className="text-xs text-ink-500">{formatDateTime(entry.occurredAt)}</span>
                </div>
                {entry.summary ? <p className="mt-1 text-ink-700">{entry.summary}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function SuppressDialog({ prospectId, onClose }: { prospectId: string; onClose: () => void }) {
  const { toast } = useToast()
  const suppressProspect = useSuppressProspect()
  const [reason, setReason] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  async function handleSuppress() {
    if (!reason.trim()) {
      setFormError('A reason is required.')
      return
    }
    setFormError(null)
    try {
      await suppressProspect.mutateAsync({ prospectId, reason: reason.trim() })
      toast({ title: 'Prospect suppressed', description: 'It will never be re-selected for outreach.', variant: 'success' })
      onClose()
    } catch (error) {
      setFormError(getErrorMessage(error) ?? 'Failed to suppress this prospect.')
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Suppress this prospect</DialogTitle>
          <DialogDescription>Adds it to the global Do Not Contact list. This cannot be undone from this page.</DialogDescription>
        </DialogHeader>
        {formError ? <p className="text-sm text-danger-700">{formError}</p> : null}
        <Textarea label="Reason" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" variant="danger" isLoading={suppressProspect.isPending} onClick={() => void handleSuppress()}>
            Suppress
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SkeletonLines() {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      <div className="h-4 w-full animate-pulse rounded bg-paper-200" />
      <div className="h-4 w-3/4 animate-pulse rounded bg-paper-200" />
    </div>
  )
}
