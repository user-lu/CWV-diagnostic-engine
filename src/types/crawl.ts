// Attributes are kept as raw strings (not numbers) on purpose: HTML allows
// width="100%" or "auto", and parsing would silently lose that information.
// `null` means the attribute is absent. That matters for `alt`, where
// absent (an accessibility bug) differs from alt="" (valid for decorative images).
export interface ImageInfo {
  src: string | null; // resolved to an absolute URL when possible
  width: string | null;
  height: string | null;
  alt: string | null;
  loading: string | null; // "lazy" | "eager" | null
}

export interface JsonLdBlock {
  raw: string; // text content of the <script>, clipped if very long
  isValidJson: boolean; // checked on the full text, before clipping
  truncated: boolean;
}

export interface CrawlResult {
  finalUrl: string; // after redirects
  fetchedAt: string; // ISO timestamp
  title: string | null;
  h1: string | null;
  images: ImageInfo[]; // capped to keep the Server Action payload small
  imageCount: number; // total <img> tags found, before the cap
  jsonLd: JsonLdBlock[];
}

// Same discriminated-union pattern as DiagnosticState, so the UI can narrow on `status`.
export type CrawlState =
  | { status: 'idle' }
  | { status: 'success'; data: CrawlResult }
  | { status: 'error'; message: string };
