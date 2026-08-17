import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Minus } from 'lucide-react'
import {
  CAPABILITIES,
  plansForMode,
  planHas,
  type CapabilityGroup,
  type CapabilityId,
} from '@/lib/commerce/plans'
import { useBusinessMode } from '@/components/for-business/business-mode'
import { cn } from '@/lib/cn'

/**
 * The detailed comparison — a real table, deliberately behind a disclosure.
 *
 * Somebody comparing Pro against Business needs every row. Everybody else needs
 * the pricing rail above and nothing more, and putting forty checkmarks in the
 * first pricing viewport is how a page loses the second group to buy nothing
 * from the first. So it collapses, and it opens on request.
 *
 * Three cell states, and the third is the point of the whole component:
 *
 *   ✓        included and shipped today
 *   Coming   packaged in this plan, not built yet — never a checkmark
 *   —        not in this plan
 *
 * A checkmark that means "we intend to build this" is a lie a pricing table
 * tells very efficiently, which is exactly why `CAPABILITIES[id].status` decides
 * the cell rather than plan membership alone.
 */

const GROUP_ORDER: CapabilityGroup[] = ['foundation', 'floor', 'retention', 'scale']

export function CapabilityComparison() {
  const { t } = useTranslation('landing')
  const { mode } = useBusinessMode()
  const [open, setOpen] = useState(false)

  const plans = plansForMode(mode)

  // Only rows that at least one plan in this family offers: a solo barber has no
  // use for a row that is empty in every column they can buy.
  const rows = (Object.keys(CAPABILITIES) as CapabilityId[]).filter((id) =>
    plans.some((plan) => planHas(plan.id, id)),
  )

  return (
    <div className="mt-10">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="capability-comparison"
        className="inline-flex min-h-12 items-center gap-2 rounded-lg border border-border-strong px-5 text-base font-medium text-ink-950 transition-colors hover:bg-paper-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600"
      >
        {open ? t('business.compare.hide') : t('business.compare.show')}
        <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>

      {open ? (
        <div id="capability-comparison" className="mt-6">
          {/*
            The table scrolls inside its own box rather than pushing the page
            sideways — three plan columns plus a label column does not fit 375px,
            and a horizontally scrolling BODY breaks every other section.

            `relative` is load-bearing, not decoration. The cells below carry
            `sr-only` labels, and Tailwind's sr-only is `position: absolute`. With
            no positioned ancestor those spans resolve against the initial
            containing block, escape this scroll container entirely, and drag the
            document 95px wide at 390px — a page that scrolls sideways, caused by
            text nobody can see. Making this element the containing block brings
            them back inside the clip.
          */}
          <div className="relative overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[34rem] border-collapse text-sm">
              <caption className="sr-only">{t('business.compare.caption')}</caption>
              <thead>
                <tr className="border-b border-border bg-paper-50">
                  <th scope="col" className="px-4 py-3 text-start font-medium text-ink-500">
                    {t('business.compare.feature')}
                  </th>
                  {plans.map((plan) => (
                    <th
                      key={plan.id}
                      scope="col"
                      className="px-4 py-3 text-center font-medium text-ink-950"
                    >
                      {t(`business.plans.${plan.id}.name`)}
                    </th>
                  ))}
                </tr>
              </thead>

              {GROUP_ORDER.map((group) => {
                const groupRows = rows.filter((id) => CAPABILITIES[id].group === group)
                if (groupRows.length === 0) return null

                return (
                  <tbody key={group}>
                    <tr className="border-b border-border bg-paper-50/60">
                      <th
                        scope="colgroup"
                        colSpan={plans.length + 1}
                        className="px-4 py-2 text-start text-[11px] font-medium uppercase tracking-[0.14em] text-ink-500"
                      >
                        {t(`business.capabilityGroups.${group}`)}
                      </th>
                    </tr>
                    {groupRows.map((id) => (
                      <tr key={id} className="border-b border-border last:border-b-0">
                        <th scope="row" className="px-4 py-3 text-start font-normal text-ink-950">
                          {t(`business.capabilities.${id}`)}
                        </th>
                        {plans.map((plan) => (
                          <td key={plan.id} className="px-4 py-3 text-center">
                            <Cell
                              included={planHas(plan.id, id)}
                              shipped={CAPABILITIES[id].status === 'live'}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                )
              })}
            </table>
          </div>

          <p className="mt-4 text-sm text-ink-500">{t('business.compare.plannedNote')}</p>
        </div>
      ) : null}
    </div>
  )
}

function Cell({ included, shipped }: { included: boolean; shipped: boolean }) {
  const { t } = useTranslation('landing')

  if (!included) {
    return (
      <>
        <Minus className="mx-auto h-4 w-4 text-ink-300" aria-hidden="true" />
        <span className="sr-only">{t('business.compare.notIncluded')}</span>
      </>
    )
  }

  if (!shipped) {
    return (
      <span className="inline-block rounded-full border border-dashed border-border-strong px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-ink-500">
        {t('business.compare.coming')}
      </span>
    )
  }

  return (
    <>
      <Check className="mx-auto h-4 w-4 text-accent-600" aria-hidden="true" />
      <span className="sr-only">{t('business.compare.included')}</span>
    </>
  )
}
