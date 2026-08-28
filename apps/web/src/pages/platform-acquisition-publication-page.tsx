import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Check, RefreshCw, ShieldCheck } from 'lucide-react'
import {
  usePublicationQueue,
  usePublicationQueueCounts,
  usePublishExternalProfessional,
  useRefreshPublicationEligibility,
  type PublicationBlockReason,
  type PublicationCandidate,
  type PublicationFilter,
} from '@/lib/queries/acquisition/publication'
import { ProspectTypeBadge } from '@/components/acquisition/badges'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { getErrorMessage } from '@/lib/get-error-message'
import { usePlatformRole } from '@/routes/require-platform-role'

const WRITE_ROLES = new Set(['platform_owner', 'platform_admin'])

/**
 * /platform/acquisition/publication — the external-profile publication queue.
 *
 * WHO USES THIS AND WHAT THEY ARE DECIDING
 *
 * A FadeUp platform administrator, deciding whether a discovered business
 * should get a durable, claimable FadeUp identity. This is not a sales triage
 * screen and deliberately shows no lead score: the question is "is this a real
 * business we can name correctly", not "is this a good prospect". Those are
 * different questions and mixing them would push somebody towards publishing
 * the high-scoring one.
 *
 * The decision is close to permanent — an identity can be claimed, and R1B made
 * transferring a claimed identity unrepresentable — so the primary action is
 * behind a confirmation that states what will be created, rather than a button
 * in a row that a mis-tap could hit.
 *
 * WHY BLOCKED CANDIDATES ARE SHOWN AT ALL
 *
 * The blocked tab is the useful one on most days. Nearly every candidate that
 * becomes eligible does so by leaving that tab — a duplicate gets resolved, a
 * second source lands. Hiding blocked prospects would make the gate feel
 * arbitrary and leave an operator with no way to see why supply is not growing.
 * Each row names its reason and what would clear it.
 */
export function PlatformAcquisitionPublicationPage() {
  const counts = usePublicationQueueCounts()

  return (
    <div className="flex flex-col gap-6">
      <Alert variant="info">
        <p>
          Publishing creates an <strong>unclaimed</strong> professional identity for a real business. It has no
          availability, no queue and no schedule — none of that is modelled for an unclaimed profile — and it stays
          invisible to the public until its owner claims it.
        </p>
      </Alert>

      <Tabs defaultValue="eligible">
        <TabsList>
          <TabsTrigger value="eligible">
            Ready to publish{counts.data ? ` (${counts.data.eligible})` : ''}
          </TabsTrigger>
          <TabsTrigger value="blocked">Blocked{counts.data ? ` (${counts.data.blocked})` : ''}</TabsTrigger>
          <TabsTrigger value="published">Published{counts.data ? ` (${counts.data.published})` : ''}</TabsTrigger>
        </TabsList>

        <TabsContent value="eligible">
          <QueueList
            filter="eligible"
            emptyTitle="Nothing waiting to publish"
            emptyDescription="Every evaluated prospect is either blocked or already published. The Worker's publication_evaluation job refreshes this."
          />
        </TabsContent>
        <TabsContent value="blocked">
          <QueueList
            filter="blocked"
            emptyTitle="No blocked candidates"
            emptyDescription="Nothing has been evaluated and refused yet."
          />
        </TabsContent>
        <TabsContent value="published">
          <QueueList
            filter="published"
            emptyTitle="Nothing published yet"
            emptyDescription="Identities you publish from here will be listed for reference."
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function QueueList({
  filter,
  emptyTitle,
  emptyDescription,
}: {
  filter: PublicationFilter
  emptyTitle: string
  emptyDescription: string
}) {
  const query = usePublicationQueue(filter)

  if (query.isPending) return <QueueSkeleton />
  if (query.isError) {
    return <ErrorState title="Couldn't load the publication queue" description={query.error.message} />
  }
  if (query.data.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />
  }

  return (
    <div className="flex flex-col gap-3">
      {query.data.map((candidate) => (
        <CandidateCard key={candidate.prospectId} candidate={candidate} />
      ))}
    </div>
  )
}

function CandidateCard({ candidate }: { candidate: PublicationCandidate }) {
  const { toast } = useToast()
  const role = usePlatformRole()
  const canPublish = WRITE_ROLES.has(role)
  const refresh = useRefreshPublicationEligibility()
  const [confirmOpen, setConfirmOpen] = useState(false)

  async function handleRecheck() {
    try {
      await refresh.mutateAsync(candidate.prospectId)
      toast({ title: 'Re-checked against the live gate', variant: 'success' })
    } catch (error) {
      toast({ title: "Couldn't re-check this prospect", description: getErrorMessage(error), variant: 'error' })
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                to={`/platform/acquisition/prospects/${candidate.prospectId}`}
                className="truncate font-medium text-ink-950 underline-offset-2 hover:underline"
              >
                {candidate.canonicalName}
              </Link>
              <ProspectTypeBadge type={candidate.prospectType} />
              {candidate.isPublished ? (
                <Badge variant="success">
                  <Check aria-hidden="true" className="h-3 w-3" />
                  Published
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 truncate text-sm text-ink-500">
              {[candidate.country, candidate.websiteDomain].filter(Boolean).join(' · ')}
            </p>
          </div>

          <span className="shrink-0 text-xs text-ink-500">
            Found {new Date(candidate.firstDiscoveredAt).toLocaleDateString()}
          </span>
        </div>

        <EvidenceRow candidate={candidate} />

        {candidate.blockReason && !candidate.isPublished ? <BlockExplanation reason={candidate.blockReason} /> : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-ink-500">
            Checked {new Date(candidate.evaluatedAt).toLocaleString()}
          </span>

          {candidate.isPublished ? null : (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                size="sm"
                isLoading={refresh.isPending && refresh.variables === candidate.prospectId}
                onClick={() => void handleRecheck()}
              >
                <RefreshCw aria-hidden="true" className="h-4 w-4" />
                Re-check
              </Button>
              {candidate.isEligible && canPublish ? (
                <Button variant="primary" size="sm" onClick={() => setConfirmOpen(true)}>
                  Publish profile
                </Button>
              ) : null}
            </div>
          )}
        </div>
      </CardContent>

      <PublishDialog candidate={candidate} open={confirmOpen} onOpenChange={setConfirmOpen} />
    </Card>
  )
}

/**
 * The gate's own evidence, shown as the two facts it actually decided on.
 *
 * A number alone ("2 sources") would not tell an operator whether that is
 * enough, so the row states the rule it satisfies. `ShieldCheck` is paired with
 * the word "registry" rather than standing alone — an icon carrying the
 * difference between verified and unverified identity would be state conveyed
 * by shape only.
 */
function EvidenceRow({ candidate }: { candidate: PublicationCandidate }) {
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-2 rounded-md border border-border bg-paper-50 px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <dt className="text-ink-500">Sources</dt>
        <dd className="font-medium text-ink-950">
          {candidate.distinctSourceCount}
          <span className="ml-1 font-normal text-ink-500">
            {candidate.distinctSourceCount >= 2 ? 'independent' : 'only'}
          </span>
        </dd>
      </div>
      <div className="flex items-center gap-2">
        <dt className="text-ink-500">Identity evidence</dt>
        <dd className="flex items-center gap-1.5 font-medium text-ink-950">
          {candidate.hasTrustAnchor ? (
            <>
              <ShieldCheck aria-hidden="true" className="h-4 w-4 text-success-700" />
              Verified registry record
            </>
          ) : candidate.distinctSourceCount >= 2 ? (
            'Multiple directories agree'
          ) : (
            <span className="text-ink-500">Single observation</span>
          )}
        </dd>
      </div>
    </dl>
  )
}

/**
 * Every reason the gate can give, with the remedy rather than a restatement.
 *
 * An operator reading "insufficient_source_evidence" learns nothing they can
 * act on. The second sentence is what turns this screen from a wall into a
 * work queue.
 */
const BLOCK_COPY: Record<PublicationBlockReason, { label: string; remedy: string }> = {
  prospect_not_found: {
    label: 'Prospect no longer exists',
    remedy: 'It was deleted after this verdict was cached. Re-check to clear it from the queue.',
  },
  do_not_contact: {
    label: 'Marked do-not-contact',
    remedy: 'This business asked not to be contacted, so FadeUp does not catalogue it either.',
  },
  suppressed_prospect: {
    label: 'Suppressed',
    remedy: 'A suppression covers this prospect. Remove it under Suppressions if that was a mistake.',
  },
  suppressed_phone: {
    label: 'Phone number is suppressed',
    remedy: 'A suppression covers this number. Remove it under Suppressions if that was a mistake.',
  },
  suppressed_email: {
    label: 'Email address is suppressed',
    remedy: 'A suppression covers this address. Remove it under Suppressions if that was a mistake.',
  },
  suppressed_domain: {
    label: 'Website domain is suppressed',
    remedy: 'A suppression covers this domain. Remove it under Suppressions if that was a mistake.',
  },
  already_converted: {
    label: 'Already a FadeUp customer',
    remedy: 'They own their identity through their own account. A second unclaimed one would compete with it.',
  },
  already_customer: {
    label: 'Already a customer or trialling',
    remedy: 'They own their identity through their own account.',
  },
  entity_kind_not_publishable: {
    label: 'Chain umbrella record',
    remedy: 'A group parent is not something a person can claim. Publish its individual locations instead.',
  },
  already_published: {
    label: 'Already published',
    remedy: 'An identity exists for this prospect. Nothing further to do.',
  },
  name_not_publishable: {
    label: 'Name is not usable publicly',
    remedy: 'The name becomes the profile’s public display name. Correct it on the prospect first.',
  },
  unresolved_duplicate: {
    label: 'Unresolved duplicate candidate',
    remedy: 'Resolve the pair under Duplicates. Publishing now could split one real business across two identities.',
  },
  insufficient_source_evidence: {
    label: 'Not enough identity evidence',
    remedy: 'Needs two independent sources, or one verified business registry. A single listing is not enough.',
  },
  no_corroborating_location: {
    label: 'No location or website',
    remedy: 'Nobody could recognise this profile as themselves. Enrichment may still find an address or domain.',
  },
}

function BlockExplanation({ reason }: { reason: PublicationBlockReason }) {
  const copy = BLOCK_COPY[reason]

  return (
    <div className="flex gap-2.5 rounded-md border border-warning-600/40 bg-warning-100 px-3 py-2">
      <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-warning-700" />
      <div className="min-w-0 text-sm">
        <p className="font-medium text-ink-950">{copy.label}</p>
        <p className="mt-0.5 text-ink-700">{copy.remedy}</p>
      </div>
    </div>
  )
}

function PublishDialog({
  candidate,
  open,
  onOpenChange,
}: {
  candidate: PublicationCandidate
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { toast } = useToast()
  const publish = usePublishExternalProfessional()
  const [note, setNote] = useState('')

  async function handlePublish() {
    try {
      await publish.mutateAsync({ prospectId: candidate.prospectId, note })
      toast({ title: `Published ${candidate.canonicalName}`, variant: 'success' })
      setNote('')
      onOpenChange(false)
    } catch (error) {
      // The live gate can refuse what the cached verdict offered — a duplicate
      // flagged since the last sweep, a suppression added this morning. The
      // reason comes back in the message rather than being swallowed into
      // "something went wrong".
      toast({ title: "Couldn't publish this profile", description: getErrorMessage(error), variant: 'error' })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Publish {candidate.canonicalName}?</DialogTitle>
          <DialogDescription>
            This creates a durable FadeUp identity that the real owner can later claim. It cannot be transferred to a
            different account once claimed, so publish only if you are confident this is one real business.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          <dl className="flex flex-col gap-2 rounded-md border border-border bg-paper-50 px-3 py-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-500">Public display name</dt>
              <dd className="text-right font-medium text-ink-950">{candidate.canonicalName}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-500">Evidence</dt>
              <dd className="text-right text-ink-950">
                {candidate.hasTrustAnchor
                  ? 'Verified registry record'
                  : `${candidate.distinctSourceCount} independent sources`}
              </dd>
            </div>
          </dl>

          <Textarea
            label="Why you approved this (optional)"
            hint="Recorded in the platform audit log with your name. Not shown to the business."
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
          />
        </DialogBody>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={publish.isPending}>
            Cancel
          </Button>
          <Button variant="primary" isLoading={publish.isPending} onClick={() => void handlePublish()}>
            Publish profile
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function QueueSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  )
}
