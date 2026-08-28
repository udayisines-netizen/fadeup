import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useForm } from 'react-hook-form'
import QRCode from 'qrcode'
import { Check, Copy, ImagePlus, QrCode, Trash2, X } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useMyCustomerProfile } from '@/lib/queries/customer-profile'
import {
  useMyPassport,
  useUpsertMyPassport,
  useMyPassportPhotos,
  useUploadPassportPhoto,
  useDeletePassportPhoto,
  useMyPassportShares,
  useCreatePassportShare,
  useRevokePassportShare,
} from '@/lib/queries/passport'
import { PassportCard } from '@/components/passport/passport-card'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { TextField } from '@/components/ui/text-field'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Alert } from '@/components/ui/alert'
import { ErrorState } from '@/components/ui/error-state'
import { PageSpinner } from '@/components/ui/spinner'
import { useToast } from '@/components/ui/toast'
import { getErrorMessage } from '@/lib/get-error-message'

interface PassportFormValues {
  usualHaircut: string
  fadeType: string
  sideLength: string
  topLength: string
  beardPreferences: string
  preferencesNotes: string
}

/**
 * /app/customer/passport — the customer-owned Fade Passport: structured
 * grooming preferences, private reference photos, and revocable "Share my
 * fade" links (QR + copyable URL). Partial information is fine by design —
 * nothing here is required.
 */
export function CustomerPassportPage() {
  const { t } = useTranslation('passport')
  const { user } = useAuth()
  const toast = useToast()
  const passportQuery = useMyPassport(user?.id)
  // The name on the card is the customer's own, from their own profile — never
  // derived from a booking, which would be a name a shop typed for them.
  const profileQuery = useMyCustomerProfile(user?.id)
  const upsert = useUpsertMyPassport()
  const [editing, setEditing] = useState(false)

  const { register, handleSubmit, reset } = useForm<PassportFormValues>({
    defaultValues: { usualHaircut: '', fadeType: '', sideLength: '', topLength: '', beardPreferences: '', preferencesNotes: '' },
  })

  useEffect(() => {
    if (passportQuery.data) {
      reset({
        usualHaircut: passportQuery.data.usualHaircut ?? '',
        fadeType: passportQuery.data.fadeType ?? '',
        sideLength: passportQuery.data.sideLength ?? '',
        topLength: passportQuery.data.topLength ?? '',
        beardPreferences: passportQuery.data.beardPreferences ?? '',
        preferencesNotes: passportQuery.data.preferencesNotes ?? '',
      })
    }
  }, [passportQuery.data, reset])

  if (!user) return null

  if (passportQuery.isPending) {
    return <PageSpinner label={t('common:state.loadingEllipsis')} />
  }

  if (passportQuery.isError) {
    return (
      <div className="mx-auto w-full max-w-xl py-6">
        <ErrorState
          title={t('errorTitle')}
          description={passportQuery.error.message}
          action={
            <Button variant="secondary" onClick={() => void passportQuery.refetch()}>
              {t('common:action.tryAgain')}
            </Button>
          }
        />
      </div>
    )
  }

  async function onSubmit(values: PassportFormValues) {
    try {
      await upsert.mutateAsync({
        userId: user!.id,
        usualHaircut: values.usualHaircut.trim() || null,
        fadeType: values.fadeType.trim() || null,
        sideLength: values.sideLength.trim() || null,
        topLength: values.topLength.trim() || null,
        beardPreferences: values.beardPreferences.trim() || null,
        preferencesNotes: values.preferencesNotes.trim() || null,
      })
      toast.toast({ variant: 'success', title: t('saved') })
      setEditing(false)
    } catch (error) {
      toast.toast({ variant: 'error', title: t('errorTitle'), description: getErrorMessage(error) ?? undefined })
    }
  }

  const passport = passportQuery.data

  /**
   * Only what the customer actually filled in. A card that listed every field
   * with "Not set" beside most of them would look like an incomplete form,
   * which is precisely what the card exists to stop it being.
   */
  const cardEntries = [
    { key: 'usualHaircut', label: t('usualHaircut'), value: passport?.usualHaircut },
    { key: 'fadeType', label: t('fadeType'), value: passport?.fadeType },
    { key: 'sideLength', label: t('sideLength'), value: passport?.sideLength },
    { key: 'topLength', label: t('topLength'), value: passport?.topLength },
    { key: 'beardPreferences', label: t('beardPreferences'), value: passport?.beardPreferences },
  ].flatMap((entry) => (entry.value ? [{ key: entry.key, label: entry.label, value: entry.value }] : []))

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">{t('title')}</h1>
        <p className="mt-1 text-sm text-ink-500">{t('subtitle')}</p>
      </div>

      {/*
        THE CARD IS ALWAYS THERE (§18).

        It used to be an EmptyState with a "Create" button, which is the one
        shape §18 forbids: every customer already has a Fade Passport, and a
        button offering to create the thing you already have manufactures an
        action out of a state. An unfilled passport is now simply a card with
        nothing on it yet, and the form below is how you fill it.
      */}
      <PassportCard
        name={profileQuery.data?.displayName ?? user.email ?? ''}
        entries={cardEntries}
      />

      {editing ? (
        <Card className="p-5">
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <TextField label={t('usualHaircut')} {...register('usualHaircut')} />
            <TextField label={t('fadeType')} {...register('fadeType')} />
            <TextField label={t('sideLength')} {...register('sideLength')} />
            <TextField label={t('topLength')} {...register('topLength')} />
            <TextField label={t('beardPreferences')} {...register('beardPreferences')} />
            <Textarea label={t('preferencesNotes')} rows={3} maxLength={1000} {...register('preferencesNotes')} />
            <div className="flex gap-2">
              <Button type="submit" isLoading={upsert.isPending}>
                {t('save')}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
                {t('cancel')}
              </Button>
            </div>
          </form>
        </Card>
      ) : (
        <>
          {/*
            The read view is the CARD, not a second list under it.

            There used to be a panel here repeating all six fields with "Not
            set" beside the empty ones. Alongside the card that is the same
            information twice, and the "Not set" rows turn an identity artefact
            back into a half-finished form — which is exactly what the card was
            added to stop it being. Anything not filled in is simply not on the
            card; the form is where you see the blanks, because the form is
            where you fill them.
          */}
          {passport?.preferencesNotes ? (
            <p className="text-pretty text-sm text-ink-700">{passport.preferencesNotes}</p>
          ) : null}
          <Button variant="secondary" onClick={() => setEditing(true)} className="self-start">
            {t('edit')}
          </Button>
        </>
      )}

      {passport ? <PhotosSection userId={user.id} /> : null}
      {passport ? <SharesSection /> : null}
    </div>
  )
}

function PhotosSection({ userId }: { userId: string }) {
  const { t } = useTranslation('passport')
  const toast = useToast()
  const photosQuery = useMyPassportPhotos(userId)
  const uploadPhoto = useUploadPassportPhoto()
  const deletePhoto = useDeletePassportPhoto()
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      await uploadPhoto.mutateAsync({ userId, file })
    } catch (error) {
      toast.toast({ variant: 'error', title: t('photoError'), description: getErrorMessage(error) ?? undefined })
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500">{t('photosTitle')}</h2>

      {photosQuery.data && photosQuery.data.length > 0 ? (
        <ul className="mb-3 grid grid-cols-3 gap-2">
          {photosQuery.data.map((photo) => (
            <li key={photo.id} className="relative">
              {photo.signedUrl ? (
                <img src={photo.signedUrl} alt={photo.caption ?? ''} className="aspect-square w-full rounded-lg object-cover" />
              ) : (
                <div className="aspect-square w-full rounded-lg bg-paper-100" aria-hidden="true" />
              )}
              <button
                type="button"
                aria-label={t('removePhoto')}
                onClick={() => deletePhoto.mutate({ userId, photoId: photo.id, storagePath: photo.storagePath })}
                className="absolute end-1 top-1 rounded-full bg-ink-950/60 p-1.5 text-paper-0 hover:bg-ink-950/80"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-sm text-ink-500">{t('photosEmpty')}</p>
      )}

      {/*
        sr-only hides this visually but leaves it focusable and exposed to
        assistive tech, so without a name a keyboard user hit an anonymous
        "file upload" control just before the labelled button that drives it.
        The visible Button below is the real affordance — take the input out
        of the tab order and name it for anyone who reaches it anyway.
      */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(event) => void handleFileChange(event)}
        className="sr-only"
        id="passport-photo-input"
        tabIndex={-1}
        aria-label={t('addPhoto')}
      />
      <Button
        variant="secondary"
        size="sm"
        isLoading={uploadPhoto.isPending}
        leftIcon={<ImagePlus className="h-4 w-4" aria-hidden="true" />}
        onClick={() => fileInputRef.current?.click()}
      >
        {t('addPhoto')}
      </Button>
    </section>
  )
}

function SharesSection() {
  const { t } = useTranslation('passport')
  const toast = useToast()
  const sharesQuery = useMyPassportShares(true)
  const createShare = useCreatePassportShare()
  const revokeShare = useRevokePassportShare()
  const [freshLink, setFreshLink] = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function handleCreate() {
    try {
      const result = await createShare.mutateAsync({})
      const url = `${window.location.origin}/passport/shared/${result.token}`
      setFreshLink(url)
      setQrDataUrl(await QRCode.toDataURL(url, { width: 256, margin: 1 }))
      setCopied(false)
    } catch (error) {
      toast.toast({ variant: 'error', title: t('errorTitle'), description: getErrorMessage(error) ?? undefined })
    }
  }

  async function handleCopy() {
    if (!freshLink) return
    await navigator.clipboard.writeText(freshLink)
    setCopied(true)
  }

  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-ink-500">{t('shareTitle')}</h2>
      <p className="mb-3 text-sm text-ink-500">{t('shareDescription')}</p>

      {freshLink ? (
        <Card className="mb-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium text-ink-950">{t('shareCreated')}</p>
            <button type="button" aria-label={t('cancel')} onClick={() => setFreshLink(null)} className="text-ink-500 hover:text-ink-700">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          {qrDataUrl ? <img src={qrDataUrl} alt="" className="mx-auto mt-3 h-40 w-40" /> : null}
          <p className="mt-3 break-all rounded-md bg-paper-100 p-2 text-xs text-ink-700">{freshLink}</p>
          <Alert variant="info" className="mt-3">
            {t('shareOnce')}
          </Alert>
          <Button
            className="mt-3 w-full"
            variant="secondary"
            size="sm"
            leftIcon={copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
            onClick={() => void handleCopy()}
          >
            {copied ? t('copied') : t('copyLink')}
          </Button>
        </Card>
      ) : null}

      <Button
        variant="secondary"
        size="sm"
        isLoading={createShare.isPending}
        leftIcon={<QrCode className="h-4 w-4" aria-hidden="true" />}
        onClick={() => void handleCreate()}
      >
        {t('createShare')}
      </Button>

      {sharesQuery.data && sharesQuery.data.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-2">
          {sharesQuery.data.map((share) => {
            const isRevoked = share.revokedAt !== null
            const isExpired = !isRevoked && new Date(share.expiresAt).getTime() < Date.now()
            return (
              <li key={share.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-paper-0 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink-950">{share.label ?? t('shareTitle')}</p>
                  <p className="text-xs text-ink-500">
                    {t('shareExpires', { date: new Date(share.expiresAt).toLocaleDateString() })}
                  </p>
                </div>
                {isRevoked ? (
                  <Badge variant="neutral">{t('shareRevoked')}</Badge>
                ) : isExpired ? (
                  <Badge variant="neutral">{t('sharedExpiredTitle')}</Badge>
                ) : (
                  <Button variant="secondary" size="sm" onClick={() => revokeShare.mutate(share.id)}>
                    {t('revoke')}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-ink-500">{t('noShares')}</p>
      )}
    </section>
  )
}
