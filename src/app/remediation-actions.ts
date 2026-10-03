'use server';
// Server Action: the OpenAI key is read in lib/remediation.ts and never reaches the browser.
// Server Actions are public POST endpoints, and BOUND ARGUMENTS ARE SENT FROM THE BROWSER,
// so `input` is untrusted and re-validated with Zod before it can reach the model.

import { generateRemediation, RemediationError } from '@/lib/remediation';
import {
  remediationInputSchema,
  type RemediationInput,
  type RemediationState,
} from '@/types/remediation';

// The client calls generateFixes.bind(null, input), so `input` is the only parameter we declare.
// useActionState also passes (prevState, formData) after it; the form is just a trigger and
// there is no state to carry over, so we simply don't declare them. Extra arguments are ignored.
export async function generateFixes(input: RemediationInput): Promise<RemediationState> {
  const parsed = remediationInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: 'error', message: 'The crawl data was not in the expected format.' };
  }

  try {
    const { recommendations, dropped } = await generateRemediation(parsed.data);
    return { status: 'success', recommendations, dropped };
  } catch (err) {
    if (err instanceof RemediationError) {
      return { status: 'error', message: err.message };
    }
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      return { status: 'error', message: 'The AI analysis timed out. Please try again.' };
    }
    // Log name + message only; provider errors can carry request details we don't want in logs.
    console.error(
      'Unexpected generateFixes failure',
      err instanceof Error ? `${err.name}: ${err.message}` : 'unknown error',
    );
    return { status: 'error', message: 'Could not generate fixes. Please try again.' };
  }
}
