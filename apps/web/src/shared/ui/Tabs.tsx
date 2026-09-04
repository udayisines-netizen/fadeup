import * as RadixTabs from '@radix-ui/react-tabs'
import { cn } from '@/shared/lib/cn'

export interface TabItem {
  value: string
  label: string
  content: React.ReactNode
}

export interface TabsProps {
  /** Nom accessible de la liste d'onglets. */
  label: string
  items: TabItem[]
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  className?: string
}

/** Onglets de contenu (liste/carte, à venir/historique). Soulignement, pas de pilule. */
export function Tabs({ label, items, value, defaultValue, onValueChange, className }: TabsProps) {
  return (
    <RadixTabs.Root
      value={value}
      defaultValue={defaultValue ?? items[0]?.value}
      onValueChange={onValueChange}
      className={className}
    >
      <RadixTabs.List aria-label={label} className="flex gap-1 border-b border-[var(--fu-border)]">
        {items.map((item) => (
          <RadixTabs.Trigger
            key={item.value}
            value={item.value}
            className={cn(
              'relative min-h-11 px-3 text-fu-sm font-medium text-[var(--fu-text-secondary)]',
              'transition-colors duration-[var(--fu-dur-instant)] ease-[var(--fu-ease)] hover:text-[var(--fu-text-primary)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--fu-focus)]',
              'data-[state=active]:text-[var(--fu-text-primary)]',
              'data-[state=active]:after:absolute data-[state=active]:after:inset-x-2 data-[state=active]:after:bottom-0',
              'data-[state=active]:after:h-0.5 data-[state=active]:after:bg-[var(--fu-accent)] data-[state=active]:after:content-[""]',
            )}
          >
            {item.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {items.map((item) => (
        <RadixTabs.Content
          key={item.value}
          value={item.value}
          className="pt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)]"
        >
          {item.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  )
}
