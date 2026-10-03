// Pure helper (no secrets, no Node APIs) used by the Server Action to validate user input.
// It lives here because a 'use server' file may only export async functions.
export function normalizeUrl(input: string): string | null {
  if (input.length > 2048) return null; // bound user-controlled input
  const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}
