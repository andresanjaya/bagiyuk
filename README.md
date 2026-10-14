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
- Split Together Phase A: a saved local bill can start an online room; guests join anonymously by invite link or QR and claim separate units or shared items. Confirmed claims sync through Supabase Realtime.

The home page begins with real empty history. “Pertama kali pakai Bagiyuk?” opens a clearly labeled editable example.

## Activate receipt scanning

Set `GEMINI_API_KEY` in `.env.local` and restart the server. `GEMINI_MODEL` defaults to `gemini-3.5-flash-lite`. Keys are used only in the server route.

Images are sent to Google Gemini after the user chooses a file or captures a photo. Images are not stored in local history or on the app server. Only extracted bill data is stored in the browser. Output is validated and fully editable. Scans accept JPG/PNG/WebP up to 8 MB and whole-rupiah IDR receipts. Receipt totals are displayed for reconciliation rather than silently forcing the computed total.

API reference: [Google GenerateContent API](https://ai.google.dev/api/generate-content). Framework: [Next.js App Router](https://nextjs.org/docs/app).

## Activate Split Together

Create a Supabase project, enable **Anonymous Sign-Ins** under Auth, and apply `supabase/migrations/202610140001_split_together_phase_a.sql` with the Supabase CLI migration workflow. The migration is additive. For a public deployment, enable Supabase CAPTCHA/Turnstile for anonymous sign-ins.

Set these values in `.env.local` and the deployment environment, then restart or redeploy:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY=YOUR_SERVER_ONLY_SECRET_KEY
NEXT_PUBLIC_APP_URL=https://YOUR_PRODUCTION_DOMAIN
```

Use `http://localhost:3000` for `NEXT_PUBLIC_APP_URL` locally. Never prefix the secret key with `NEXT_PUBLIC_`. The app generates a fresh 32-byte invitation token; only its SHA-256 hash is stored in the database. The raw link is shown when created, so copy it before leaving the invite screen. A new link can be issued later. The original local bill and MVP 1 history are unchanged.

The SQL migration enables RLS on all session tables, grants member-only reads, keeps direct browser writes closed, and publishes only session version updates to Realtime. Server routes verify the user's Supabase JWT and call secret-key RPCs for atomic create/join/claim operations. Claims and joins lock the session row, so concurrent requests serialize. The route enforces a per-identity, per-action minute limit in Postgres. Anonymous-authenticated users have the `authenticated` database role. A browser whose local identity was deleted must join again as a new participant.

For cloud security and concurrency checks, point `.env.local` at a **dedicated test project**, apply the migration, and run `npm run test:cloud`. This creates anonymous test users and rooms. Check the join link and QR on two separate browser profiles or devices; a single profile shares one identity across tabs.

Phase A intentionally stops before finalization and payment tracking. Claim totals are estimates while items remain unassigned. The host sets shared items before opening claims, then opens claiming from the room. Reopening and bill editing during claiming are not supported.

## Data and boundaries

MVP 1 local data lives under `bagiyuk.v1` in localStorage; clearing site data removes it. Use text/image export to keep a copy. Storage failures are surfaced; unreadable previous data is protected from overwrite. Split Together uses Supabase only after the user opens a cloud flow. No actual payment is processed. The receipt API's in-memory throttle is a development guard; replace it with a shared trusted rate limiter before exposing a funded Gemini key on a public deployment.

Money is calculated in TypeScript, not by AI. Up to 100 items, integer quantities, and subtotal up to Rp1 trillion. Shared allocation uses exact integer weights; each final amount is rounded using largest remainders with participant order breaking ties. A small per-person rounding adjustment reconciles independently displayed fees to the final amount.

## Structure

`src/components/bagiyuk.tsx` contains the screen flow. `src/lib/bill.ts` owns validation and calculations, `src/lib/store.ts` local state/persistence, and `src/app/api/receipt/route.ts` image extraction. `src/components/ui/button.tsx` follows the shadcn/Radix button pattern. Item forms use React Hook Form and Zod. Styling uses Tailwind CSS and shared CSS tokens.

Tests cover rounding invariants, proportional fees, shared/equal allocation, validation, storage recovery, the complete manual UI flow in a simulated DOM, and the API with mocked Gemini responses. Real camera permissions, native sharing, installation, offline reload and live Gemini extraction still require device/browser verification.

## Artwork

Hero: `public/cafe-hero.webp` (optimized), original `public/cafe-hero.png`. Generated with the built-in Imagegen tool; prompt recorded in [docs/hero-prompt.md](docs/hero-prompt.md). App icon is a project-native split-B SVG, with PNG derivatives.
