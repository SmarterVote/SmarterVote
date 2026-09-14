# screenshots.mjs — Smarter.Vote view sweep

Drives a deployment with Playwright and captures every view in **desktop**
(1440×900) and **mobile** (Pixel 7) form factors, plus a first set of
interactive permutations.

```bash
cd web
node scripts/screenshots.mjs                       # live site, both viewports
BASE_URL=http://127.0.0.1:4173 node scripts/screenshots.mjs   # local dev/preview
OUT_DIR=/tmp/shots node scripts/screenshots.mjs --only=forecast,compare
node scripts/screenshots.mjs --viewport=mobile --headed
```

Output (default `web/screenshots/<timestamp>/`):

- `desktop/*.png`, `mobile/*.png` — full-page captures
- `manifest.json` — every shot with URL / status / error
- `index.html` — contact sheet (open in a browser)

## Coverage (41 views)

Core: home (+ dark, + search results), elections (+ dark, office filter, state
selected, search hits, empty results, mobile map expanded), forecast
house/senate/governors (+ dark, state selected), my-ballot (+ dark).

Trust/legal: about (+ #methodology), support, support success/cancel,
corrections, funding-and-editorial-independence, partners, privacy, terms, 404.

Races: race detail (+ dark, forecast expanded, compare drawer), candidate
detail (+ dark, other-candidates expanded), compare (+ dark, 4-candidate).

Chrome: mobile nav open, mobile search open, admin sign-in (Auth0).

## Capture behaviour

- Full-page shots auto-scroll top-to-bottom and wait for `img.decode()` before
  capturing, so lazy images aren't caught as their alt text.
- Shots with a `#hash` path are viewport-only and scroll the target under the
  sticky header (otherwise they duplicate the base page).
- Mobile filter permutations expand the collapsible US map first.

## Not yet covered — see the TODO block at the top of the script

my-ballot "exploring" results, draft-preview / discovery-only / withdrawn
banners, per-issue source popovers, mobile compare issue-picker permutations,
forecast state drill-down / holdovers, admin/pipeline dashboard, client-side
SvelteKit error view.
