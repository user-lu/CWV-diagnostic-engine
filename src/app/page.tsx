import { DiagnosticForm } from './_components/diagnostic-form';

// Server Component shell. The single Server Action runs the PageSpeed audit and the crawl in
// parallel, so this ceiling must exceed the slower one: the 55s PSI abort in lib/pagespeed.ts
// (the crawl has its own 10s cap and finishes well inside it).
export const maxDuration = 60;

export default function Home() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4 sm:px-6">
          <div
            aria-hidden="true"
            className="flex size-8 items-center justify-center rounded-lg bg-slate-900 text-sm font-bold text-white"
          >
            H
          </div>
          <span className="text-sm font-semibold tracking-tight">Technical Health</span>
          <span className="ml-auto text-xs text-slate-500">Performance &amp; page structure</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Technical Health Diagnostic</h1>
          <p className="mt-1 text-sm text-slate-600">
            Core Web Vitals from PageSpeed Insights, plus the page&apos;s title, headings, images and
            structured data read straight from its HTML.
          </p>
        </div>

        <DiagnosticForm />
      </main>
    </div>
  );
}

// LEARNING NOTES: 
