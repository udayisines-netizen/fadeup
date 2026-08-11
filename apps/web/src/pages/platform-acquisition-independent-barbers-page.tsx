import { ProspectsListView } from '@/components/acquisition/prospects-list'

/** /platform/acquisition/independent-barbers — the shared prospects table, preset to type=independent_barber. */
export function PlatformAcquisitionIndependentBarbersPage() {
  return <ProspectsListView presetType="independent_barber" />
}
