// Mirrors the real layout (2 lab cards, 3 field cards) so nothing jumps when data arrives.

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-t-4 border-slate-200 border-t-slate-300 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="h-4 w-12 rounded bg-slate-200" />
          <div className="h-3 w-28 rounded bg-slate-200" />
        </div>
        <div className="h-5 w-16 rounded-full bg-slate-200" />
      </div>
      <div className="mt-5 h-9 w-24 rounded bg-slate-200" />
    </div>
  );
}

function SkeletonSection({ cards }: { cards: number }) {
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="h-5 w-40 rounded bg-slate-200" />
        <div className="h-3 w-64 rounded bg-slate-200" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: cards }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  );
}

export function ResultsSkeleton() {
  return (
    // role="status" announces the loading text to screen readers; the gray shapes are decorative.
    <div role="status" className="animate-pulse space-y-8">
      <span className="sr-only">Analyzing page. This can take up to 30 seconds.</span>
      <SkeletonSection cards={2} />
      <div className="h-40 rounded-xl border border-slate-200 bg-white shadow-sm" />
      <SkeletonSection cards={3} />
    </div>
  );
}
