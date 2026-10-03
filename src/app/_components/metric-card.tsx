import type { ReactNode } from 'react';
import type { MetricReading, Rating } from '@/types/pagespeed';

// No 'use client' needed: no hooks or browser APIs here. It still ships to the browser
// because a Client Component imports it, but it stays a plain presentational component.

interface RatingStyle {
  label: string;
  accent: string; // top border color
  value: string; // big number color
  badge: string; // pill
}

// IMPORTANT (Tailwind): class names must appear as COMPLETE static strings. Tailwind scans
// source text and can't see `border-t-${color}-500`, so that class would never be generated.
// That's why each rating maps to full literal class strings instead of building them.
//
// Colors approximate Google's CWV palette (green #0cce6b, orange #ffa400, red #ff4e42).
// Labels are text too, so meaning never depends on color alone (accessibility).
const RATING_STYLES: Record<Rating, RatingStyle> = {
  good: {
    label: 'Good',
    accent: 'border-t-green-500',
    value: 'text-green-600',
    badge: 'bg-green-50 text-green-700 ring-green-600/20',
  },
  'needs-improvement': {
    label: 'Needs improvement',
    accent: 'border-t-orange-500',
    value: 'text-orange-600',
    badge: 'bg-orange-50 text-orange-700 ring-orange-600/20',
  },
  poor: {
    label: 'Poor',
    accent: 'border-t-red-500',
    value: 'text-red-600',
    badge: 'bg-red-50 text-red-700 ring-red-600/20',
  },
};

// A missing metric (e.g. no field INP for a low-traffic page) is neutral, never "good".
const NO_DATA_STYLE: RatingStyle = {
  label: 'No data',
  accent: 'border-t-slate-300',
  value: 'text-slate-400',
  badge: 'bg-slate-50 text-slate-600 ring-slate-500/20',
};

interface MetricCardProps {
  label: string;
  description: string;
  reading: MetricReading | null;
}

export function MetricCard({ label, description, reading }: MetricCardProps) {
  const style = reading ? RATING_STYLES[reading.rating] : NO_DATA_STYLE;

  return (
    <article
      className={`rounded-xl border border-t-4 border-slate-200 bg-white p-5 shadow-sm ${style.accent}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{label}</h3>
          <p className="mt-0.5 text-xs text-slate-500">{description}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${style.badge}`}
        >
          {style.label}
        </span>
      </div>

      {/* tabular-nums keeps digits a fixed width so values don't jitter between runs */}
      <p className={`mt-4 text-3xl font-semibold tabular-nums ${style.value}`}>
        {reading ? reading.displayValue : '—'}
      </p>
    </article>
  );
}

interface MetricSectionProps {
  title: string;
  subtitle: string;
  children: ReactNode;
}

export function MetricSection({ title, subtitle, children }: MetricSectionProps) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        <p className="text-sm text-slate-500">{subtitle}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}
