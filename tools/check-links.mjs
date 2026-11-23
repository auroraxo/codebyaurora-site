#!/usr/bin/env node
// Re-read every EXTERNAL link published on this site and fail if one is dead.
//
// Why this exists: on 2026-11-23 the greenscan landing page still cited
// community.n8n.io/t/310860 — a thread that had been deleted (HTTP 404) while
// the page kept presenting it as the origin story of the product. Same failure
// mode as the GitHub-status claim that drifted for 18 days: the page linked to
// something the live world no longer serves, and nothing failed.
//
// The GitHub state claims are covered by tools/check-claims.mjs; this tool
// covers the other half — that every published URL still resolves.
//
// Read-only: GET requests with redirects followed, no writes anywhere.
//
// Classification (deliberately conservative, so a bot wall can never be
// mistaken for a dead link NOR a dead link for a pass):
//   2xx/3xx            -> ok
//   404, 410           -> DRIFT (the target says it is gone)
//   401/403/429/5xx    -> environment (could be a wall or a blip; NOT a pass,
//                         NOT a drift — investigate before touching the page)
//   network/timeout    -> environment
//
// Usage:  node tools/check-links.mjs           # all published pages
//         node tools/check-links.mjs --file X  # one page (repeatable)
//
// Exit:   0 = every external link still resolves
//         1 = at least one published link is dead (fix the page)
//         2 = something could not be checked — NOT a pass

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) codebyaurora-link-guard';
const TIMEOUT_MS = 20000;
const LIVE_ORIGIN = process.env.SITE_ORIGIN || 'https://codebyaurora.com';

function collectHtml(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules' || name === '__pycache__') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) collectHtml(p, out);
    else if (name.endsWith('.html')) out.push(p);
  }
  return out;
}

const fileArgs = [];
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--file' && process.argv[i + 1]) fileArgs.push(process.argv[++i]);
}
const pages = fileArgs.length
  ? fileArgs.map((f) => join(ROOT, f))
  : collectHtml(ROOT);

// href/src/action attributes only — JavaScript template strings
// (https://…/$1) are runtime constructs, not published links.
const ATTR = /\b(?:href|src|action)\s*=\s*"([^"]+)"/g;
const SKIP_SCHEME = /^(#|mailto:|tel:|javascript:|data:)/;
const PLACEHOLDER = /[<>{}]|<owner>|<repo>|\$\{/;

const links = new Map(); // url -> Set(pages)
for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  for (const m of html.matchAll(ATTR)) {
    let url = m[1].replaceAll('&amp;', '&').trim();
    if (!url) continue;
    // A root-relative route is checked against the live domain — a page that
    // links to a route the server does not serve is just as broken as a dead
    // external link, and the site used to carry those silently.
    if (url.startsWith('/') && !url.startsWith('//')) {
      if (url.includes('$')) continue; // runtime template
      url = new URL(url, LIVE_ORIGIN).href;
    } else if (SKIP_SCHEME.test(url) || !/^https?:\/\//.test(url)) {
      continue;
    }
    if (PLACEHOLDER.test(url)) continue; // template, never a real link
    const file = relative(ROOT, page);
    if (!links.has(url)) links.set(url, new Set());
    links.get(url).add(file);
  }
}

const results = [];
let drift = 0;
let environment = 0;

for (const [url, files] of [...links.entries()].sort()) {
  let code = 0;
  let err = '';
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': UA, Accept: '*/*' },
    });
    code = res.status;
    // drain so sockets are not leaked
    try { await res.arrayBuffer(); } catch { /* body irrelevant */ }
  } catch (e) {
    err = e.cause?.code || e.name || e.message;
  }

  let verdict, detail;
  if (err) {
    verdict = 'environment';
    detail = `not checked (${err})`;
    environment++;
  } else if (code === 404 || code === 410) {
    verdict = 'drift';
    detail = `HTTP ${code} — published link is dead`;
    drift++;
  } else if (code >= 200 && code < 400) {
    verdict = 'ok';
    detail = `HTTP ${code}`;
  } else {
    verdict = 'environment';
    detail = `HTTP ${code} — wall or blip, needs a human look`;
    environment++;
  }
  results.push({ url, files: [...files].join(','), verdict, detail });
}

for (const r of results) {
  const mark = r.verdict === 'ok' ? 'ok  ' : r.verdict === 'drift' ? 'DRIFT' : 'warn';
  console.log(`${mark}  ${r.detail.padEnd(34)} ${r.url}  [${r.files}]`);
}
console.log('');
console.log(`links: ${results.length}, dead: ${drift}, not-checked: ${environment}`);

if (drift > 0) {
  console.error('verdict: a published link is dead — correct the page, do not keep the citation');
  process.exit(1);
}
if (environment > 0) {
  console.error('verdict: not fully checked (environment) — this is NOT a pass and NOT a drift');
  process.exit(2);
}
console.log('verdict: every published external link still resolves');
process.exit(0);
