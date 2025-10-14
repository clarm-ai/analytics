import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// Minimal fetch wrapper to GitHub REST API
async function gh<T>(endpoint: string, token: string, accept?: string): Promise<T> {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "analytics-dashboard",
      Accept: accept || "application/vnd.github+json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status} ${endpoint}`);
  }
  return (await res.json()) as T;
}

// Fetch with headers
async function ghWithHeaders(endpoint: string, token: string, accept?: string): Promise<{ json: any; headers: Headers }> {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "analytics-dashboard",
      Accept: accept || "application/vnd.github+json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status} ${endpoint}`);
  }
  const json = await res.json();
  return { json, headers: res.headers };
}

export async function GET(_req: NextRequest) {
  try {
    const owner = "better-auth";
    const repo = "better-auth";
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_PERSONAL_ACCESS_TOKEN || "";

    // Cache file under project data
    const projectRoot = path.resolve(process.cwd(), "../../");
    const cachePath = path.join(projectRoot, "data", `github-${owner}-${repo}.json`);
    const url = new URL(_req.url);
    const forceRefresh = url.searchParams.get("refresh") === "1";

    // If not refreshing, prefer cache
    if (!forceRefresh && fs.existsSync(cachePath)) {
      try {
        const cachedRaw = fs.readFileSync(cachePath, "utf-8");
        const cached = JSON.parse(cachedRaw);
        return NextResponse.json(cached, { status: 200, headers: { "x-github-cache": "hit" } });
      } catch {
        // ignore invalid cache
      }
    }

    // If no token and we have cache, serve cached as stale
    if (!token && fs.existsSync(cachePath)) {
      try {
        const cachedRaw = fs.readFileSync(cachePath, "utf-8");
        const cached = JSON.parse(cachedRaw);
        return NextResponse.json(cached, { status: 200, headers: { "x-github-cache": "stale" } });
      } catch {
        // fall through to 400
      }
    }
    if (!token) {
      return NextResponse.json({ error: "GITHUB_TOKEN missing in environment" }, { status: 400 });
    }

    // Repo summary
    const repoData = await gh<any>(`/repos/${owner}/${repo}`, token);

    // Contributors (use anonymous=false)
    // Note: GitHub API paginates; we fetch top 100 contributors
    const contributors = await gh<any[]>(`/repos/${owner}/${repo}/contributors?per_page=100&anon=false`, token);

    // Recent stargazers with timestamps requires custom Accept header
    // Paginate to build a more complete timeline (cap pages to avoid rate limits)
    async function fetchRecentStargazers(maxPages = 50, perPage = 100): Promise<any[]> {
      // Discover last page via Link header
      const first = await ghWithHeaders(`/repos/${owner}/${repo}/stargazers?per_page=${perPage}&page=1`, token, "application/vnd.github.star+json");
      let lastPage = 1;
      const link = first.headers.get("link") || "";
      const lastMatch = link.match(/<([^>]+)>;\s*rel=\"last\"/);
      if (lastMatch && lastMatch[1]) {
        const url = new URL(lastMatch[1]);
        const p = url.searchParams.get("page");
        if (p) lastPage = parseInt(p, 10) || 1;
      }
      const start = Math.max(1, lastPage - maxPages + 1);
      const all: any[] = [];
      for (let page = lastPage; page >= start; page -= 1) {
        const { json } = await ghWithHeaders(`/repos/${owner}/${repo}/stargazers?per_page=${perPage}&page=${page}`, token, "application/vnd.github.star+json");
        const batch = Array.isArray(json) ? json : [];
        if (batch.length === 0) break;
        all.push(...batch);
      }
      return all;
    }
    const stargazersAll = await fetchRecentStargazers(50, 100); // up to ~5000 recent

    // (moved enrichment below to only apply to the most recent items)

    // Stars timeline: group by day across all collected stargazers
    const timelineMap = new Map<string, number>();
    for (const g of stargazersAll) {
      const d = g.starred_at ? new Date(g.starred_at) : null;
      if (!d || isNaN(d.getTime())) continue;
      const key = d.toISOString().slice(0, 10);
      timelineMap.set(key, (timelineMap.get(key) || 0) + 1);
    }
    const stars_timeline = [...timelineMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, count]) => ({ date, count }));

    // For recent stargazers list and companies summary, only enrich the most recent ~50
    const recent = stargazersAll.slice(0, 50);
    const enriched = await Promise.all(
      recent.map(async (s) => {
        const login = s.user?.login || s.login;
        let company: string | undefined = undefined;
        let avatar_url: string | undefined = s.user?.avatar_url || s.avatar_url;
        let starred_at: string | undefined = s.starred_at;
        let company_org: string | undefined = undefined;
        let company_public_members: number | undefined = undefined;
        try {
          const u = await gh<any>(`/users/${login}`, token);
          company = u.company || undefined;
          avatar_url = u.avatar_url || avatar_url;
          if (company && company.startsWith("@")) {
            const org = company.replace(/^@/, "").trim();
            company_org = org;
            try {
              const members = await gh<any[]>(`/orgs/${org}/public_members?per_page=1`, token);
              company_public_members = Array.isArray(members) ? members.length : undefined;
            } catch {
              // ignore org lookup errors
            }
          }
        } catch {
          // ignore user fetch errors
        }
        return { login, starred_at, avatar_url, company, company_org, company_public_members };
      })
    );

    // Companies summary by org handle when present
    const companyCount = new Map<string, { company_org: string; stargazer_count: number; public_members?: number }>();
    for (const s of enriched) {
      if (s.company_org) {
        const prev = companyCount.get(s.company_org) || { company_org: s.company_org, stargazer_count: 0, public_members: s.company_public_members };
        prev.stargazer_count += 1;
        if (typeof s.company_public_members === "number") prev.public_members = s.company_public_members;
        companyCount.set(s.company_org, prev);
      }
    }
    const companies_summary = [...companyCount.values()].sort((a, b) => b.stargazer_count - a.stargazer_count);

    const body = {
      repo: {
        name: repoData.full_name || repoData.name,
        description: repoData.description || undefined,
        stars: repoData.stargazers_count || 0,
        forks: repoData.forks_count || 0,
        openIssues: repoData.open_issues_count || 0,
        watchers: repoData.subscribers_count || repoData.watchers_count || 0,
      },
      contributors: contributors.map((c) => ({ login: c.login, contributions: c.contributions, avatar_url: c.avatar_url, html_url: c.html_url })),
      stargazers: enriched,
      stars_timeline,
      companies_summary,
    };

    try {
      fs.writeFileSync(cachePath, JSON.stringify(body, null, 2), "utf-8");
    } catch {
      // ignore cache write errors
    }

    return NextResponse.json(body, { status: 200, headers: { "x-github-cache": "miss" } });
  } catch (err: unknown) {
    // On failure, try to serve cached data if present
    try {
      const projectRoot = path.resolve(process.cwd(), "../../");
      const cachePath = path.join(projectRoot, "data", `github-better-auth-better-auth.json`);
      if (fs.existsSync(cachePath)) {
        const cachedRaw = fs.readFileSync(cachePath, "utf-8");
        const cached = JSON.parse(cachedRaw);
        return NextResponse.json(cached, { status: 200, headers: { "x-github-cache": "stale" } });
      }
    } catch {
      // ignore and fall through
    }
    const message = err instanceof Error ? err.message : "Failed to fetch GitHub data";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
