import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useClassifyOutreachReply, useRepliesAwaitingClassification } from '@/lib/queries/acquisition/outreach'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert } from '@/components/ui/alert'
import { useToast } from '@/components/ui/toast'
import { getErrorMessage } from '@/lib/get-error-message'
import { usePlatformRole } from '@/routes/require-platform-role'

const WRITE_ROLES = new Set(['platform_owner', 'platform_admin'])

/**
 * /platform/outreach/replies — human reply classification.
 *
 * This screen exists because "positive reply" is a judgement, not a
 * measurement. The Worker automatically detects only one thing from an
 * inbound message: a deterministic opt-out keyword. Everything else lands
 * here for a person to decide, which is what makes the positive_reply
 * label trustworthy enough to train on later.
 */
export function PlatformOutreachRepliesPage() {
  const role = usePlatformRole()
  const canClassify = WRITE_ROLES.has(role)
  const { toast } = useToast()

  const repliesQuery = useRepliesAwaitingClassification()
  const classify = useClassifyOutreachReply()
  const [pendingId, setPendingId] = useState<string | null>(null)

  async function handleClassify(recipientId: string, positive: boolean) {
    setPendingId(recipientId)
    try {
      await classify.mutateAsync({ recipientId, positive })
      toast({ title: positive ? 'Marked positive' : 'Marked negative', variant: 'success' })
    } catch (error) {
      toast({ title: "Couldn't classify reply", description: getErrorMessage(error), variant: 'error' })
    } finally {
      setPendingId(null)
    }
  }

  if (repliesQuery.isPending) {
    return <Skeleton className="h-96 w-full" />
  }

  if (repliesQuery.isError) {
    return <ErrorState title="Couldn't load replies" description={repliesQuery.error?.message} />
  }

  return (
    <div className="flex flex-col gap-6">
      <Alert variant="info">
        <p className="text-sm">
          Replies are classified by a person, never by a model. An automatic opt-out is the only inbound signal FadeUp
          acts on without human review, and it is matched against a fixed keyword list. Classifying accurately here is
          what makes the activation funnel and any future model worth trusting.
        </p>
      </Alert>

      {repliesQuery.data.length === 0 ? (
        <EmptyState
          title="No replies awaiting classification"
          description="Replies appear here as soon as a prospect responds to a campaign message."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {repliesQuery.data.map((recipient) => (
            <Card key={recipient.id}>
              <CardHeader>
                <CardTitle className="text-base">
                  <Link
                    to={`/platform/acquisition/prospects/${recipient.prospectId}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {recipient.prospectName ?? recipient.prospectId.slice(0, 8)}
                  </Link>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="text-xs text-ink-500">
                  {recipient.templateKey ? <span className="font-mono">{recipient.templateKey}</span> : null}
                  {recipient.locale ? <span className="ml-2 font-mono">{recipient.locale}</span> : null}
                  {recipient.repliedAt ? (
                    <span className="ml-2">replied {new Date(recipient.repliedAt).toLocaleString()}</span>
                  ) : null}
                </div>

                {recipient.renderedBody ? (
                  <div className="rounded-md bg-paper-100 p-3">
                    <p className="text-xs font-medium text-ink-700">What FadeUp sent</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-ink-950">{recipient.renderedBody}</p>
                  </div>
                ) : null}

                {canClassify ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() => void handleClassify(recipient.id, true)}
                      disabled={pendingId === recipient.id}
                    >
                      Positive reply
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void handleClassify(recipient.id, false)}
                      disabled={pendingId === recipient.id}
                    >
                      Negative reply
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-ink-500">Classification requires a platform owner or admin role.</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
