import { useMemo, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import {
  useProfessionalClaims,
  useProfessionalsByIds,
  useReviewProfessionalClaim,
  type ClaimedIdentity,
  type ProfessionalClaim,
  type ProfessionalClaimState,
} from '@/lib/queries/professional-claims'
import { Alert } from '@/components/ui/alert'
import { Badge, type BadgeVariant } from '@/components/ui/badge'
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
 * /platform/acquisition/claims — the professional-claim review queue.
 *
 * R1B shipped submit, withdraw and review as database functions and no
 * interface at all, so a claim filed by a real barber has had nowhere to be
 * seen. This is that interface, and it is deliberately the plainest screen in
 * the section: the reviewer's job is to read one person's account of why an
 * identity is theirs and decide, and every additional element on the page
 * competes with that.
 *
 * THE ONE THING THE DESIGN HAS TO GET RIGHT
 *
 * Approving is the only path that moves an identity to `claimed`, and R1B made
 * the reverse unrepresentable — an approved claim cannot be undone, reassigned
 * or transferred, only erased with the account. So Approve is NOT a button in a
 * row. It opens a confirmation that states, in words, that the decision is
 * final and that FadeUp verifies nothing on the reviewer's behalf.
 *
 * There is no bulk approve, and there should not be. A queue that can be
 * cleared in one gesture is a queue nobody reads.
 */
export function PlatformAcquisitionClaimsPage() {
  const pending = useProfessionalClaims('pending')

  return (
    <div className="flex flex-col gap-6">
      <Alert variant="warning">
        <p>
          FadeUp performs <strong>no automated verification</strong> of these claims. Approving grants permanent control
          of a professional identity to this account and cannot be undone or transferred. Check the evidence yourself.
        </p>
      </Alert>

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">Awaiting review{pending.data ? ` (${pending.data.length})` : ''}</TabsTrigger>
          <TabsTrigger value="decided">Decided</TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          <ClaimList
            state="pending"
            emptyTitle="No claims awaiting review"
            emptyDescription="Claims filed against published profiles will appear here, oldest first."
          />
        </TabsContent>
        <TabsContent value="decided">
          <ClaimList
            state={undefined}
            decidedOnly
            emptyTitle="Nothing decided yet"
            emptyDescription="Approved, rejected and withdrawn claims are kept here for reference."
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function ClaimList({
  state,
  decidedOnly = false,
  emptyTitle,
  emptyDescription,
}: {
  state: ProfessionalClaimState | undefined
  decidedOnly?: boolean
  emptyTitle: string
  emptyDescription: string
}) {
  const query = useProfessionalClaims(state)

  const claims = useMemo(() => {
    const rows = query.data ?? []
    return decidedOnly ? rows.filter((claim) => claim.state !== 'pending') : rows
  }, [query.data, decidedOnly])

  const identityIds = useMemo(() => claims.map((claim) => claim.professionalId), [claims])
  const identities = useProfessionalsByIds(identityIds)

  if (query.isPending) return <ClaimsSkeleton />
  if (query.isError) return <ErrorState title="Couldn't load claims" description={query.error.message} />
  if (claims.length === 0) return <EmptyState title={emptyTitle} description={emptyDescription} />

  return (
    <div className="flex flex-col gap-3">
      {claims.map((claim) => (
        <ClaimCard
          key={claim.id}
          claim={claim}
          identity={identities.data?.get(claim.professionalId)}
          identityLoading={identities.isPending}
        />
      ))}
    </div>
  )
}

const STATE_BADGE: Record<ProfessionalClaimState, { variant: BadgeVariant; label: string }> = {
  pending: { variant: 'warning', label: 'Awaiting review' },
  approved: { variant: 'success', label: 'Approved' },
  rejected: { variant: 'danger', label: 'Rejected' },
  withdrawn: { variant: 'neutral', label: 'Withdrawn by claimant' },
}

function ClaimCard({
  claim,
  identity,
  identityLoading,
}: {
  claim: ProfessionalClaim
  identity: ClaimedIdentity | undefined
  identityLoading: boolean
}) {
  const role = usePlatformRole()
  const canReview = WRITE_ROLES.has(role)
  const [decision, setDecision] = useState<'approve' | 'reject' | null>(null)

  const badge = STATE_BADGE[claim.state]

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {identityLoading ? (
              <Skeleton className="h-5 w-48" />
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate font-medium text-ink-950">
                  {identity?.displayName ?? 'Identity not found'}
                </span>
                {identity?.source === 'acquisition' ? (
                  <Badge variant="neutral">Found by acquisition</Badge>
                ) : null}
              </div>
            )}
            <p className="mt-1 text-sm text-ink-500">
              Filed {new Date(claim.submittedAt).toLocaleString()}
            </p>
          </div>

          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>

        <div className="rounded-md border border-border bg-paper-50 px-3 py-2">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
            Claimant’s evidence, in their words
          </p>
          {claim.evidence ? (
            <p className="mt-1 whitespace-pre-wrap text-sm text-ink-700">{claim.evidence}</p>
          ) : (
            <p className="mt-1 text-sm italic text-ink-500">
              No evidence supplied. That is not by itself a reason to reject, and it is not a reason to approve.
            </p>
          )}
        </div>

        {claim.decisionNote ? (
          <div className="rounded-md border border-border px-3 py-2">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Reply sent to the claimant</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-ink-700">{claim.decisionNote}</p>
          </div>
        ) : null}

        {claim.state === 'pending' && canReview ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="sm" onClick={() => setDecision('approve')}>
              Approve claim
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setDecision('reject')}>
              Reject
            </Button>
          </div>
        ) : null}

        {claim.state !== 'pending' && claim.decidedAt ? (
          <p className="text-xs text-ink-500">Decided {new Date(claim.decidedAt).toLocaleString()}</p>
        ) : null}
      </CardContent>

      <ReviewDialog
        claim={claim}
        identity={identity}
        decision={decision}
        onClose={() => setDecision(null)}
      />
    </Card>
  )
}

function ReviewDialog({
  claim,
  identity,
  decision,
  onClose,
}: {
  claim: ProfessionalClaim
  identity: ClaimedIdentity | undefined
  decision: 'approve' | 'reject' | null
  onClose: () => void
}) {
  const { toast } = useToast()
  const review = useReviewProfessionalClaim()
  const [note, setNote] = useState('')

  const isApprove = decision === 'approve'

  async function handleSubmit() {
    if (!decision) return
    try {
      await review.mutateAsync({ claimId: claim.id, decision, note })
      toast({
        title: isApprove ? 'Claim approved' : 'Claim rejected',
        description: isApprove
          ? `${identity?.displayName ?? 'The identity'} is now controlled by the claimant.`
          : undefined,
        variant: 'success',
      })
      setNote('')
      onClose()
    } catch (error) {
      toast({ title: "Couldn't record that decision", description: getErrorMessage(error), variant: 'error' })
    }
  }

  return (
    <Dialog open={decision !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isApprove ? 'Approve this claim?' : 'Reject this claim?'}
          </DialogTitle>
          <DialogDescription>
            {isApprove
              ? `This permanently hands control of “${identity?.displayName ?? 'this identity'}” to the claimant’s account. It cannot be undone, reassigned, or transferred to anyone else. Any other pending claim on the same identity will be closed.`
              : 'The claimant can see the reply you write below. Rejecting is final for this claim; they may file a new one.'}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          {isApprove ? (
            <div className="flex gap-2.5 rounded-md border border-warning-600/40 bg-warning-100 px-3 py-2">
              <ShieldAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-warning-700" />
              <p className="text-sm text-ink-700">
                Approving grants control of an identity, not a subscription. The account stays on whatever plan it
                already has.
              </p>
            </div>
          ) : null}

          <Textarea
            label={isApprove ? 'Message to the claimant (optional)' : 'Reason for the claimant (optional)'}
            hint="The claimant reads this. There is no separate internal note — do not write a private assessment here."
            value={note}
            maxLength={2000}
            onChange={(event) => setNote(event.target.value)}
          />
        </DialogBody>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={review.isPending}>
            Cancel
          </Button>
          <Button
            variant={isApprove ? 'primary' : 'danger'}
            isLoading={review.isPending}
            onClick={() => void handleSubmit()}
          >
            {isApprove ? 'Approve claim' : 'Reject claim'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ClaimsSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      <Skeleton className="h-44 w-full" />
      <Skeleton className="h-44 w-full" />
    </div>
  )
}
