import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Container } from '@/components/ui/container'
import { ProductStage } from '@/components/for-business/product-stage'
import { StageProgress } from '@/components/for-business/stage-progress'
import { useBusinessMode } from '@/components/for-business/business-mode'
import type { SceneId } from '@/components/for-business/scenes'

/**
 * The professional scrollytelling: four stages, one product environment.
 *
 * Two things changed here after the first pass, and both were about nesting.
 *
 * The product used to sit inside a frosted panel, which sat inside a section,
 * inside a container. Three frames around one interface, so the eye kept
 * landing on boxes instead of on the product. The interface now sits directly
 * in the dark composition, defined by its own shape and the light behind it.
 *
 * There was also a floating card announcing "customer arrived, Malik R." over
 * the canvas. It explained in words what the interface was already showing,
 * which is the definition of a caption nobody needs. The product now carries
 * the event itself: the queue gains a row, a chair becomes occupied, a
 * passport opens.
 *
 * Composition:
 *   lg and up — sticky canvas beside the scrolling narrative, with the
 *               progress marks pinned at the left edge of the text column.
 *   below lg  — each stage stacks with its own canvas inline, progress marks
 *               laid out horizontally. A sticky half-screen panel on a phone
 *               eats the viewport and turns scrolling into a fight.
 *
 * Accessibility: every stage is a real section with a real heading and real
 * prose, and the canvas is `aria-hidden` because it restates the copy beside
 * it. Remove the motion and the argument is still there, in order.
 */

interface Stage {
  key: 'one' | 'two' | 'three' | 'four'
  /** Which product world the canvas shows while this stage is being read. */
  scene: SceneId
}

const STAGES: Stage[] = [
  { key: 'one', scene: 'today' },
  { key: 'two', scene: 'queue' },
  { key: 'three', scene: 'chair' },
  { key: 'four', scene: 'passport' },
]

/**
 * Which stage sits in the middle of the viewport.
 *
 * IntersectionObserver across a narrow centre band rather than scroll-offset
 * arithmetic: it survives variable copy length, font loading and zoom, none of
 * which a hardcoded pixel schedule does. One observer, no work per frame.
 */
function useActiveStage(count: number) {
  const [active, setActive] = useState(0)
  const nodes = useRef<(HTMLElement | null)[]>([])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const index = nodes.current.indexOf(entry.target as HTMLElement)
          if (index >= 0) setActive(index)
        }
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 },
    )
    for (const node of nodes.current) if (node) observer.observe(node)
    return () => observer.disconnect()
  }, [count])

  const setNode = (index: number) => (node: HTMLElement | null) => {
    nodes.current[index] = node
  }

  return { active, setNode, nodes }
}

export function Scrollytelling() {
  const { t } = useTranslation('landing')
  const { mode } = useBusinessMode()
  const reduced = useReducedMotion()
  const { active, setNode, nodes } = useActiveStage(STAGES.length)
  const stage = STAGES[active] ?? STAGES[0]!

  const titles = STAGES.map((item) => t(`business.stages.${item.key}.title`))

  const goToStage = useCallback(
    (index: number) => {
      nodes.current[index]?.scrollIntoView({
        block: 'center',
        behavior: reduced ? 'auto' : 'smooth',
      })
    },
    [nodes, reduced],
  )

  return (
    <section id="product" className="relative bg-[var(--pro-bg)]">
      <Container size="xl">
        <div className="lg:grid lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <div className="relative">
            {/*
              The marks travel with the reader on desktop, pinned to the inner
              edge of the text column so they never collide with navigation.
            */}
            <div
              className="pointer-events-none sticky top-0 z-10 hidden h-svh lg:block"
              style={{ '--progress-w-active': '0.375rem', '--progress-h-active': '2rem' } as React.CSSProperties}
            >
              <div className="pointer-events-auto absolute -start-8 top-1/2 -translate-y-1/2">
                <StageProgress count={STAGES.length} active={active} titles={titles} onSelect={goToStage} />
              </div>
            </div>

            {/* Desktop pins the marks above; on mobile they sit under the heading. */}
            <div className="lg:-mt-svh">
              {STAGES.map((item, index) => (
                <StageBlock
                  key={item.key}
                  stage={item}
                  index={index}
                  mode={mode}
                  onSelectStage={goToStage}
                  titles={titles}
                  ref={setNode(index)}
                />
              ))}
            </div>
          </div>

          <div className="hidden lg:block" aria-hidden="true">
            <div className="sticky top-0 flex h-svh items-center py-16">
              <ProductCanvas scene={stage.scene} mode={mode} />
            </div>
          </div>
        </div>
      </Container>
    </section>
  )
}

/**
 * The environment the whole story happens inside.
 *
 * No frame. One pool of emerald light behind the interface gives it somewhere
 * to sit, and the interface itself supplies the shape. What changes between
 * stages is the product, not the packaging, which is what makes four stages
 * read as one system rather than four products.
 */
function ProductCanvas({
  scene,
  mode,
}: {
  scene: SceneId
  mode: ReturnType<typeof useBusinessMode>['mode']
}) {
  const reduced = useReducedMotion()

  return (
    <div className="relative w-full">
      <div aria-hidden="true" className="pro-ambient inset-0 scale-125 opacity-70" />

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={scene}
          className="relative drop-shadow-[0_40px_70px_rgba(0,0,0,0.55)]"
          initial={reduced ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? undefined : { opacity: 0, y: -12 }}
          transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
        >
          <ProductStage scene={scene} mode={mode} />
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

/** React 19 passes `ref` as an ordinary prop, so no forwardRef wrapper is needed. */
function StageBlock({
  stage,
  index,
  mode,
  titles,
  onSelectStage,
  ref,
}: {
  stage: Stage
  index: number
  mode: ReturnType<typeof useBusinessMode>['mode']
  titles: string[]
  onSelectStage: (index: number) => void
  ref: (node: HTMLElement | null) => void
}) {
  const { t } = useTranslation('landing')
  const reduced = useReducedMotion()
  const extra = stage.key === 'four' ? t('business.stages.four.extra') : null

  return (
    <section ref={ref} className="flex flex-col justify-center py-20 sm:py-24 lg:min-h-svh lg:py-28">
      <motion.div
        initial={reduced ? false : { opacity: 0, y: 22 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-100px' }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <span className="font-mono text-sm tabular-nums text-[var(--pro-highlight)]">
          {String(index + 1).padStart(2, '0')}
        </span>

        <h2 className="pro-title mt-5 text-[clamp(1.75rem,3.2vw,2.5rem)]">
          {t(`business.stages.${stage.key}.title`)}
        </h2>

        <p className="pro-body mt-5 max-w-md text-base sm:text-lg">
          {t(`business.stages.${stage.key}.body`)}
        </p>

        {/*
          Stage four carries a second short paragraph: retention and discovery
          are one idea, and splitting them into a fifth stage would make the
          marketplace read as an unrelated feature bolted on at the end.
        */}
        {extra ? <p className="pro-body mt-4 max-w-md text-base">{extra}</p> : null}
      </motion.div>

      {/* Mobile: marks under the copy, then the canvas for this stage. */}
      <div
        className="mt-8 lg:hidden"
        style={{ '--progress-w-active': '2rem', '--progress-h-active': '0.375rem' } as React.CSSProperties}
      >
        <StageProgress count={4} active={index} titles={titles} onSelect={onSelectStage} />
      </div>

      <div className="mt-8 lg:hidden" aria-hidden="true">
        <ProductCanvas scene={stage.scene} mode={mode} />
      </div>
    </section>
  )
}
