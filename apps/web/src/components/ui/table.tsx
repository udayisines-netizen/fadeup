import { forwardRef, type HTMLAttributes, type ReactNode, type TdHTMLAttributes, type ThHTMLAttributes } from 'react'
import { ChevronDown, ChevronsUpDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/cn'

/** Scrollable wrapper with a CSS-only scroll-shadow affordance — never let a wide table silently overflow. */
export const Table = forwardRef<HTMLTableElement, HTMLAttributes<HTMLTableElement> & { label?: string }>(
  function Table({ className, label, ...props }, ref) {
    return (
      <div
        className="fu-scroll-shadow-x w-full overflow-x-auto rounded-lg border border-border"
        tabIndex={0}
        role="region"
        aria-label={label}
      >
        <table ref={ref} className={cn('w-full min-w-max border-collapse text-sm', className)} {...props} />
      </div>
    )
  },
)

export function TableHeader({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('bg-paper-50 text-left text-xs font-medium text-ink-500', className)} {...props} />
}

export function TableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('divide-y divide-border', className)} {...props} />
}

export function TableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('transition-colors hover:bg-paper-50', className)} {...props} />
}

interface TableHeadProps extends ThHTMLAttributes<HTMLTableCellElement> {
  sortDirection?: 'asc' | 'desc' | false
  onSort?: () => void
}

export function TableHead({ className, children, sortDirection, onSort, ...props }: TableHeadProps) {
  if (onSort) {
    const SortIcon = sortDirection === 'asc' ? ChevronUp : sortDirection === 'desc' ? ChevronDown : ChevronsUpDown

    return (
      <th
        scope="col"
        aria-sort={sortDirection ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
        className={cn('whitespace-nowrap px-4 py-3 font-medium', className)}
        {...props}
      >
        <button
          type="button"
          onClick={onSort}
          className="inline-flex items-center gap-1 rounded-sm text-xs font-medium text-ink-500 hover:text-ink-950"
        >
          {children}
          <SortIcon className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </th>
    )
  }

  return (
    <th scope="col" className={cn('whitespace-nowrap px-4 py-3 font-medium', className)} {...props}>
      {children}
    </th>
  )
}

export function TableCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-4 py-3 align-middle text-ink-800', className)} {...props} />
}

/** Full-width row for loading/empty/error states inside a `<tbody>` — pass `colSpan` matching the column count. */
export function TableStateRow({
  colSpan,
  children,
}: {
  colSpan: number
  children: ReactNode
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="p-0">
        {children}
      </td>
    </tr>
  )
}
