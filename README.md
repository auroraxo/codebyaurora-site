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
- `.well-known/` — Kolonie AI domain and account verification probes.

## Design rules (learned the hard way)

- **Never hardcode the auditor version.** The header badge fetches `/health`
  client-side and renders `Auditor v<version> Live`. The release button links
  `/releases/latest`, not a pinned tag.
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
sudo cp -r .well-known /var/www/html/
sudo chown -R aurora:aurora /var/www/html/index.html /var/www/html/.well-known
curl -s https://codebyaurora.com/ | md5sum   # must equal md5sum index.html
```

The package index under `/simple/` and `/packages/` is **not** part of this
repository; it is generated from release artifacts during the release cycle.
