# Bagiyuk

Mobile-first split-bill PWA. Indonesian interface, Poppins, lavender surfaces, and an original café illustration. Optimized for 360–430px; wider displays retain the single-column app.

## Run locally

```sh
npm install
npm run dev
```

Open http://localhost:3000. On Windows PowerShell with script execution disabled, use `npm.cmd` in place of `npm`.

Development uses `.next`; production builds use `.next-production` so an active preview cannot overwrite production files.

```sh
npm test
npm run typecheck
npm run build
npm start
```

## What works

- Manual bills with editable quantities, prices and per-item discounts.
- Up to eight participants, optional phone numbers, and a designated payer.
- Individual/shared item assignment and equal split.
- Proportional tax, service, bill discount, tips and signed rounding adjustment.
- Integer-rupiah allocation with deterministic remainder distribution; participant totals match the bill exactly.
- Editable receipt extraction via a server-side Gemini route; unsupported/unreadable images produce a manual fallback.
- Local draft recovery, completed history and reopening details.
- Text copy/native sharing and PNG summary download.
- PWA manifest, generated icons and production service worker with an offline shell and asset cache. Scan needs internet. Offline use requires an initial online load and service-worker asset caching.

The home page begins with real empty history. “Pertama kali pakai Bagiyuk?” opens a clearly labeled editable example.

## Activate receipt scanning

Set `GEMINI_API_KEY` in `.env.local` and restart the server. `GEMINI_MODEL` defaults to `gemini-3.5-flash-lite`. Keys are used only in the server route.

Images are sent to Google Gemini after the user chooses a file or captures a photo. Images are not stored in local history or on the app server. Only extracted bill data is stored in the browser. Output is validated and fully editable. Scans accept JPG/PNG/WebP up to 8 MB and whole-rupiah IDR receipts. Receipt totals are displayed for reconciliation rather than silently forcing the computed total.

API reference: [Google GenerateContent API](https://ai.google.dev/api/generate-content). Framework: [Next.js App Router](https://nextjs.org/docs/app).

## Data and boundaries

No account, actual payment, cloud sync, or realtime requests. Local data lives under `bagiyuk.v1` in localStorage; clearing site data removes it. Use text/image export to keep a copy. Storage failures are surfaced; unreadable previous data is protected from overwrite. The API's in-memory throttle is a development guard; replace it with a shared trusted rate limiter and request-body limits before exposing a funded Gemini key on a public deployment.

Money is calculated in TypeScript, not by AI. Up to 100 items, integer quantities, and subtotal up to Rp1 trillion. Shared allocation uses exact integer weights; each final amount is rounded using largest remainders with participant order breaking ties. A small per-person rounding adjustment reconciles independently displayed fees to the final amount.

## Structure

`src/components/bagiyuk.tsx` contains the screen flow. `src/lib/bill.ts` owns validation and calculations, `src/lib/store.ts` local state/persistence, and `src/app/api/receipt/route.ts` image extraction. `src/components/ui/button.tsx` follows the shadcn/Radix button pattern. Item forms use React Hook Form and Zod. Styling uses Tailwind CSS and shared CSS tokens.

Tests cover rounding invariants, proportional fees, shared/equal allocation, validation, storage recovery, the complete manual UI flow in a simulated DOM, and the API with mocked Gemini responses. Real camera permissions, native sharing, installation, offline reload and live Gemini extraction still require device/browser verification.

## Artwork

Hero: `public/cafe-hero.webp` (optimized), original `public/cafe-hero.png`. Generated with the built-in Imagegen tool; prompt recorded in [docs/hero-prompt.md](docs/hero-prompt.md). App icon is a project-native split-B SVG, with PNG derivatives.
