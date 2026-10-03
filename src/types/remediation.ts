import { z } from 'zod';

// Client files must `import type` from this module. Type-only imports are erased,
// so zod is never bundled for the browser.

// ---------- What the model must return ----------
// Keep the model-facing schema simple: no .min()/.max()/.optional(). Providers'
// strict structured-output modes support only a subset of JSON Schema, so a rich
// schema can be rejected outright. Bounds are enforced in code after generation.
export const recommendationSchema = z.object({
  element: z.string().describe("The tag or section needing a fix, e.g. 'Hero image (images[0])'"),
  issue: z.string().describe('One or two sentences describing the performance bottleneck'),
  codeFix: z.string().describe('A copy-pasteable plain-HTML snippet that resolves the issue'),
});

// The root must be an object, not a bare array: OpenAI-style structured outputs
// require an object at the top level, so we wrap the array in a field.
export const remediationSchema = z.object({
  recommendations: z.array(recommendationSchema).describe('Most impactful first'),
});

// One source of truth: the TS type is derived from the runtime schema, so they can't drift.
export type Recommendation = z.infer<typeof recommendationSchema>;

// ---------- What the Server Action accepts ----------
// TypeScript types vanish at runtime, and Server Action arguments come from the browser,
// so the action re-validates with this schema. Limits leave headroom over the crawler's
// 300-char clip (clip() can return 301 chars including the ellipsis).
const attr = z.string().max(400).nullable();

// The LCP element Lighthouse measured (see LcpElement in types/pagespeed.ts). It is untrusted
// like everything else here: it came from the browser, and its text came from a third-party page.
const lcpElementSchema = z.object({
  tag: z.string().max(40).nullable(),
  nodeLabel: z.string().max(250).nullable(),
  selector: z.string().max(400).nullable(),
  snippet: z.string().max(500).nullable(),
  imageUrl: z.string().max(2048).nullable(),
  imageUrlTruncated: z.boolean(),
});

export const remediationInputSchema = z.object({
  finalUrl: z.string().max(4096),
  /** null = Lighthouse reported no LCP element (or the PageSpeed half of the run failed). */
  lcpElement: lcpElementSchema.nullable(),
  title: attr,
  h1: attr,
  imageCount: z.number().int().min(0).max(100_000),
  images: z
    .array(z.object({ src: attr, width: attr, height: attr, alt: attr, loading: attr }))
    .max(200),
});

export type RemediationInput = z.infer<typeof remediationInputSchema>;

// Same discriminated-union pattern as the other states.
export type RemediationState =
  | { status: 'idle' }
  | {
      status: 'success';
      recommendations: Recommendation[];
      /** Suggestions removed by the safety filter (script/iframe/event-handler markup). */
      dropped: number;
    }
  | { status: 'error'; message: string };
