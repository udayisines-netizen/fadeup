import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Store } from 'lucide-react'
import { useCurrentOrg } from '@/lib/current-org-context'
import {
  useOrganizationMarketplaceVisibility,
  useSetMarketplaceVisibility,
} from '@/lib/queries/organization-marketplace'
import { guessTimezone } from '@/lib/timezone'
import {
  useCreateLocation,
  useOrgLocations,
  useUpdateLocation,
  type Location,
  type LocationInput,
} from '@/lib/queries/locations'
import { TextField } from '@/components/ui/text-field'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableStateRow } from '@/components/ui/table'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import type { MembershipRole } from '@/lib/types'
import { getErrorMessage } from '@/lib/get-error-message'

const MANAGING_ROLES = new Set<MembershipRole>(['owner', 'manager'])

const locationSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  addressLine1: z.string(),
  addressLine2: z.string(),
  city: z.string(),
  region: z.string(),
  postalCode: z.string(),
  country: z.string(),
  timezone: z.string().min(1, 'Timezone is required'),
  isActive: z.boolean(),
})

type LocationFormValues = z.infer<typeof locationSchema>

type DialogState = { mode: 'create' } | { mode: 'edit'; location: Location } | null

function formatAddress(location: Location): string {
  const parts = [location.city, location.region, location.country].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : '—'
}

export function AppLocationsPage() {
  const { currentMembership } = useCurrentOrg()

  if (!currentMembership) return null

  return <LocationsManagement organizationId={currentMembership.organizationId} role={currentMembership.role} />
}

/**
 * The shop's own decision about whether customers can find it in public
 * search.
 *
 * `organizations.marketplace_visible` has always defaulted to false — being
 * on FadeUp and being publicly listed are separate choices, deliberately. But
 * nothing in the product could flip it, so no genuine shop could ever appear
 * in the marketplace and search returned only seeded development rows. This
 * card is that missing decision, and it lives here because Locations is
 * already where a shop manages its physical, customer-facing presence.
 */
function MarketplaceVisibilityCard({ organizationId }: { organizationId: string }) {
  const { toast } = useToast()
  const visibilityQuery = useOrganizationMarketplaceVisibility(organizationId)
  const setVisibility = useSetMarketplaceVisibility(organizationId)

  if (visibilityQuery.isPending || !visibilityQuery.data) return null

  const { marketplaceVisible, slug } = visibilityQuery.data

  async function handleToggle(next: boolean) {
    try {
      await setVisibility.mutateAsync(next)
      toast({
        variant: 'success',
        title: next ? 'Your shop is now listed on FadeUp' : 'Your shop is no longer listed',
      })
    } catch (error) {
      toast({
        variant: 'error',
        title: "Couldn't update marketplace visibility",
        description: error instanceof Error ? error.message : undefined,
      })
    }
  }

  return (
    <Card className="mt-6 p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-xl">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-950">
            <Store className="h-4 w-4 text-ink-500" aria-hidden="true" />
            Your shop on FadeUp
          </h2>
          <p className="mt-1 text-sm text-ink-500">
            {marketplaceVisible
              ? 'Customers can find you in FadeUp search and book with your team.'
              : 'Your shop is private. Turn this on to appear in FadeUp search for customers nearby.'}
          </p>
          {marketplaceVisible ? (
            <Link
              to={`/s/${slug}/profile`}
              className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-accent-700 underline underline-offset-2"
            >
              View your public profile
            </Link>
          ) : null}
        </div>
        <Switch
          label="Listed publicly"
          checked={marketplaceVisible}
          disabled={setVisibility.isPending}
          onChange={(event) => void handleToggle(event.target.checked)}
        />
      </div>
    </Card>
  )
}

function LocationsManagement({ organizationId, role }: { organizationId: string; role: MembershipRole }) {
  const { toast } = useToast()
  const canManage = MANAGING_ROLES.has(role)
  const locationsQuery = useOrgLocations(organizationId)
  const [dialogState, setDialogState] = useState<DialogState>(null)

  const columnCount = canManage ? 5 : 4

  function handleSaved(message: string) {
    toast({ title: message, variant: 'success' })
    setDialogState(null)
  }

  return (
    <Container size="lg" className="py-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink-950">Locations</h1>
          <p className="mt-1 text-sm text-ink-500">Shops and addresses for your organization.</p>
        </div>
        {canManage ? <Button onClick={() => setDialogState({ mode: 'create' })}>Add location</Button> : null}
      </div>

      {canManage ? <MarketplaceVisibilityCard organizationId={organizationId} /> : null}

      <div className="mt-6">
        {locationsQuery.isPending ? (
          <LocationsSkeleton />
        ) : locationsQuery.isError ? (
          <ErrorState
            title="Couldn't load locations"
            description={locationsQuery.error.message}
            action={
              <Button variant="secondary" onClick={() => void locationsQuery.refetch()}>
                Try again
              </Button>
            }
          />
        ) : (
          <Table label="Locations">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Timezone</TableHead>
                <TableHead>Status</TableHead>
                {canManage ? (
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {locationsQuery.data.length === 0 ? (
                <TableStateRow colSpan={columnCount}>
                  <EmptyState
                    title="No locations yet"
                    description={
                      canManage
                        ? 'Add your first location to get started.'
                        : 'Your organization has no locations yet.'
                    }
                    action={
                      canManage ? (
                        <Button size="sm" onClick={() => setDialogState({ mode: 'create' })}>
                          Add location
                        </Button>
                      ) : undefined
                    }
                    className="border-none"
                  />
                </TableStateRow>
              ) : (
                locationsQuery.data.map((location) => (
                  <TableRow key={location.id}>
                    <TableCell className="font-medium text-ink-950">{location.name}</TableCell>
                    <TableCell>{formatAddress(location)}</TableCell>
                    <TableCell className="whitespace-nowrap">{location.timezone}</TableCell>
                    <TableCell>
                      <Badge variant={location.isActive ? 'success' : 'neutral'}>
                        {location.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    {canManage ? (
                      <TableCell className="text-right">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setDialogState({ mode: 'edit', location })}
                        >
                          Edit
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </div>

      {dialogState ? (
        <LocationFormDialog
          key={dialogState.mode === 'edit' ? dialogState.location.id : 'create'}
          organizationId={organizationId}
          location={dialogState.mode === 'edit' ? dialogState.location : null}
          onClose={() => setDialogState(null)}
          onSaved={handleSaved}
        />
      ) : null}
    </Container>
  )
}

function LocationFormDialog({
  organizationId,
  location,
  onClose,
  onSaved,
}: {
  organizationId: string
  location: Location | null
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const isEdit = Boolean(location)
  const createLocation = useCreateLocation()
  const updateLocation = useUpdateLocation()
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LocationFormValues>({
    resolver: zodResolver(locationSchema),
    defaultValues: {
      name: location?.name ?? '',
      addressLine1: location?.addressLine1 ?? '',
      addressLine2: location?.addressLine2 ?? '',
      city: location?.city ?? '',
      region: location?.region ?? '',
      postalCode: location?.postalCode ?? '',
      country: location?.country ?? '',
      timezone: location?.timezone ?? guessTimezone(),
      isActive: location?.isActive ?? true,
    },
  })

  async function onSubmit(values: LocationFormValues) {
    setFormError(null)

    const payload: LocationInput = {
      organizationId,
      name: values.name,
      addressLine1: values.addressLine1 || null,
      addressLine2: values.addressLine2 || null,
      city: values.city || null,
      region: values.region || null,
      postalCode: values.postalCode || null,
      country: values.country || null,
      timezone: values.timezone,
      isActive: values.isActive,
    }

    try {
      if (isEdit && location) {
        await updateLocation.mutateAsync({ id: location.id, ...payload })
        onSaved('Location updated')
      } else {
        await createLocation.mutateAsync(payload)
        onSaved('Location created')
      }
    } catch (error) {
      setFormError(getErrorMessage(error) ?? 'Something went wrong.')
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit location' : 'Add location'}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update this location's details." : 'Add a new shop location for your organization.'}
          </DialogDescription>
        </DialogHeader>
        {/*
          The footer sits OUTSIDE the scroll area so Cancel/Save stay reachable
          however many fields there are; only the fields scroll. Previously the
          footer lived inside a `max-h-[70vh]` scroller and the dialog itself
          had no height cap, so on a 768px-tall screen the buttons were pushed
          off the bottom of the window entirely.
        */}
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="flex flex-col gap-4">
            {formError ? <Alert variant="error">{formError}</Alert> : null}

            <TextField label="Name" error={errors.name?.message} {...register('name')} />
            <TextField label="Address line 1" {...register('addressLine1')} />
            <TextField label="Address line 2" {...register('addressLine2')} />
            <div className="grid grid-cols-2 gap-4">
              <TextField label="City" {...register('city')} />
              <TextField label="Region / state" {...register('region')} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <TextField label="Postal code" {...register('postalCode')} />
              <TextField label="Country" {...register('country')} />
            </div>
            <TextField
              label="Timezone"
              hint="IANA name, e.g. America/New_York"
              error={errors.timezone?.message}
              {...register('timezone')}
            />
            <Switch label="Active" description="Inactive locations are hidden from booking." {...register('isActive')} />
          </DialogBody>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" isLoading={isSubmitting}>
              {isEdit ? 'Save changes' : 'Add location'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function LocationsSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-4" aria-hidden="true">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-3/4" />
    </div>
  )
}
