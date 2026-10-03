'use server';
// Server Action: runs on the server only, so the API key never reaches the browser.
// It's still a public POST endpoint, so every field is validated as untrusted input.
// (Files marked 'use server' may only export async functions; keep helpers unexported.)

import { crawlPage } from '@/lib/crawler';
import { fetchDiagnostics, PageSpeedError } from '@/lib/pagespeed';
import { CrawlError } from '@/lib/safe-fetch';
import { normalizeUrl } from '@/lib/url';
import type { CrawlResult } from '@/types/crawl';
import {
  isStrategy,
  type DiagnosticResult,
  type DiagnosticState,
  type Outcome,
  type Strategy,
  type SubmittedInput,
} from '@/types/pagespeed';

// Each helper converts "throws" into an Outcome value. That has two effects:
//  1. Promise.all below can never reject, so one half failing can't discard the other's result.
//  2. Only PageSpeedError / CrawlError messages are written for users. Anything else may leak
//     internals, so it is logged here and replaced with a generic message.

async function runCwv(url: string, strategy: Strategy): Promise<Outcome<DiagnosticResult>> {
  try {
    return { status: 'success', data: await fetchDiagnostics(url, strategy) };
  } catch (err) {
    if (err instanceof PageSpeedError) {
      return { status: 'error', message: err.message };
    }
    if (err instanceof Error && err.name === 'TimeoutError') {
      return { status: 'error', message: 'The analysis timed out. Please try again.' };
    }
    console.error('Unexpected fetchDiagnostics failure', err);
    return { status: 'error', message: 'Something went wrong. Please try again.' };
  }
}

async function runCrawl(url: string): Promise<Outcome<CrawlResult>> {
  try {
    return { status: 'success', data: await crawlPage(url) };
  } catch (err) {
    if (err instanceof CrawlError) {
      return { status: 'error', message: err.message };
    }
    if (err instanceof Error && err.name === 'TimeoutError') {
      return { status: 'error', message: 'The site took too long to respond.' };
    }
    console.error('Unexpected crawlPage failure', err);
    return { status: 'error', message: 'Something went wrong while reading that page.' };
  }
}

// (prevState, formData) is the signature useActionState expects.
export async function analyzeSite(
  _prevState: DiagnosticState,
  formData: FormData,
): Promise<DiagnosticState> {
  const rawUrl = formData.get('url');
  const rawStrategy = formData.get('strategy');

  // FormData values are `FormDataEntryValue | null` (string | File | null), so narrow
  // before use. A tampered POST could send anything, so an invalid strategy falls back to 'mobile'.
  const strategy = isStrategy(rawStrategy) ? rawStrategy : 'mobile';

  // Echo the RAW input (not the normalized URL) so the field shows what the user typed.
  // Every return path includes it: that's how the form "remembers" after submission.
  const submitted: SubmittedInput = {
    url: typeof rawUrl === 'string' ? rawUrl.trim() : '',
    strategy,
  };

  if (submitted.url === '') {
    return { status: 'invalid', submitted, message: 'Please enter a URL.' };
  }

  const url = normalizeUrl(submitted.url);
  if (!url) {
    return {
      status: 'invalid',
      submitted,
      message: 'That does not look like a valid http(s) URL.',
    };
  }

  // PARALLEL: both start immediately and we wait for the slower one. Total time is
  // max(PageSpeed, crawl) instead of their sum. (Two separate Server Actions can't do this:
  // Next.js dispatches them one at a time, and React commits their results together.)
  const [cwv, crawl] = await Promise.all([runCwv(url, strategy), runCrawl(url)]);

  return { status: 'done', submitted, cwv, crawl };
}
