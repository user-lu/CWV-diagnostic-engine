'use client'; // hooks only work in Client Components

import { useActionState } from 'react';
import { analyzeSite } from '@/app/actions';
import { describeActionFailure } from '@/lib/rate-limit-message';
import {
  isStrategy,
  STRATEGIES,
  type DiagnosticResult,
  type DiagnosticState,
} from '@/types/pagespeed';
import type { ImageInfo } from '@/types/crawl';
import { CrawlSection, CrawlSkeleton } from './crawl-section';
import { LcpElementCard } from './lcp-element-card';
import { MetricCard, MetricSection } from './metric-card';
import { RemediationPanel } from './remediation-panel';
import { ResultsSkeleton } from './results-skeleton';
import { Spinner } from './spinner';

const initialState: DiagnosticState = {
  status: 'idle',
  submitted: { url: '', strategy: 'mobile' },
};

// WHY THIS WRAPPER EXISTS: a 429 is produced by proxy.ts before the action runs, so the
// action's own try/catch never sees it. Next's client rejects the call instead, and an
// unhandled rejection from a useActionState action becomes a render error (the whole page
// swaps for the nearest error boundary). Catching here turns that rejection into state.
// Module scope keeps the function identity stable across renders.
async function analyzeSafely(prev: DiagnosticState, formData: FormData): Promise<DiagnosticState> {
  try {
    return await analyzeSite(prev, formData);
  } catch (err) {
    const rawUrl = formData.get('url');
    const rawStrategy = formData.get('strategy');
    return {
      status: 'error',
      // Keep what the user typed so the inputs don't blank out on failure.
      submitted: {
        url: typeof rawUrl === 'string' ? rawUrl.trim() : prev.submitted.url,
        strategy: isStrategy(rawStrategy) ? rawStrategy : prev.submitted.strategy,
      },
      message: describeActionFailure(err),
    };
  }
}

// Shared by the input and select. A full static string (see the Tailwind note in metric-card.tsx).
const FIELD_CLASS =
  'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500';

function ErrorMessage({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
    >
      {message}
    </p>
  );
}

function Results({ data, images }: { data: DiagnosticResult; images: readonly ImageInfo[] }) {
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="min-w-0 truncate text-sm font-medium text-slate-900" title={data.url}>
          {data.url}
        </p>
        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
          {data.strategy.toUpperCase()}
        </span>
        {/* Safe from hydration mismatches: this only renders after the action returns, never during SSR. */}
        <span className="text-xs text-slate-500">{new Date(data.fetchedAt).toLocaleString()}</span>
      </div>

      <MetricSection
        title="Lab data"
        subtitle="Simulated Lighthouse run on a throttled device. Good for debugging."
      >
        <MetricCard label="LCP" description="Largest Contentful Paint" reading={data.lab.lcp} />
        <MetricCard label="CLS" description="Cumulative Layout Shift" reading={data.lab.cls} />
      </MetricSection>

      <LcpElementCard element={data.lcpElement} images={images} />

      {data.field ? (
        <MetricSection
          title="Field data"
          subtitle="Real Chrome users over the last 28 days (75th percentile)."
        >
          <MetricCard label="LCP" description="Largest Contentful Paint" reading={data.field.lcp} />
          <MetricCard label="CLS" description="Cumulative Layout Shift" reading={data.field.cls} />
          <MetricCard label="INP" description="Interaction to Next Paint" reading={data.field.inp} />
        </MetricSection>
      ) : (
        <p className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
          No real-user data exists for this URL or its origin, so INP can&apos;t be reported.
        </p>
      )}

      {data.field?.scope === 'origin' && (
        <p className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
          Not enough traffic for this exact URL, so field numbers cover the whole site.
        </p>
      )}
    </div>
  );
}

export function DiagnosticForm() {
  // VANILLA JS vs REACT:
  // Vanilla JS would toggle a spinner by hand: show it, disable the button, await fetch(),
  // then hide it and write results into the DOM, with error paths easy to miss.
  // Here, `isPending` flips to true the moment the Server Action starts and back to false when it
  // resolves, and React re-renders. The UI below is a pure function of (state, isPending):
  // we never call show()/hide(), so the spinner can't get stuck on if a request fails.
  //
  // PHASE 4: this ONE hook covers both the PageSpeed audit and the HTML crawl. The server runs
  // them in parallel inside a single action and returns both results together, each with its
  // own success/error (`state.cwv` and `state.crawl`), so one failing can't blank the other.
  // analyzeSafely is the client try/catch around that call (see above).
  const [state, formAction, isPending] = useActionState(analyzeSafely, initialState);

  return (
    <div className="space-y-8">
      <form
        action={formAction}
        className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <div className="grid gap-4 sm:grid-cols-[1fr_11rem_auto] sm:items-end">
          <div>
            <label htmlFor="url" className="mb-1.5 block text-sm font-medium text-slate-700">
              Website URL
            </label>
            {/* defaultValue comes from the state the server echoed back, which is how the
                inputs keep the submitted values after React 19 resets the form post-action. */}
            <input
              id="url"
              name="url"
              type="text"
              placeholder="https://example.com"
              defaultValue={state.submitted.url}
              required
              disabled={isPending}
              className={FIELD_CLASS}
            />
          </div>

          <div>
            <label htmlFor="strategy" className="mb-1.5 block text-sm font-medium text-slate-700">
              Device
            </label>
            {/* WHY `key`: unlike <input>, React does NOT re-sync an uncontrolled <select>'s
                default selection when `defaultValue` changes after the first render. So the
                post-action form reset would snap it back to the very first default (MOBILE).
                Changing `key` makes React mount a fresh <select> whose default is the echoed
                value, so the reset lands on the strategy the user actually submitted. */}
            <select
              key={state.submitted.strategy}
              id="strategy"
              name="strategy"
              defaultValue={state.submitted.strategy}
              disabled={isPending}
              className={FIELD_CLASS}
            >
              {STRATEGIES.map((s) => (
                <option key={s} value={s}>
                  {s.toUpperCase()}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            disabled={isPending}
            className="inline-flex h-[38px] items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white shadow-sm hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending && <Spinner />}
            {isPending ? 'Analyzing…' : 'Analyze'}
          </button>
        </div>
      </form>

      {/* The live region is always mounted so screen readers announce content appearing in it.
          Exactly one branch renders inside. While pending, `state` still holds the PREVIOUS
          result, so we check isPending first to avoid showing stale numbers during a new run. */}
      <div aria-live="polite" className="space-y-8">
        {isPending ? (
          <>
            <ResultsSkeleton />
            <CrawlSkeleton />
          </>
        ) : (
          <>
            {(state.status === 'invalid' || state.status === 'error') && (
              <ErrorMessage message={state.message} />
            )}

            {/* Narrowing on `status` makes `state.cwv` / `state.crawl` type-safe here. */}
            {state.status === 'done' && (
              <>
                {state.cwv.status === 'error' ? (
                  <ErrorMessage message={state.cwv.message} />
                ) : (
                  <Results
                    data={state.cwv.data}
                    images={state.crawl.status === 'success' ? state.crawl.data.images : []}
                  />
                )}
                {/* CrawlSection accepts this Outcome as-is: it matches CrawlState's
                    'success' and 'error' variants. */}
                <CrawlSection state={state.crawl} />
              </>
            )}
          </>
        )}
      </div>

      {/* Rendered only once a crawl succeeded, and unmounted while a new analysis is pending.
          The key makes React discard the panel's state (old fixes) whenever a new crawl
          arrives. (Outside the live region above: the panel has its own.) */}
      {!isPending && state.status === 'done' && state.crawl.status === 'success' && (
        <RemediationPanel
          key={`${state.crawl.data.finalUrl}|${state.crawl.data.fetchedAt}`}
          crawl={state.crawl.data}
          // Both halves arrive from the same action, so they always belong to the same run.
          lcpElement={state.cwv.status === 'success' ? state.cwv.data.lcpElement : null}
        />
      )}
    </div>
  );
}
