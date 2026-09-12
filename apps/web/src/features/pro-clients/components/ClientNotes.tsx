import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessageKey, toAppError } from '@/shared/data/errors'
import { deviceTimezone } from '@/shared/lib/format'
import { Button } from '@/shared/ui/Button'
import { DateTime } from '@/shared/ui/DateTime'
import { Dialog } from '@/shared/ui/Dialog'
import { SkeletonText } from '@/shared/ui/Skeleton'
import { Textarea } from '@/shared/ui/Textarea'
import { useToast } from '@/shared/ui/Toast'
import {
  useAddCustomerNote,
  useCustomerNotes,
  useDeleteCustomerNote,
  useUpdateCustomerNote,
  type CustomerNote,
} from '@/features/pro-clients/api/clients'
import { noteRefusalMessageKey, parseNoteRefusal } from '@/features/pro-clients/lib/crm'

/**
 * OS-2 — les notes privées du CRM (MASTER_SPEC §10 : elles appartiennent au
 * CRM, pas au Fade Passport).
 *
 * Deux exigences produit tenues ici :
 *   · la mention de loyauté reste VISIBLE — le support FadeUp peut y
 *     accéder et chaque consultation est tracée ;
 *   · « Modifier » et « Supprimer » n'existent QUE si le serveur dit
 *     `can_edit`. Jamais grisés : une action interdite ne se rend pas.
 */

const NOTE_MAX_LENGTH = 2000

interface ClientNotesProps {
  organizationId: string | null
  customerId: string
}

export function ClientNotes({ organizationId, customerId }: ClientNotesProps) {
  const { t } = useTranslation('v2')
  const { toast } = useToast()

  const notes = useCustomerNotes(organizationId, customerId)
  const add = useAddCustomerNote(organizationId, customerId)
  const update = useUpdateCustomerNote(organizationId, customerId)
  const remove = useDeleteCustomerNote(organizationId, customerId)

  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingBody, setEditingBody] = useState('')
  const [deleting, setDeleting] = useState<CustomerNote | null>(null)

  /* Le plus récent en tête — l'ordre serveur est confirmé côté écran, il
     n'est pas inventé. */
  const rows = useMemo(
    () => [...(notes.data ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [notes.data],
  )

  const refuse = (raw: unknown) => {
    const code = parseNoteRefusal(raw)
    toast({ tone: 'error', title: t(code ? noteRefusalMessageKey(code) : errorMessageKey(toAppError(raw))) })
  }

  const submitDraft = () => {
    const body = draft.trim()
    if (!body) return
    add.mutate(body, {
      onSuccess: () => {
        setDraft('')
        toast({ tone: 'success', title: t('pro.clients.toast.noteAdded') })
      },
      onError: refuse,
    })
  }

  const submitEdit = () => {
    const body = editingBody.trim()
    if (!body || !editingId) return
    update.mutate(
      { noteId: editingId, body },
      {
        onSuccess: () => {
          setEditingId(null)
          setEditingBody('')
          toast({ tone: 'success', title: t('pro.clients.toast.noteUpdated') })
        },
        onError: refuse,
      },
    )
  }

  const confirmDelete = () => {
    if (!deleting) return
    remove.mutate(deleting.id, {
      onSuccess: () => {
        setDeleting(null)
        toast({ tone: 'success', title: t('pro.clients.toast.noteDeleted') })
      },
      onError: (raw) => {
        setDeleting(null)
        refuse(raw)
      },
    })
  }

  return (
    <section
      className="rounded-[var(--radius-card)] border border-[var(--fu-border)] bg-[var(--fu-surface)] p-4 lg:p-5"
      data-testid="pro-client-notes"
    >
      <h2 className="font-fu-mono text-fu-xs font-medium tracking-widest text-[var(--fu-text-secondary)]">
        {t('pro.clients.notes.title').toLocaleUpperCase()}
      </h2>
      {/* Obligation de loyauté : dite ici, toujours visible, jamais repliée. */}
      <p className="mt-2 text-fu-xs text-[var(--fu-text-secondary)]">{t('pro.clients.notes.hint')}</p>

      <div className="mt-4 flex flex-col gap-2">
        <Textarea
          label={t('pro.clients.notes.add')}
          placeholder={t('pro.clients.notes.placeholder')}
          rows={3}
          maxLength={NOTE_MAX_LENGTH}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          data-testid="pro-client-note-input"
        />
        <div className="flex justify-end">
          <Button
            variant="primary"
            size="sm"
            loading={add.isPending}
            disabled={draft.trim().length === 0}
            onClick={submitDraft}
            data-testid="pro-client-note-submit"
          >
            {t('pro.clients.notes.save')}
          </Button>
        </div>
      </div>

      <div className="mt-4 border-t border-[var(--fu-border)] pt-4">
        {notes.isPending ? (
          <div className="flex flex-col gap-3" aria-busy="true" aria-label={t('common.a11y.loading')}>
            <SkeletonText className="w-4/5" />
            <SkeletonText className="h-3 w-1/3" />
            <SkeletonText className="w-3/5" />
          </div>
        ) : notes.error ? (
          <div>
            <p className="text-fu-sm text-[var(--fu-text-secondary)]">
              {t(errorMessageKey(toAppError(notes.error)))}
            </p>
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => void notes.refetch()}>
              {t('common.action.retry')}
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <p className="text-fu-sm text-[var(--fu-text-secondary)]">{t('pro.clients.notes.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {rows.map((note) => (
              <li key={note.id} className="flex flex-col gap-1.5" data-testid="pro-client-note">
                {editingId === note.id ? (
                  <div className="flex flex-col gap-2">
                    <Textarea
                      label={t('pro.clients.notes.edit')}
                      rows={3}
                      maxLength={NOTE_MAX_LENGTH}
                      value={editingBody}
                      onChange={(event) => setEditingBody(event.target.value)}
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="tertiary"
                        size="sm"
                        onClick={() => {
                          setEditingId(null)
                          setEditingBody('')
                        }}
                      >
                        {t('pro.clients.notes.cancel')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={update.isPending}
                        disabled={editingBody.trim().length === 0}
                        onClick={submitEdit}
                      >
                        {t('pro.clients.notes.save')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="whitespace-pre-wrap text-fu-sm text-[var(--fu-text-primary)]">{note.body}</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-fu-xs text-[var(--fu-text-secondary)]">
                      <span>
                        {t('pro.clients.notes.author', {
                          name: note.author_display_name ?? t('pro.clients.notes.authorUnknown'),
                        })}
                      </span>
                      <DateTime value={note.created_at} timezone={deviceTimezone()} format="relative" />
                      {/* Capacité absente = rien de rendu (P1PRO §0bis). */}
                      {note.can_edit && (
                        <span className="flex items-center gap-1">
                          <Button
                            variant="tertiary"
                            size="sm"
                            onClick={() => {
                              setEditingId(note.id)
                              setEditingBody(note.body)
                            }}
                          >
                            {t('pro.clients.notes.edit')}
                          </Button>
                          <Button variant="tertiary" size="sm" onClick={() => setDeleting(note)}>
                            {t('pro.clients.notes.delete')}
                          </Button>
                        </span>
                      )}
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Destructif : toujours derrière une confirmation (P1PRO §6). */}
      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title={t('pro.clients.notes.deleteTitle')}
        description={t('pro.clients.notes.deleteBody')}
      >
        <div className="flex justify-end gap-2">
          <Button variant="tertiary" onClick={() => setDeleting(null)}>
            {t('pro.clients.notes.cancel')}
          </Button>
          <Button
            variant="destructive"
            loading={remove.isPending}
            onClick={confirmDelete}
            data-testid="pro-client-note-delete-confirm"
          >
            {t('pro.clients.notes.deleteConfirm')}
          </Button>
        </div>
      </Dialog>
    </section>
  )
}
