# Core Web Vitals Engine

Live app: [cwv-diagnostic-engine-three.vercel.app](https://cwv-diagnostic-engine-three.vercel.app/)

Enter a public URL, choose mobile or desktop, and get that page's Core Web Vitals, the HTML the server actually received, and copy-paste fixes on request.

<!-- Screenshot or GIF goes here -->

## What it does

- **Analyze** takes the URL and a `mobile` or `desktop` profile, then shows lab LCP and CLS for that run.
- **Field data** appears when the PageSpeed response includes it: field LCP, CLS, and INP. [Real-user experience data](https://developers.google.com/speed/docs/insights/v5/about#crux) says a URL with too little traffic falls back to origin-level data, and the app labels that fallback `origin`. [Distribution and selected metric values](https://developers.google.com/speed/docs/insights/v5/about#distribution) says the field value shown is the 75th percentile.
- **Page details** include the LCP element from the lab audit, plus the title, the first `h1`, the images, and the JSON-LD blocks from the fetched HTML. Content added later by JavaScript is not included, and the crawl section says so.
- **Generate fixes** is a second click. It returns at most 8 recommendations. Each click is a paid OpenAI call, which is why the rate limit below matters. If the page has no images, it returns without calling the model.
- **Independent results:** PageSpeed and the crawl each report their own success or error, so a failure in one still leaves the other on the page.

When the crawl finds no images, the Generate fixes button is not rendered. The panel says "No images were found in the raw HTML, so there is nothing to analyze."

A missing scheme is treated as `https`. `normalizeUrl` allows only `http` and `https`, and it rejects strings longer than 2048 characters. The crawler then refuses embedded credentials, ports other than 80 and 443, and any host that resolves to a private, loopback, or link-local address, including `localhost`.

One mobile Analyze of `https://web.dev` took 21.5 seconds. The PageSpeed fetch aborts after 55 seconds.

## How it works

Analyze is a single form. The server action `analyzeSite` starts `fetchDiagnostics` (the PageSpeed Insights call) and `crawlPage` (the HTML fetch) in parallel with `Promise.all`. `generateRemediation` handles Generate fixes. `src/proxy.ts` counts POSTs and allows 5 per 15 minutes per IP.

**Built with:** Next.js (App Router), React, TypeScript, Tailwind CSS, Zod, Cheerio, and the Vercel AI SDK with OpenAI. Exact versions are in `package.json`. Requires Node 20.9 or newer.

## Decisions

**LCP comes from Lighthouse, not from the HTML.** `extractLcpElement` reads the LCP node from the Lighthouse audits (`largest-contentful-paint-element`, then `lcp-breakdown-insight`, then `lcp-discovery-insight`) and `resolveLcp` never falls back to document order. I rejected treating the first content image in the HTML as the LCP image: on a mobile Analyze of `https://web.dev`, the real LCP node was a text `div` (`div.devsite-landing-row-item > div.devsite-landing-row-item-description > div.devsite-landing-row-item-body > div.devsite-landing-row-item-description-content`), not an image.

**`generateText` with `Output.object`, not `generateObject`.** In `ai@6`, `generateObject` is marked `@deprecated` and points to `generateText` with an `output` setting. The schema is `remediationSchema`.

**Rate limiting lives in `src/proxy.ts`.** Next 16 deprecates the `middleware` filename in favor of `proxy`, which runs on the Node.js runtime. Hit counts are kept in a `Map` inside `createRateLimiter`, so they are per instance, not shared across machines (see "What I'd improve").

## What I learned

**A `<select>` that ignored its own state.** After a desktop Analyze, the device control snapped back to `MOBILE`. In React 19, changing `defaultValue` on an already-mounted `<select>` does nothing, so the reset after the form action kept the first default. Giving the select `key={state.submitted.strategy}` makes React mount a fresh element that picks up the strategy just submitted.

**Check heuristics against real output.** My first LCP pass called the first non-icon image the LCP image. Lighthouse's actual node on the same page was a text block. Reading the audit directly replaced the guess.

## What I'd improve

- **Shared rate limiting.** Because the counter is in memory, the limit is best-effort on serverless hosting like Vercel, where requests can land on different instances. A shared store such as Upstash Redis or Vercel KV would make the limit reliable.
- **Move field data to the CrUX API.** Field metrics still come from `loadingExperience` on `runPagespeed`, and the [get started page](https://developers.google.com/speed/docs/insights/v5/get-started) says Google plans to remove Chrome UX Report data from that API and points to the CrUX API.

## Run locally

```bash
npm install
cp .env.example .env.local   # Windows: copy .env.example .env.local
npm run dev
```

- `PAGESPEED_API_KEY` is what Analyze reads. Without it, the crawl still runs and the PageSpeed half shows "The diagnostic service is not configured." Create a key under [Acquiring and using an API key](https://developers.google.com/speed/docs/insights/v5/get-started#APIKey), or on the [Credentials page](https://console.cloud.google.com/apis/credentials).
- `OPENAI_API_KEY` is what Generate fixes reads.
- `OPENAI_MODEL` is optional and defaults to `gpt-5`.

## Credits

- [PageSpeed Insights API](https://developers.google.com/speed/docs/insights/v5/get-started), `GET https://www.googleapis.com/pagespeedonline/v5/runPagespeed`
- [OpenAI API](https://platform.openai.com/docs/api-reference/introduction), called from `generateRemediation` through `@ai-sdk/openai`

MIT licensed. See [LICENSE](LICENSE).
