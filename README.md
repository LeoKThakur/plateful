# Plateful

A private calorie and nutrition tracker for iPhone, built as an installable web app
(no Mac or App Store account needed). Food data stays on the phone in IndexedDB.

Live: https://plateful.leokthakur.workers.dev

## Layout
- `public/`: the app (static files served as-is)
- `worker/`: Cloudflare Worker that serves `public/` and runs push reminders
- `tools/`: data build scripts

## Run locally
    npx wrangler d1 execute plateful --local --file worker/schema.sql   # once
    npx wrangler dev --port 8787 --test-scheduled

Local push signing needs `.dev.vars` (git-ignored) containing
`VAPID_PRIVATE_JWK='{...}'`. Trigger the reminder cron with `curl "localhost:8787/__scheduled?cron=*/15+*+*+*+*"`.

## Deploy
    npx wrangler deploy

Bump `VERSION` in `public/sw.js` whenever app files change so installed copies update.

First-time setup on a new Cloudflare account:
    npx wrangler d1 create plateful            # put the id in wrangler.jsonc
    npx wrangler d1 execute plateful --remote --file worker/schema.sql
    npx wrangler secret put VAPID_PRIVATE_JWK  # private key JWK; public key goes in wrangler.jsonc vars

Everything fits in Cloudflare's free plan (Workers, D1, one cron trigger).

## Push reminders
The Worker checks every 15 minutes which reminders are due in each phone's time zone:
meal reminders (only if that meal has nothing logged), an evening goal check (only if
calories, protein or water are still short), a weekly weigh-in, and a weekly summary.

The server never receives food entries. The app sends only which meals have entries
today, whether goals are met, and the last weigh-in date. The push carries just the
reminder type; the service worker writes the text from a summary saved on the phone.
iPhone only delivers web push to apps added to the Home Screen (iOS 16.4+).

## Data sources
- `public/data/fndds.json`: about 5,400 generic and restaurant foods from USDA FNDDS 2021–2023,
  bundled for offline search. Rebuild with `tools/build_fndds.py` (see the header for the source URL).
- Open Food Facts: branded search and barcodes (online, crowd-sourced).
- USDA Branded Foods: optional, needs a free key from api.data.gov (Profile → USDA API key).
