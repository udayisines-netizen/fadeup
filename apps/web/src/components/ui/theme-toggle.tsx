import { Monitor, Moon, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { buttonVariants } from '@/components/ui/button'
import { useTheme, type Theme } from '@/lib/theme'
import { useAuth } from '@/lib/auth-context'
import { useUpdateProfilePreferences } from '@/lib/queries/profile'
import { cn } from '@/lib/cn'

const THEME_ICONS: Record<Theme, typeof Sun> = { light: Sun, dark: Moon, system: Monitor }

/** Light/dark/system toggle — persists to localStorage always, and to the user's profile when authenticated. */
export function ThemeToggle({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { theme, resolvedTheme, setTheme } = useTheme()
  const { user } = useAuth()
  const updatePreferences = useUpdateProfilePreferences(user?.id)

  const ActiveIcon = THEME_ICONS[theme]

  function handleSelect(next: Theme) {
    setTheme(next)
    if (user) updatePreferences.mutate({ theme: next })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'px-2', className)}
        aria-label={t('theme.toggleLabel')}
      >
        <ActiveIcon className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only">
          {t('theme.toggleLabel')}: {t(`theme.${theme}`)} ({resolvedTheme})
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {(['light', 'dark', 'system'] as const).map((option) => {
          const Icon = THEME_ICONS[option]
          return (
            <DropdownMenuItem key={option} onSelect={() => handleSelect(option)} aria-checked={theme === option} role="menuitemradio">
              <Icon className="h-4 w-4" aria-hidden="true" />
              {t(`theme.${option}`)}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
