# Website research random URL service

Standalone Cloudflare Worker selecting one HTTPS root URL per GET /random.
No browser automation, third-party navigation, tracking or search workflow integration.

Default pool: verified (327 point-in-time HTTPS content checks). Optional pool=all or
pool=commercial includes unchecked candidates; domain categories can be tentative.
Dataset: 996,853 unique source-listed domains, 59,628 commercial-category candidates.
This is not a certification of current accessibility, business legitimacy or suitability.
Checks were recorded on 2026-11-05. No invented domains or rankings.

Sources: supplied Majestic Million, regional audience list, 2,454-site text list and
crawl export. Rankings are not used as weights. Metadata and original source files
are deliberately not published here; URL chunks retain category and pool membership.
Third-party website content is not republished. Respect applicable source terms.

## Run and deploy
cd worker
npm ci
npm test
npx wrangler login
npm run check
npm run deploy

Deployment requires your authorized Cloudflare account. The committed manifest URL
is pinned to an immutable GitHub commit. No public Worker endpoint exists until an
authorized deployment succeeds. Do not put account credentials in this repository.
The selected URL is returned as text/plain and is never fetched by the service.

For local-only use, run `npm run local` from worker/. It prints a temporary
127.0.0.1 endpoint and uses packaged data without fetching selected websites.
Run `node test-local-http.mjs` for 1,031 HTTP format/distribution/filter checks.
Stop the local Node process when finished. Local diagnostics are not deployment
results and should not be committed.
