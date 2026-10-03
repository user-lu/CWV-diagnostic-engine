'use client'; // CopyButton holds state and calls navigator.clipboard, which is browser-only

import { useEffect, useRef, useState } from 'react';
import type { Recommendation } from '@/types/remediation';

type CopyStatus = 'idle' | 'copied' | 'failed';

const FEEDBACK_MS = 2000;

function CopyButton({ text }: { text: string }) {
  // VANILLA JS vs REACT: vanilla would set button.textContent = 'Copied', then schedule a
  // second DOM write to revert it. Here we only change `status`; React re-renders the label,
  // and the markup is always a pure function of that one value.
  const [status, setStatus] = useState<CopyStatus>('idle');

  // A ref is a box React keeps between renders WITHOUT re-rendering when it changes. It's
  // the right home for a timer id (like a `let timerId` in a vanilla closure).
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Vanilla equivalent: removeEventListener / clearTimeout on teardown. The effect's cleanup
  // runs when the card unmounts (e.g. after "Regenerate"), so a pending timer can never call
  // setStatus on a component that no longer exists.
  useEffect(() => {
    return () => {
      if (resetTimer.current !== null) clearTimeout(resetTimer.current);
    };
  }, []);

  async function handleCopy() {
    let next: CopyStatus;
    try {
      // Modern async Clipboard API. It needs a secure context (https or localhost) and
      // transient user activation, which a click handler provides. Where it's unavailable
      // `navigator.clipboard` is undefined and this line throws, which we report as 'failed'.
      await navigator.clipboard.writeText(text);
      next = 'copied';
    } catch {
      next = 'failed';
    }
    setStatus(next);

    // Restart the countdown so rapid clicks don't let an old timer reset the new label early.
    if (resetTimer.current !== null) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setStatus('idle'), FEEDBACK_MS);
  }

  return (
    <>
      <button
        type="button"
        onClick={handleCopy}
        className="rounded-md px-2 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-400"
      >
        {status === 'copied' ? 'Copied' : status === 'failed' ? 'Copy failed' : 'Copy'}
      </button>
      {/* Announces the outcome to screen readers; a changing button label alone isn't announced. */}
      <span role="status" className="sr-only">
        {status === 'copied' ? 'Code copied to clipboard' : status === 'failed' ? 'Copy failed' : ''}
      </span>
    </>
  );
}

function FixCard({ rec }: { rec: Recommendation }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="p-5">
        <h3 className="text-sm font-semibold text-slate-900">{rec.element}</h3>
        <p className="mt-1 text-sm text-slate-600">{rec.issue}</p>
      </div>

      <div className="rounded-b-xl bg-slate-900">
        <div className="flex items-center justify-between border-t border-slate-800 px-4 py-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Suggested fix
          </span>
          <CopyButton text={rec.codeFix} />
        </div>
        {/* Rendered as a text child, so React escapes it. LLM output must never reach
            dangerouslySetInnerHTML: a snippet is data to display, not markup to run. */}
        <pre className="overflow-x-auto px-4 pb-4 text-xs leading-relaxed text-slate-100">
          <code>{rec.codeFix}</code>
        </pre>
      </div>

      {rec.codeFix.includes('REPLACE_') && (
        <p className="rounded-b-xl border-t border-orange-200 bg-orange-50 px-5 py-2 text-xs text-orange-800">
          Replace each <code>REPLACE_*</code> placeholder with the real value. The AI can&apos;t see
          your image files.
        </p>
      )}
    </article>
  );
}

interface ActionableFixesProps {
  recommendations: readonly Recommendation[];
  dropped: number;
}

export function ActionableFixes({ recommendations, dropped }: ActionableFixesProps) {
  return (
    <div className="space-y-4">
      {recommendations.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
          The model found nothing to fix in the markup it was given.
        </p>
      ) : (
        recommendations.map((rec, i) => <FixCard key={i} rec={rec} />)
      )}

      {dropped > 0 && (
        <p className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
          {dropped} suggestion{dropped === 1 ? ' was' : 's were'} removed because{' '}
          {dropped === 1 ? 'it' : 'they'} contained script or event-handler markup.
        </p>
      )}
    </div>
  );
}

export function FixesSkeleton() {
  return (
    <div role="status" className="animate-pulse space-y-4">
      <span className="sr-only">Generating fixes. This can take up to 40 seconds.</span>
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="space-y-2 p-5">
            <div className="h-4 w-40 rounded bg-slate-200" />
            <div className="h-3 w-full rounded bg-slate-200" />
            <div className="h-3 w-2/3 rounded bg-slate-200" />
          </div>
          <div className="h-20 rounded-b-xl bg-slate-200" />
        </div>
      ))}
    </div>
  );
}
