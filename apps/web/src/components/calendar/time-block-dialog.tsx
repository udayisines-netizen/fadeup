import { useState } from 'react'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { TextField } from '@/components/ui/text-field'
import { SelectField } from '@/components/ui/select-field'
import { useToast } from '@/components/ui/toast'
import {
  calendarErrorMessage,
  useCreateTimeBlock,
  useDeleteTimeBlock,
  type TimeBlock,
} from '@/lib/queries/calendar'
import { zonedTimeToInstant } from '@/lib/calendar/time'
import type { CalendarProfessional } from '@/lib/calendar/professionals'
import { cn } from '@/lib/cn'
import { useTranslation } from 'react-i18next'
import { useDateTime } from '@/lib/intl/use-intl'

/** Quick reasons, because typing "Lunch" on a phone every day is not a workflow. */
const QUICK_REASONS = ['Lunch', 'Break', 'Meeting', 'Training', 'Personal'] as const

function toMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

/**
 * Blocking time.
 *
 * The times are entered as WALL CLOCK in the shop's timezone and converted to
 * instants here, once, on submit. That conversion is the whole reason this is
 * not a naive `new Date(...)`: a manager in London blocking a Paris shop's
 * lunch must block Paris lunchtime, not their own.
 *
 * A block is not an appointment. It creates no customer, appears in no counts,
 * and is not something anyone gets notified about — see the migration for why
 * placeholder appointments were rejected as the model.
 */
export function TimeBlockDialog({
  open,
  onOpenChange,
  organizationId,
  locationId,
  timeZone,
  professionals,
  defaultBarberId,
  defaultDate,
  defaultStartMinute,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationId: string
  locationId: string | null
  timeZone: string
  professionals: CalendarProfessional[]
  defaultBarberId?: string
  defaultDate: string
  /** Pre-filled when the block was started by clicking empty space on the grid. */
  defaultStartMinute?: number
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const createBlock = useCreateTimeBlock(organizationId)
  const [error, setError] = useState<string | null>(null)

  const initialStart = defaultStartMinute ?? 12 * 60
  const [barberId, setBarberId] = useState(defaultBarberId ?? professionals[0]?.barberId ?? '')
  const [date, setDate] = useState(defaultDate)
  const [startTime, setStartTime] = useState(minutesToValue(initialStart))
  const [endTime, setEndTime] = useState(minutesToValue(Math.min(initialStart + 60, 23 * 60 + 45)))
  const [reason, setReason] = useState('')

  const startMinutes = toMinutes(startTime)
  const endMinutes = toMinutes(endTime)
  const invalidRange = endMinutes <= startMinutes

  async function submit() {
    setError(null)
    if (invalidRange) {
      setError(t('app:timeBlock.theEndTimeHasTo'))
      return
    }
    if (!barberId) {
      setError(t('app:timeBlock.chooseWhoThisTimeIs'))
      return
    }

    try {
      await createBlock.mutateAsync({
        organizationId,
        barberId,
        locationId,
        startsAt: zonedTimeToInstant(date, startMinutes, timeZone).toISOString(),
        endsAt: zonedTimeToInstant(date, endMinutes, timeZone).toISOString(),
        reason: reason || null,
      })
      toast({ title: t('app:timeBlock.timeBlocked'), variant: 'success' })
      onOpenChange(false)
      setReason('')
    } catch (cause) {
      setError(calendarErrorMessage(cause))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('app:timeBlock.blockTime')}</DialogTitle>
          <DialogDescription>
            {t('app:timeBlock.nobodyCanBookThisTime')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {error ? <Alert variant="error">{error}</Alert> : null}

          {professionals.length > 1 ? (
            <SelectField
              label={t('app:timeBlock.who')}
              value={barberId}
              options={professionals.map((professional) => ({
                value: professional.barberId,
                label: professional.displayName,
              }))}
              onChange={(event) => setBarberId(event.target.value)}
            />
          ) : null}

          <TextField label={t('common:field.date')} type="date" value={date} onChange={(event) => setDate(event.target.value)} />

          <div className="grid grid-cols-2 gap-4">
            <TextField
              label={t('app:timeBlock.from')}
              type="time"
              step={900}
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
            />
            <TextField
              label="To"
              type="time"
              step={900}
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
              error={invalidRange ? 'Must be after the start time' : undefined}
            />
          </div>

          <div>
            <span className="text-sm font-medium text-ink-950">{t('common:field.reason')}</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {QUICK_REASONS.map((quick) => (
                <button
                  key={quick}
                  type="button"
                  aria-pressed={reason === quick}
                  onClick={() => setReason(reason === quick ? '' : quick)}
                  className={cn(
                    'min-h-11 rounded-full border px-4 text-sm transition-colors',
                    reason === quick
                      ? 'border-ink-950 bg-ink-950 text-on-accent'
                      : 'border-border text-ink-700 hover:bg-paper-100',
                  )}
                >
                  {quick}
                </button>
              ))}
            </div>
            <div className="mt-3">
              <TextField
                label={t('app:timeBlock.orSomethingElse')}
                value={reason}
                maxLength={200}
                placeholder={t('app:timeBlock.optional')}
                hint={t('app:timeBlock.staffCanSeeThisCustomers')}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              {t('common:action.cancel')}
            </Button>
          </DialogClose>
          <Button type="button" onClick={() => void submit()} isLoading={createBlock.isPending}>
            {t('app:timeBlock.blockThisTime')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function minutesToValue(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** Viewing (and removing) an existing block. Small on purpose — a block has no lifecycle. */
export function TimeBlockSheet({
  block,
  open,
  onOpenChange,
  organizationId,
  timeZone,
  professionalName,
  canRemove,
}: {
  block: TimeBlock | null
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationId: string
  timeZone: string
  professionalName: string | undefined
  canRemove: boolean
}) {
  const { t } = useTranslation()
  const dateTime = useDateTime()
  const { toast } = useToast()
  const deleteBlock = useDeleteTimeBlock(organizationId)
  const [error, setError] = useState<string | null>(null)

  if (!block) return null

  const formatTime = (iso: string) => dateTime.time(iso, timeZone)
  const formatDay = (iso: string) => dateTime.longDate(iso, timeZone)

  async function remove() {
    setError(null)
    try {
      await deleteBlock.mutateAsync(block!.id)
      toast({ title: t('app:timeBlock.timeUnblocked'), variant: 'success' })
      onOpenChange(false)
    } catch (cause) {
      setError(calendarErrorMessage(cause))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{block.reason ?? 'Blocked time'}</DialogTitle>
          <DialogDescription>
            {formatDay(block.startsAt)} · {formatTime(block.startsAt)}–{formatTime(block.endsAt)}
            {professionalName ? ` · ${professionalName}` : ''}
          </DialogDescription>
        </DialogHeader>

        {error ? <Alert variant="error">{error}</Alert> : null}

        <p className="text-sm text-ink-500">
          {t('app:timeBlock.thisTimeIsNotOffered')}
        </p>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              {t('common:action.close')}
            </Button>
          </DialogClose>
          {canRemove ? (
            <Button type="button" variant="danger" onClick={() => void remove()} isLoading={deleteBlock.isPending}>
              {t('app:timeBlock.unblockThisTime')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
