import { NextRequest, NextResponse } from "next/server";
import { d1Run, getUID } from "./../_lib/ctx";

export const runtime = "edge";
// Remove Next.js dynamic flag to avoid implicit fetch({ cache: 'no-store' })

// Minimal fetch wrapper to GitHub REST API
async function gh<T>(endpoint: string, token: string, accept?: string): Promise<T> {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "analytics-dashboard",
      Accept: accept || "application/vnd.github+json",
    }
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
    }
  });
  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status} ${endpoint}`);
  }
  const json = await res.json();
  return { json, headers: res.headers };
}

export async function GET(req: NextRequest) {
  try {
    const uid = getUID(req as unknown as Request);
    const u = new URL(req.url);
    const owner = (u.searchParams.get('owner') || 'better-auth').trim();
    const repo = (u.searchParams.get('repo') || 'better-auth').trim();
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_PERSONAL_ACCESS_TOKEN || "";
    const origin = new URL(req.url).origin;
    if (!token) {
      // Fallback to static snapshot when token is missing (Pages production)
      try {
        const local = await fetch(`${origin}/analytics/data/github-${owner}-${repo}.json`).catch(() => null);
        if (local && local.ok) {
          const json = await local.json();
          return NextResponse.json(json, { status: 200 });
        }
        const remote = await fetch(
          `https://raw.githubusercontent.com/dialin-ai/analytics/main/apps/web/public/data/github-${owner}-${repo}.json`
        ).catch(() => null);
        if (remote && remote.ok) {
          const json = await remote.json();
          return NextResponse.json(json, { status: 200 });
        }
      } catch {}
      return NextResponse.json({ error: "GITHUB_TOKEN missing in environment" }, { status: 400 });
    }

    // Repo summary
    const repoData = await gh<any>(`/repos/${owner}/${repo}`, token);

    // Contributors (use anonymous=false)
    // Note: GitHub API paginates; we fetch top 100 contributors
    const contributors = await gh<any[]>(`/repos/${owner}/${repo}/contributors?per_page=100&anon=false`, token);

    // Recent stargazers with timestamps requires custom Accept header
    // Paginate to build a more complete timeline (cap pages to avoid rate limits)
    async function fetchRecentStargazers(maxPages = 10, perPage = 100): Promise<any[]> {
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
    let stargazersAll = await fetchRecentStargazers(50, 100); // up to ~5000 recent
    // Optional from/to bounds
    // Ignore any external date filters: always return overall recent stargazers/timeline
    // Ensure newest first
    stargazersAll.sort((a, b) => {
      const ta = a.starred_at ? new Date(a.starred_at).getTime() : 0;
      const tb = b.starred_at ? new Date(b.starred_at).getTime() : 0;
      return tb - ta;
    });

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
    // Avoid per-user API calls to stay under Cloudflare subrequest limits.
    const enriched = recent.map((s) => {
      const login = s.user?.login || s.login;
      const avatar_url = s.user?.avatar_url || s.avatar_url;
      const starred_at = s.starred_at as string | undefined;
      return { login, starred_at, avatar_url, company: undefined as string | undefined, company_org: undefined as string | undefined, company_public_members: undefined as number | undefined };
    });

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
    // Upsert enriched recent stargazers into D1 (best-effort)
    try {
      for (const s of enriched) {
        await d1Run(
          `INSERT INTO gh_stargazers(uid, login, starred_at, avatar_url, company, company_org, company_public_members, html_url)
           VALUES(?,?,?,?,?,?,?,?)
           ON CONFLICT(uid,login) DO UPDATE SET starred_at=excluded.starred_at, avatar_url=excluded.avatar_url, company=excluded.company,
             company_org=excluded.company_org, company_public_members=excluded.company_public_members, html_url=excluded.html_url`,
          uid,
          s.login,
          s.starred_at || null,
          s.avatar_url || null,
          s.company || null,
          s.company_org || null,
          s.company_public_members || null,
          `https://github.com/${s.login}`
        );
      }
    } catch {}
    
    return NextResponse.json(body, { status: 200 });
  } catch (err: unknown) {
    // Fallback to static snapshot in /public when live fetch exceeds limits or fails
    try {
      const u = new URL(req.url);
      const origin = u.origin;
      const owner = (u.searchParams.get('owner') || 'better-auth').trim();
      const repo = (u.searchParams.get('repo') || 'better-auth').trim();
      const snap = await fetch(`${origin}/analytics/data/github-${owner}-${repo}.json`).catch(() => null);
      if (snap && snap.ok) {
        const json = await snap.json();
        return NextResponse.json(json, { status: 200 });
      }
      // Remote fallback from repository
      const remote = await fetch(
        `https://raw.githubusercontent.com/dialin-ai/analytics/main/apps/web/public/data/github-${owner}-${repo}.json`
      ).catch(() => null);
      if (remote && remote.ok) {
        const json = await remote.json();
        return NextResponse.json(json, { status: 200 });
      }
    } catch {}
    const message = err instanceof Error ? err.message : "Failed to fetch GitHub data";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
