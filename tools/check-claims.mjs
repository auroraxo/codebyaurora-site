#!/usr/bin/env node
// Re-read every externally-checkable status claim published on this site and
// fail if the live world no longer matches what the page says.
//
// Why this exists: on 2026-11-22 the homepage claimed an Agave backport was
// "open and awaiting review". It had been closed unmerged on 2026-11-04. The
// page was wrong for 18 days and nothing failed — the same failure mode the
// repository README warns about ("the page just lied"). A drift guard that is
// NOT run would repeat the bug, so this runs live against the GitHub API and
// exits non-zero on the first mismatch.
//
// Read-only: GET only, no writes, no comments, no PRs.
//
// Usage:  node tools/check-claims.mjs            # live check (needs GITHUB_TOKEN)
//         node tools/check-claims.mjs --offline  # only the local phrase guard
//
// Exit:   0 = every pinned claim still holds
//         1 = at least one claim drifted (page must be corrected)
//         2 = environment problem (no token / API unreachable) — NOT a drift

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = JSON.parse(readFileSync(join(ROOT, 'claims.json'), 'utf8'));

const API = 'https://api.github.com';
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';

async function api(path) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'codebyaurora-claims-guard' };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const res = await fetch(`${API}${path}`, { headers });
  if (res.status === 404) return { _notFound: true };
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return res.json();
}

const results = [];
let drift = 0;
let environment = 0;

function check(id, ok, detail, kind = 'drift') {
  results.push({ id, ok, detail, kind });
  if (!ok) { if (kind === 'drift') drift++; else environment++; }
}

// ---- 1. The local phrase guard: a page must never publish a claim whose
// wording asserts a state the spec no longer pins.
for (const file of [...new Set(SPEC.claims.flatMap((c) => c.publishedOn))]) {
  let text = '';
  try { text = readFileSync(join(ROOT, file), 'utf8'); } catch { continue; }
  for (const phrase of SPEC.forbiddenPhrases ?? []) {
    check(`phrase:${file}:${phrase.slice(0, 28)}`, !text.includes(phrase),
      text.includes(phrase) ? `still published in ${file}` : `absent from ${file}`);
  }
}

// ---- 2. The live claims.
const offline = process.argv.includes('--offline');

if (!offline) {
  if (!TOKEN) {
    check('env:token', false, 'GITHUB_TOKEN not set — live claims not checked', 'environment');
  } else {
    for (const c of SPEC.claims) {
      let data;
      try {
        if (c.kind === 'pr') {
          data = await api(`/repos/${c.repo}/pulls/${c.number}`);
          // GitHub's REST API never reports state "MERGED": a merged pull request
          // comes back as state=closed plus a non-null merged_at. Reading `state`
          // alone would call every merged PR a drift. Merged-ness is merged_at.
          const state = data.state?.toUpperCase();
          const merged = !!data.merged_at;
          const restState = merged ? 'MERGED' : state;
          check(`${c.id}:state`, restState === c.expectState,
            `state=${restState} (rest=${state}, merged_at=${data.merged_at ?? 'null'}) expected=${c.expectState}`);
          if ('expectMerged' in c) {
            check(`${c.id}:merged`, merged === c.expectMerged,
              `merged=${merged} expected=${c.expectMerged}`);
          }
          if (c.expectClosedAfter) {
            const closedAt = data.closed_at ?? '';
            check(`${c.id}:closed-after`, closedAt >= c.expectClosedAfter,
              `closed_at=${closedAt || 'null'} expected >= ${c.expectClosedAfter}`);
          }
          if (c.expectNoReviews) {
            const reviews = await api(`/repos/${c.repo}/pulls/${c.number}/reviews`);
            check(`${c.id}:no-reviews`, Array.isArray(reviews) && reviews.length === 0,
              `reviews=${Array.isArray(reviews) ? reviews.length : 'n/a'}`);
          }
          if (c.expectNoComments) {
            const comments = await api(`/repos/${c.repo}/issues/${c.number}/comments`);
            check(`${c.id}:no-comments`, Array.isArray(comments) && comments.length === 0,
              `comments=${Array.isArray(comments) ? comments.length : 'n/a'}`);
          }
          if ('expectCreatedDate' in c) {
            const created = (data.created_at || '').slice(0, 10);
            check(`${c.id}:created-date`, created === c.expectCreatedDate,
              `created=${created} expected=${c.expectCreatedDate}`);
          }
        } else if (c.kind === 'release') {
          data = await api(`/repos/${c.repo}/releases/tags/${c.tag}`);
          const published = !data._notFound && !!data.published_at;
          check(`${c.id}:published`, published === (c.expectState === 'published'),
            `published=${published} expected=${c.expectState}`);
        } else if (c.kind === 'issue') {
          data = await api(`/repos/${c.repo}/issues/${c.number}`);
          check(`${c.id}:state`, data.state === c.expectState,
            `state=${data.state} expected=${c.expectState}`);
          // "no maintainer reply" is a claim about replies, not about state: an
          // issue stays open with a maintainer answer, and a state-only check
          // would keep passing while the page lied. Re-read the replies too.
          if ('expectCommentCount' in c) {
            const comments = await api(`/repos/${c.repo}/issues/${c.number}/comments`);
            const authors = Array.isArray(comments)
              ? [...new Set(comments.map((x) => x.user.login))] : null;
            check(`${c.id}:comment-count`, Array.isArray(comments) && comments.length === c.expectCommentCount,
              `comments=${Array.isArray(comments) ? comments.length : 'n/a'} expected=${c.expectCommentCount}`);
            if (Array.isArray(comments) && Array.isArray(c.expectCommentAuthors)) {
              const foreign = (authors ?? []).filter((a) => !c.expectCommentAuthors.includes(a));
              check(`${c.id}:comment-authors`, foreign.length === 0,
                foreign.length
                  ? `foreign authors: ${foreign.join(', ')} (expected subset of ${c.expectCommentAuthors.join(', ')})`
                  : `authors=${(authors ?? []).join(',') || '(none)'} (expected subset of ${c.expectCommentAuthors.join(', ')})`);
            }
          }
        }
      } catch (err) {
        check(`${c.id}:fetch`, false, `fetch failed: ${err.message}`, 'environment');
      }
    }
  }
}

for (const r of results) {
  console.log(`${r.ok ? 'ok  ' : r.kind === 'environment' ? 'warn' : 'DRIFT'}  ${r.id}: ${r.detail}`);
}
console.log('');
console.log(`claims: ${results.length}, drift: ${drift}, environment: ${environment}`);

if (drift > 0) {
  console.error('verdict: a published claim no longer matches reality — correct the page, do not weaken the claim');
  process.exit(1);
}
if (environment > 0) {
  console.error('verdict: not fully checked (environment) — this is NOT a pass and NOT a drift');
  process.exit(2);
}
console.log('verdict: every published claim still holds');
process.exit(0);
