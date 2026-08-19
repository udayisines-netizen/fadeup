import { Link } from 'react-router-dom'
import { Container } from '@/components/ui/container'
import { buttonVariants } from '@/components/ui/button'
import { useTranslation } from 'react-i18next'

export function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-paper-50 p-8">
      <Container size="sm" className="flex flex-col items-center gap-4 text-center">
        <p className="text-sm font-medium text-accent-600">404</p>
        <h1 className="text-3xl font-semibold text-balance text-ink-950">{t('common:notFound.pageNotFound')}</h1>
        <p className="text-sm text-ink-500">
          The page you&apos;re looking for doesn&apos;t exist or has moved.
        </p>
        <Link to="/" className={buttonVariants({ variant: 'secondary' }, 'mt-2')}>
          {t('common:notFound.backHome')}
        </Link>
      </Container>
    </main>
  )
}
