#!/usr/bin/env node

// Usage:
//   node ./scripts/update_github_snapshot.mjs <owner> <repo> [outPath]
// Requires env: GITHUB_TOKEN

import fs from "node:fs/promises";

const owner = process.argv[2] || "better-auth";
const repo = process.argv[3] || "better-auth";
const outPath = process.argv[4] || `./public/data/github-${owner}-${repo}.json`;

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_PERSONAL_ACCESS_TOKEN || "";
if (!token) {
  console.error("GITHUB_TOKEN is required in env");
  process.exit(1);
}

async function gh(endpoint, accept) {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "analytics-snapshot",
      Accept: accept || "application/vnd.github+json",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status} ${endpoint}: ${text}`);
  }
  return await res.json();
}

async function ghWithHeaders(endpoint, accept) {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "analytics-snapshot",
      Accept: accept || "application/vnd.github+json",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status} ${endpoint}: ${text}`);
  }
  const json = await res.json();
  return { json, headers: res.headers };
}

function groupStargazersByDate(stargazers) {
  const map = new Map();
  for (const g of stargazers) {
    const d = g.starred_at ? new Date(g.starred_at) : null;
    if (!d || isNaN(d.getTime())) continue;
    const key = d.toISOString().slice(0, 10);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, count]) => ({ date, count }));
}

async function fetchRecentStargazers(maxPages = 30, perPage = 100) {
  const first = await ghWithHeaders(`/repos/${owner}/${repo}/stargazers?per_page=${perPage}&page=1`, "application/vnd.github.star+json");
  let lastPage = 1;
  const link = first.headers.get("link") || "";
  const lastMatch = link.match(/<([^>]+)>;\s*rel=\"last\"/);
  if (lastMatch && lastMatch[1]) {
    const url = new URL(lastMatch[1]);
    const p = url.searchParams.get("page");
    if (p) lastPage = parseInt(p, 10) || 1;
  }
  const start = Math.max(1, lastPage - maxPages + 1);
  const all = [];
  for (let page = lastPage; page >= start; page -= 1) {
    const { json } = await ghWithHeaders(`/repos/${owner}/${repo}/stargazers?per_page=${perPage}&page=${page}`, "application/vnd.github.star+json");
    if (!Array.isArray(json) || json.length === 0) break;
    all.push(...json);
  }
  // newest-first
  all.sort((a, b) => new Date(b.starred_at).getTime() - new Date(a.starred_at).getTime());
  return all;
}

(async () => {
  const repoData = await gh(`/repos/${owner}/${repo}`);
  const contributors = await gh(`/repos/${owner}/${repo}/contributors?per_page=100&anon=false`);
  const stargazersAll = await fetchRecentStargazers(60, 100);

  // Only enrich minimal per-user fields to avoid rate limits
  const recent = stargazersAll.slice(0, 200).map((s) => ({
    login: s.user?.login || s.login,
    starred_at: s.starred_at,
    avatar_url: s.user?.avatar_url || s.avatar_url,
  }));

  const stars_timeline = groupStargazersByDate(stargazersAll);

  const snapshot = {
    repo: {
      name: repoData.full_name || repoData.name,
      description: repoData.description || undefined,
      stars: repoData.stargazers_count || 0,
      forks: repoData.forks_count || 0,
      openIssues: repoData.open_issues_count || 0,
      watchers: repoData.subscribers_count || repoData.watchers_count || 0,
      owner: owner,
      owner_avatar_url: `https://github.com/${owner}.png`,
    },
    contributors: (Array.isArray(contributors) ? contributors : []).map((c) => ({
      login: c.login,
      contributions: c.contributions,
      avatar_url: c.avatar_url,
      html_url: c.html_url,
    })),
    stargazers: recent,
    stars_timeline,
    companies_summary: [],
  };

  await fs.writeFile(outPath, JSON.stringify(snapshot, null, 2));
  // eslint-disable-next-line no-console
  console.log(`Wrote ${outPath}`);
})().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});


