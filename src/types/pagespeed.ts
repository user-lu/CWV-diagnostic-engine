import type { CrawlResult } from './crawl';

// ---------- Runtime-checkable strategy ----------
// `as const` gives us BOTH a runtime array (for validation + rendering <option>s)
// and a union type from one source of truth.
export const STRATEGIES = ['mobile', 'desktop'] as const;
export type Strategy = (typeof STRATEGIES)[number];

export function isStrategy(value: unknown): value is Strategy {
  return typeof value === 'string' && (STRATEGIES as readonly string[]).includes(value);
}

// ---------- Google PSI v5 response (only the slices we read) ----------

export type ScoreDisplayMode =
  | 'numeric'
  | 'binary'
  | 'manual'
  | 'informative'
  | 'notApplicable'
  | 'error';

export type LabAuditId =
  | 'largest-contentful-paint'
  | 'cumulative-layout-shift'
  | 'largest-contentful-paint-element' // Lighthouse <= 12
  | 'lcp-breakdown-insight' // Lighthouse >= 13 (the former audit was folded into insights)
  | 'lcp-discovery-insight'; // Lighthouse >= 13 alternate home for the same node

export interface LabAudit {
  id: LabAuditId;
  title: string;
  score: number | null;
  scoreDisplayMode: ScoreDisplayMode;
  /** LCP: milliseconds. CLS: unitless (e.g. 0.05). */
  numericValue?: number;
  displayValue?: string;
  /**
   * Audit-specific payload. Its shape differs by audit AND by Lighthouse version, so it is
   * `unknown` on purpose: the one reader (extractLcpElement) validates it at runtime.
   */
  details?: unknown;
}

// CrUX keys inside loadingExperience.metrics (real-user, 75th percentile).
export type FieldMetricKey =
  | 'LARGEST_CONTENTFUL_PAINT_MS'
  | 'CUMULATIVE_LAYOUT_SHIFT_SCORE'
  | 'INTERACTION_TO_NEXT_PAINT';

export interface FieldMetric {
  /** LCP/INP: ms. CLS: the score multiplied by 100 (a PSI quirk: 5 means 0.05). */
  percentile: number;
  category: 'FAST' | 'AVERAGE' | 'SLOW';
}

export interface LoadingExperience {
  /** True when this URL had too little traffic and PSI substituted origin-wide data. */
  origin_fallback?: boolean;
  // Partial: any individual metric (INP especially) can be absent.
  metrics?: Partial<Record<FieldMetricKey, FieldMetric>>;
}

export interface PageSpeedApiResponse {
  id: string;
  lighthouseResult: {
    requestedUrl: string;
    finalUrl: string;
    fetchTime: string;
    runtimeError?: { code: string; message: string };
    audits: Partial<Record<LabAuditId, LabAudit>>;
  };
  /** Absent or empty when CrUX has no data for the URL. */
  loadingExperience?: LoadingExperience;
}

export interface PageSpeedApiError {
  error: { code: number; message: string; status?: string };
}

// ---------- App-level types (what the UI consumes) ----------

export type Rating = 'good' | 'needs-improvement' | 'poor';

export interface MetricReading {
  value: number; // raw: ms for LCP/INP, unitless for CLS
  displayValue: string;
  rating: Rating;
}

export interface LabMetrics {
  lcp: MetricReading | null;
  cls: MetricReading | null;
  // No `inp` here on purpose: it can't exist in lab data.
}

export interface FieldMetrics {
  scope: 'url' | 'origin';
  lcp: MetricReading | null;
  cls: MetricReading | null;
  inp: MetricReading | null;
}

/**
 * The element Lighthouse measured as the Largest Contentful Paint in the lab run (from the
 * `largest-contentful-paint-element` audit, or `lcp-breakdown-insight` on Lighthouse 13+).
 * Measured, not guessed from DOM order. It reflects the DEVICE profile that was analyzed
 * and can change between runs of the same URL (A/B content, timing, viewport).
 */
export interface LcpElement {
  /** Lowercase tag name parsed from the snippet ('img', 'h1', 'p', 'div'…), or null. */
  tag: string | null;
  /** Human-readable label Lighthouse attached (often the alt text or heading copy). */
  nodeLabel: string | null;
  /** CSS selector Lighthouse recorded for the node. */
  selector: string | null;
  /** The element's opening tag as Lighthouse captured it (already truncated by Lighthouse). */
  snippet: string | null;
  /**
   * Absolute http(s) URL when the element is an image-like node whose source is visible in
   * the snippet (<img src>, <video poster>, <image href>). null for text blocks and for
   * CSS background images, whose URL is not part of the node's markup.
   */
  imageUrl: string | null;
  /**
   * Lighthouse shortens long attribute values in snippets with a trailing "…". When true,
   * `imageUrl` is only the START of the real URL (the "…" is removed) and must be matched by
   * prefix, never by equality.
   */
  imageUrlTruncated: boolean;
}

export interface DiagnosticResult {
  url: string;
  strategy: Strategy;
  fetchedAt: string;
  lab: LabMetrics;
  /** null when Lighthouse reported no LCP element (e.g. the audit was not applicable). */
  lcpElement: LcpElement | null;
  field: FieldMetrics | null; // null = no real-user data at all
}

/** Echoed back from the server so the form can re-display what was submitted. */
export interface SubmittedInput {
  url: string;
  strategy: Strategy;
}

/** One half of a combined run: it either produced data or failed with a user-safe message. */
export type Outcome<T> =
  | { status: 'success'; data: T }
  | { status: 'error'; message: string };

// The server runs the PageSpeed audit and the HTML crawl in parallel inside ONE Server Action.
// Each half keeps its own Outcome, so one failing never hides the other's result.
//  - idle:    nothing submitted yet
//  - invalid: the input was rejected before any work started (empty / malformed URL)
//  - error:   the request never reached the action (rate limit, network). Inputs are kept.
//  - done:    both halves finished, each either a success or its own error
export type DiagnosticState =
  | { status: 'idle'; submitted: SubmittedInput }
  | { status: 'invalid'; submitted: SubmittedInput; message: string }
  | { status: 'error'; submitted: SubmittedInput; message: string }
  | {
      status: 'done';
      submitted: SubmittedInput;
      cwv: Outcome<DiagnosticResult>;
      crawl: Outcome<CrawlResult>;
    };
