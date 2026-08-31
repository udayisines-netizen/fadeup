import { useState } from 'react'
import { Store, UserRound } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * Who or what a result is, as one small square of the row.
 *
 * ============================================================================
 * WHY THIS REPLACED THE 4:5 MEDIA WELL
 * ============================================================================
 *
 * The first pass gave every result a portrait media well, on the reasoning that
 * barbering is chosen on evidence of work and the frame therefore has to exist
 * before the photographs do. The reasoning was right and the size was wrong.
 *
 * FadeUp's schema exposes exactly three image columns — `professionals`,
 * `profiles` and `staff_profiles`, all `avatar_url` — and there is no portfolio
 * table and no organization image column at all. The RPC hard-codes
 * `null::text as barber_avatar_url` for every shop row. Against the live
 * database that is zero photographs on zero of two results, so "no image" was
 * never a fallback being designed defensively: it was the whole product,
 * rendered as a 92px block of grey texture that the human review read as an
 * unfinished skeleton.
 *
 * The fix is not a better empty texture. It is a frame small enough that being
 * empty costs the row nothing, and identical whether it is empty or full, so
 * the day a professional uploads an avatar the row gains a face without moving
 * a pixel.
 *
 * ============================================================================
 * THE SHAPE IS THE ENTITY TYPE
 * ============================================================================
 *
 * A barber is a circle, a shop is a rounded square. That convention costs no
 * badge, no label and no vertical space, and every consumer product the
 * blueprint names already teaches it — Instagram rounds people, X squares
 * organizations. It is the first half of how a customer tells a person from a
 * place at a glance; the second half is the row's own information hierarchy,
 * which is a professional's employer against an establishment's street address.
 *
 * The glyph underneath says the same thing a second time for anyone who has not
 * learned the shape convention yet. It is an outline mark, per
 * PRODUCT_UI_BLUEPRINT.md §2, and it is deliberately NOT a monogram: the same
 * §2 says not to make monograms the primary identity of professionals, and two
 * initials in a circle is exactly what the R5R.0 audit filed as a BLOCKER.
 *
 * ============================================================================
 * STATIC, BECAUSE THE SKELETON MOVES
 * ============================================================================
 *
 * `.v2-well-empty` paints a still two-stop fade. `.v2-skeleton` sweeps. That is
 * the entire difference between "there is no photo of this person" and "this
 * row has not loaded", and it is why they are two classes rather than one
 * shared grey.
 *
 * ============================================================================
 * DECORATIVE, SO SILENT
 * ============================================================================
 *
 * With no image the tile is `aria-hidden`: announcing "no photo" once per
 * result, in a list where nothing has photos, is noise a screen-reader user has
 * to listen through to reach the name. With an image it is a real `<img>`,
 * lazily loaded, falling back to the fade if the URL breaks so a dead link
 * never renders a broken-image glyph.
 *
 * `alt` stays the CALLER's decision. A row whose next element is a link naming
 * the professional passes `alt=""`, because an image duplicating adjacent text
 * is decorative by WCAG's own guidance.
 */
/**
 * DESIGN PASS A REVISION — the no-media system.
 *
 * The product owner's Fresha directive replaces the glyph-only empty state
 * with a branded identity fallback: INITIALS derived from the entity's real
 * name, set in the ink the rest of the row uses, on the same still two-stop
 * fade. This deliberately supersedes the earlier "no monograms" ruling — the
 * Design Pass A brief specifies "initials / FadeUp identity treatment" for
 * both entity kinds, and the shape convention (person = circle, place =
 * rounded square) still carries the entity type. When no name reaches the
 * tile the old glyph remains the last resort, so the fallback never renders
 * an empty circle.
 */
function initialsOf(name: string): string {
  const parts = name
    .split(/\s+/)
    .map((part) => part.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)
  if (parts.length === 0) return ''
  const first = [...parts[0]][0] ?? ''
  const second = parts.length > 1 ? ([...parts[parts.length - 1]][0] ?? '') : ''
  return (first + second).toLocaleUpperCase()
}

export function IdentityTile({
  src,
  alt,
  kind,
  name,
  className,
}: {
  /** A real image URL, or null when the backend genuinely has none. */
  src: string | null
  /** Required whenever `src` is set — who or what the photograph shows. */
  alt: string
  /** Which kind of thing this is. Decides the shape and the glyph. */
  kind: 'barber' | 'shop'
  /** The entity's real name; when given, the no-media state shows initials. */
  name?: string | null
  className?: string
}) {
  const [failed, setFailed] = useState<string | null>(null)
  // Keyed to the URL that actually failed, so replacing a dead avatar with a
  // working one shows the new photograph instead of staying a fade forever.
  const showImage = Boolean(src) && failed !== src

  const Glyph = kind === 'barber' ? UserRound : Store
  const initials = name ? initialsOf(name) : ''

  return (
    <div
      className={cn(
        'v2-well grid shrink-0 place-items-center',
        kind === 'barber' ? 'rounded-full' : 'rounded-v2-2',
        className,
      )}
      aria-hidden={showImage ? undefined : true}
    >
      {showImage ? (
        <img
          src={src ?? undefined}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(src)}
          className="h-full w-full object-cover"
        />
      ) : (
        <>
          {/* Design Pass A.1 §7: the honest-absence fade lands in the FadeUp
              green tint when initials carry the identity — a whisper of brand,
              not artwork — and stays neutral behind the last-resort glyph. */}
          <span
            className={
              initials ? 'v2-well-brand absolute inset-0' : 'v2-well-empty absolute inset-0'
            }
          />
          {initials ? (
            <span className="relative select-none text-[0.9em] font-semibold tracking-[0.02em] text-v2-green-ink">
              {initials}
            </span>
          ) : (
            <Glyph className="relative h-5 w-5 text-v2-ink-mute md:h-6 md:w-6" strokeWidth={1.6} />
          )}
        </>
      )}
    </div>
  )
}
