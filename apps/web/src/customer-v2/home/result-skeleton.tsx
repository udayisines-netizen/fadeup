/**
 * The exact geometry a result will occupy, drawn before it arrives.
 *
 * MOTION_SYSTEM.md §17 asks for stable skeletons and preserved layout. Every
 * block below matches a real element in `ProfessionalResult` — the identity tile
 * at both its phone and desktop sizes, the name line, the relationship line, the
 * operational strip and the Book control — so a row that lands where a skeleton
 * row was does not move.
 *
 * WHAT IT CANNOT PROMISE IS THE COUNT. An earlier version of this comment said
 * "the content lands without moving anything", and browser QA disproved it:
 * three skeleton rows per group against a live answer of one collapsed the page
 * from 1117px to 565px. The ROW geometry is exact; the number of rows is a
 * genuine unknown before the server answers, and claiming otherwise in a comment
 * is how a measured defect gets certified as correct.
 *
 * Two rows per group is the compromise — enough to read as a list rather than a
 * single placeholder, few enough that a sparse marketplace does not drop half a
 * viewport when the real answer arrives.
 *
 * Rendered only after `useDelayedFlag` has held for its delay, so a warm cache
 * never flashes this at all.
 *
 * It SWEEPS. The empty identity tile is STATIC. That is the difference between
 * "something is coming" and "there is nothing here", and it is why the two must
 * never share a treatment — the first human review read the old static striped
 * media well as a skeleton precisely because the two had drifted close enough
 * to be confused.
 */
export function ResultSkeleton({ count }: { count: number }) {
  return (
    <ul aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <li key={index} className="border-t border-v2-hairline">
          <div className="flex gap-3 px-3.5 py-3 md:gap-4 md:px-5 md:py-4 lg:gap-5 lg:px-6 lg:py-6">
            <div className="v2-skeleton h-14 w-14 shrink-0 rounded-full md:h-[4.5rem] md:w-[4.5rem] lg:h-24 lg:w-24" />
            <div className="min-w-0 flex-1">
              <div className="v2-skeleton h-[1.3125rem] w-2/5 rounded-v2-1" />
              <div className="v2-skeleton mt-1 h-[1.125rem] w-3/5 rounded-v2-1" />
              <div className="mt-1.5 flex items-center gap-3 lg:mt-3">
                <div className="v2-skeleton h-[1.125rem] w-1/2 rounded-v2-1" />
                <div className="v2-skeleton ms-auto h-11 w-[4.75rem] shrink-0 rounded-v2-2" />
              </div>
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}
