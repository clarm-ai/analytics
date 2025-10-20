#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";

// Load local env for GitHub token
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });

// Allow overriding via CLI: node fetch_github_snapshot.mjs owner repo
// or REPO="owner/name" env var
const argv = process.argv.slice(2);
let OWNER = "better-auth";
let REPO = "better-auth";
const fromEnv = process.env.REPO || process.env.GITHUB_REPO;
if (fromEnv && fromEnv.includes("/")) {
  const [o, r] = fromEnv.split("/");
  if (o && r) { OWNER = o; REPO = r; }
}
if (argv.length >= 2) {
  OWNER = argv[0] || OWNER;
  REPO = argv[1] || REPO;
} else if (argv.length === 1 && argv[0].includes("/")) {
  const [o, r] = argv[0].split("/");
  if (o && r) { OWNER = o; REPO = r; }
}
const API_BASE = "https://api.github.com";

function requireToken() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_PERSONAL_ACCESS_TOKEN || "";
  if (!token) {
    throw new Error("GitHub token not found in .env (GITHUB_TOKEN or GH_TOKEN)");
  }
  return token;
}

async function fetchJson(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.json();
}

async function fetchRepoSummary(headers) {
  const url = `${API_BASE}/repos/${OWNER}/${REPO}`;
  return fetchJson(url, headers);
}

async function fetchOwnerAvatar(headers) {
  try {
    // Prefer org endpoint; fallback to user endpoint
    const org = await fetchJson(`${API_BASE}/orgs/${OWNER}`, headers).catch(() => null);
    if (org && org.avatar_url) return { owner_avatar_url: org.avatar_url };
  } catch {}
  try {
    const user = await fetchJson(`${API_BASE}/users/${OWNER}`, headers).catch(() => null);
    if (user && user.avatar_url) return { owner_avatar_url: user.avatar_url };
  } catch {}
  return { owner_avatar_url: `https://github.com/${OWNER}.png` };
}

async function fetchContributors(headers) {
  const url = `${API_BASE}/repos/${OWNER}/${REPO}/contributors?per_page=100&anon=false`;
  return fetchJson(url, headers);
}

async function fetchRecentStargazers(headers, pagesBack = 20, perPage = 100) {
  // First request to discover last page
  const firstUrl = `${API_BASE}/repos/${OWNER}/${REPO}/stargazers?per_page=${perPage}&page=1`;
  const firstRes = await fetch(firstUrl, { headers: { ...headers, Accept: "application/vnd.github.star+json" } });
  if (!firstRes.ok) throw new Error(`HTTP ${firstRes.status} for ${firstUrl}`);
  const firstJson = await firstRes.json();
  let lastPage = 1;
  const link = firstRes.headers.get("link") || "";
  const lastMatch = link.match(/<([^>]+)>;\s*rel="last"/);
  if (lastMatch && lastMatch[1]) {
    const u = new URL(lastMatch[1]);
    const p = u.searchParams.get("page");
    if (p) lastPage = parseInt(p, 10) || 1;
  }
  const start = Math.max(1, lastPage - pagesBack + 1);
  const out = Array.isArray(firstJson) ? [...firstJson] : [];
  // Walk backwards from last page to gather recent history
  for (let page = lastPage; page >= start; page -= 1) {
    if (page === 1) continue; // already have page 1
    const url = `${API_BASE}/repos/${OWNER}/${REPO}/stargazers?per_page=${perPage}&page=${page}`;
    const res = await fetch(url, { headers: { ...headers, Accept: "application/vnd.github.star+json" } });
    if (!res.ok) break;
    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length === 0) break;
    out.push(...arr);
  }
  return out;
}

function buildStarsTimeline(stargazers) {
  const perDay = new Map();
  for (const g of stargazers) {
    const d = g?.starred_at ? new Date(g.starred_at) : null;
    if (!d || Number.isNaN(d.getTime())) continue;
    const key = d.toISOString().slice(0, 10);
    perDay.set(key, (perDay.get(key) || 0) + 1);
  }
  return [...perDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, count]) => ({ date, count }));
}

async function enrichUsers(logins, headers) {
  const out = new Map();
  // Deduplicate org lookups for efficiency
  const orgCache = new Map(); // org_login -> { public_members?: number }
  for (const login of logins) {
    try {
      const u = await fetchJson(`${API_BASE}/users/${login}`, headers);
      // Try to infer org handle from user orgs API (first org)
      let company_org = undefined;
      try {
        const orgs = await fetchJson(`${API_BASE}/users/${login}/orgs?per_page=100`, headers);
        if (Array.isArray(orgs) && orgs.length) {
          company_org = orgs[0]?.login || undefined;
        }
      } catch {}
      // Estimate public members count for that org via Link header trick
      let company_public_members = undefined;
      if (company_org) {
        try {
          if (!orgCache.has(company_org)) {
            const res = await fetch(`${API_BASE}/orgs/${company_org}/public_members?per_page=1`, { headers });
            let count = undefined;
            if (res.ok) {
              const link = res.headers.get("link") || "";
              const m = link.match(/&page=(\d+)>;\s*rel="last"/);
              if (m && m[1]) count = parseInt(m[1], 10) || undefined;
              // If no pagination, read body length (0 or 1)
              if (count === undefined) {
                const arr = await res.json().catch(() => []);
                if (Array.isArray(arr)) count = arr.length;
              }
            }
            orgCache.set(company_org, { public_members: count });
          }
          company_public_members = orgCache.get(company_org)?.public_members;
        } catch {}
      }
      out.set(login, {
        company: u?.company || undefined,
        company_org,
        company_public_members,
        html_url: u?.html_url || `https://github.com/${login}`,
        avatar_url: u?.avatar_url,
      });
    } catch {
      // ignore individual failures
    }
  }
  return out;
}

async function slimRecentStargazers(stargazers, headers, take = 50) {
  const base = stargazers.slice(0, take).map((s) => ({
    login: s?.user?.login || s?.login,
    starred_at: s?.starred_at,
    avatar_url: s?.user?.avatar_url || s?.avatar_url,
  }));
  const logins = base.map((s) => s.login).filter(Boolean);
  const enrich = await enrichUsers(logins, headers);
  return base.map((s) => ({
    login: s.login,
    starred_at: s.starred_at,
    avatar_url: enrich.get(s.login)?.avatar_url || s.avatar_url,
    company: enrich.get(s.login)?.company,
    company_org: enrich.get(s.login)?.company_org,
    company_public_members: enrich.get(s.login)?.company_public_members,
    html_url: enrich.get(s.login)?.html_url || `https://github.com/${s.login}`,
  }));
}

async function main() {
  const token = requireToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    "User-Agent": "analytics-local-refresh",
    Accept: "application/vnd.github+json",
  };

  const [repoData, contributors, stargazersRaw, ownerMeta] = await Promise.all([
    fetchRepoSummary(headers),
    fetchContributors(headers),
    fetchRecentStargazers(headers, 20, 100),
    fetchOwnerAvatar(headers),
  ]);

  // Ensure newest-first order
  stargazersRaw.sort((a, b) => {
    const ta = a?.starred_at ? new Date(a.starred_at).getTime() : 0;
    const tb = b?.starred_at ? new Date(b.starred_at).getTime() : 0;
    return tb - ta;
  });
  const stars_timeline = buildStarsTimeline(stargazersRaw);
  const stargazers = await slimRecentStargazers(stargazersRaw, headers, 50);

  const payload = {
    repo: {
      name: repoData.full_name || repoData.name,
      description: repoData.description || undefined,
      stars: repoData.stargazers_count || 0,
      forks: repoData.forks_count || 0,
      openIssues: repoData.open_issues_count || 0,
      watchers: repoData.subscribers_count || repoData.watchers_count || 0,
      owner: OWNER,
      owner_avatar_url: ownerMeta?.owner_avatar_url,
    },
    contributors: contributors.map((c) => ({
      login: c.login,
      contributions: c.contributions,
      avatar_url: c.avatar_url,
      html_url: c.html_url,
    })),
    stargazers,
    stars_timeline,
    companies_summary: [],
  };

  const outDir = path.join(process.cwd(), "public", "data");
  const outFile = path.join(outDir, `github-${OWNER}-${REPO}.json`);
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(outFile, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`Wrote ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


