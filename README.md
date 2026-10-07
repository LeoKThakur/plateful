# Plateful

A private calorie and nutrition tracker for iPhone, built as an installable web app
(no Mac or App Store account needed). All data stays on the phone in IndexedDB.

## Run locally
    python3 -m http.server 8765    # then open http://localhost:8765

## Deploy
Deployed as a Cloudflare Worker with static assets (config in `wrangler.jsonc`;
`.assetsignore` keeps dev files out). Live at https://plateful.leokthakur.workers.dev
    npx wrangler deploy
Any static host with HTTPS also works (the camera needs HTTPS).

Then on the iPhone: open the URL in Safari → Share → Add to Home Screen.

## Data sources
- `data/fndds.json`: about 5,400 generic and restaurant foods from USDA FNDDS 2021–2023,
  bundled for offline search. Rebuild with `tools/build_fndds.py` (see the header for the source URL).
- Open Food Facts: branded search and barcodes (online, crowd-sourced).
- USDA Branded Foods: optional, needs a free key from api.data.gov (Profile → USDA API key).

## Updating
Bump `VERSION` in `sw.js` whenever files change, so installed copies pick up the new version.
