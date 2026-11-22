# codebyaurora-site

Source of truth for the **<https://codebyaurora.com/>** landing page: the
storefront of [aurora-node-auditor](https://github.com/auroraxo/aurora-node-auditor).

Historically this page lived only as an untracked file in `/var/www/html`.
It silently drifted four releases behind (`Auditor v0.1.4 Live` while v0.1.8
shipped) and kept rendering an empty telemetry grid after the collector
schema changed — nothing failed, the page just lied. This repository makes
every change reviewable and drift diffable.

## Contents

- `index.html` — single-file landing page (no build step, no dependencies).
- `claims.json` + `tools/check-claims.mjs` — the live status-claim guard.

## Design rules (learned the hard way)

- **Never hardcode the auditor version.** The header badge fetches `/health`
  client-side and renders `Auditor v<version> Live`. The release button links
  `/releases/latest`, not a pinned tag.
- **Every external status claim is re-read in CI.** On 2026-11-22 the homepage
  still said an Agave backport was "open and awaiting review" — it had been
  closed unmerged on 2026-11-04, so the page was wrong for 18 days with nothing
  failing. That is the same silent-lie failure the bullet above describes.
  `claims.json` pins each published claim (PR/issue state, release, exact
  wording) to a check date, and `tools/check-claims.mjs` re-reads them live
  against the GitHub API as a CI step. Exit 1 means the page no longer matches
  reality: correct the page, never weaken the claim. Exit 2 (could not read)
  fails CI too, so an unverifiable claim is never mistaken for a verified one.
- **Bind to the real payload schema.** `fetchTelemetry()` reads
  `{node, resources: {cpu_count, load_avg, memory, disk}}` from `/telemetry`.
  When the collector schema changes, this file must change with it — the
  five-second refresh loop makes any mismatch visible as permanent `--`.
- **API explorer tabs must match the nginx whitelist** on
  `codebyaurora.com`: `/health`, `/ready`, `/telemetry`, `/status`,
  `/audit`, `/metrics`.
- **Install commands prefer the project index:**
  `pip install --index-url https://codebyaurora.com/simple/ aurora-node-auditor`.

## Deploy

```bash
# from this directory on hermes004
sudo cp index.html /var/www/html/index.html
sudo chown aurora:aurora /var/www/html/index.html
curl -s https://codebyaurora.com/ | md5sum   # must equal md5sum index.html
```

The package index under `/simple/` and `/packages/` is **not** part of this
repository; it is generated from release artifacts during the release cycle.


## Solana findings page and legacy URL

`solana-findings/index.html` and its `evidence/` are the source for the public
<https://codebyaurora.com/solana-findings/> page. Deploy these files together
with `index.html` and `sitemap.xml` (not just the homepage), preserving the
`solana-findings/` directory. The old `/befund/` route is a **301 at nginx**,
not a separate page. The active nginx config (`/etc/nginx/sites-enabled/default`)
has these locations before `location /`:

```nginx
location = /befund {
    return 301 https://codebyaurora.com/solana-findings/$is_args$args;
}
location /befund/ {
    rewrite ^/befund/(.*)$ https://codebyaurora.com/solana-findings/$1 permanent;
}
```

Keep this alongside the existing locations, test with `sudo /usr/sbin/nginx -t`,
then reload nginx. Check `/befund/` and `/befund/evidence/issues-2026-10.json`
return HTTP 301 to HTTPS equivalents, and `/solana-findings/` and its evidence
return 200. Changes to the public findings page must also update the canonical
and OpenGraph URLs and avoid publishing private data. `robots.txt` is *not*
an access control; this page is intentionally public, containing cited public
Solana measurements and GitHub artifacts.
