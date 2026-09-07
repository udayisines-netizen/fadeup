import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/lib/cn'
import { useSignedPostMedia, type PostMedia } from '@/shared/data/postMedia'
import { MediaFrame } from '@/shared/ui/MediaFrame'

export interface PostGridItem {
  post_id: string
  caption: string | null
  media: PostMedia[]
}

export interface PostGridProps {
  posts: readonly PostGridItem[]
  /** Nom de l'auteur — libellés d'accessibilité des médias. */
  authorName: string
  className?: string
}

/**
 * Grille de réalisations (portfolio B4) — vignettes carrées, MediaFrame de
 * P1b. Le premier média de chaque post fait vignette ; un chemin qui ne se
 * signe pas rend l'état « média manquant » de première classe (fréquent sur
 * un profil scrapé, jamais maquillé).
 *
 * Pas de viewer : il appartient à P4. Les vignettes ne sont pas interactives
 * tant qu'il n'existe pas — une vignette cliquable vers rien serait un
 * cul-de-sac.
 */
export function PostGrid({ posts, authorName, className }: PostGridProps) {
  const { t } = useTranslation('v2')
  const firstPaths = posts
    .map((post) => [...post.media].sort((a, b) => a.position - b.position)[0]?.storage_path)
    .filter((path): path is string => Boolean(path))
  const signed = useSignedPostMedia(firstPaths)

  return (
    <div className={cn('grid grid-cols-3 gap-2', className)} data-testid="post-grid">
      {posts.map((post) => {
        const first = [...post.media].sort((a, b) => a.position - b.position)[0]
        const src = first ? (signed.data?.[first.storage_path] ?? null) : null
        return (
          <MediaFrame
            key={post.post_id}
            src={src}
            alt={post.caption?.trim() || t('profile.portfolio.mediaLabel', { name: authorName })}
            ratio="square"
            compact
          />
        )
      })}
    </div>
  )
}
