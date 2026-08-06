/**
 * Placeholder shown while an analysis is in flight.
 *
 * Mirrors the shape of the real results card — summary line, badge row, action
 * block — so the layout does not jump when the content lands, and the wait
 * reads as "this is loading" rather than "nothing happened".
 */
function ResultsSkeleton() {
  return (
    <div className="surface mt-6 p-5" aria-hidden="true">
      <div className="mb-5 flex items-center justify-between">
        <div className="skeleton h-3 w-16" />
        <div className="skeleton h-7 w-28" />
      </div>

      {/* Summary */}
      <div className="mb-5 space-y-2">
        <div className="skeleton h-4 w-4/5" />
        <div className="skeleton h-4 w-3/5" />
      </div>

      {/* Badge row */}
      <div className="mb-6 flex flex-wrap gap-x-6 gap-y-4">
        {[28, 20, 24, 22].map((width, i) => (
          <div key={i}>
            <div className="skeleton mb-2 h-2.5 w-14" />
            <div className="skeleton h-9" style={{ width: `${width * 4}px` }} />
          </div>
        ))}
      </div>

      {/* Recommended action */}
      <div className="mb-5">
        <div className="skeleton mb-2 h-2.5 w-32" />
        <div className="skeleton h-16 w-full" />
      </div>

      {/* Reasoning */}
      <div>
        <div className="skeleton mb-2 h-2.5 w-24" />
        <div className="skeleton h-14 w-full" />
      </div>
    </div>
  )
}

export default ResultsSkeleton
