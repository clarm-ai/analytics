import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { d1All, d1Run, getUID } from "../../_lib/ctx";

export const runtime = "edge";
export const dynamic = "force-dynamic";

type GitHubStargazer = {
  login: string;
  starred_at?: string;
  avatar_url?: string;
  company?: string;
  company_org?: string;
  company_public_members?: number;
  html_url?: string;
};

async function safeJson(res: Response | undefined) {
  try {
    if (!res || !res.ok) return undefined;
    return await res.json();
  } catch {
    return undefined;
  }
}

function heuristicScore(s: GitHubStargazer): { score: number; reason: string } {
  const titleBoost = /cto|chief technology|vp eng|vp of engineering|head of eng|director of eng|founder|co[- ]founder|principal/i;
  const companyBoost = /openai|google|microsoft|amazon|aws|meta|facebook|datadog|vercel|cloudflare|hashicorp|stripe|uber|airbnb|netflix|snowflake/i;
  let score = 0;
  const reasons: string[] = [];
  if (s.company) {
    if (companyBoost.test(s.company)) { score += 12; reasons.push("known tech company"); }
    if (titleBoost.test(s.company)) { score += 16; reasons.push("senior title"); }
  }
  if (s.company_org) {
    score += 6; reasons.push(`org @${s.company_org}`);
  }
  if (typeof s.company_public_members === "number") {
    const m = s.company_public_members;
    if (m >= 50) { score += 16; reasons.push("large public member count"); }
    else if (m >= 10) { score += 8; reasons.push("medium public member count"); }
  }
  return { score, reason: reasons.join(", ") || "baseline" };
}

export async function GET(req: NextRequest) {
  const origin = new URL(req.url).origin;
  const url = new URL(req.url);
  const force = url.searchParams.get("force") || "";
  const uid = getUID(req as unknown as Request);

  // Prefer static snapshot first for MVP/stability, regardless of force.
  try {
    const local = await fetch(`${origin}/analytics/data/interesting_stargazers.json`);
    const json = await safeJson(local);
    if (Array.isArray(json) && json.length) {
      const items = json;
      return NextResponse.json({ items, source: "static" }, { status: 200 });
    }
  } catch {}

  // 2) Load GitHub data from our aggregated endpoint or static snapshot
  let gh: any = undefined;
  try {
    const res = await fetch(`${origin}/analytics/api/github`);
    gh = await safeJson(res);
  } catch {}
  if (!gh) {
    try {
      const snap = await fetch(`${origin}/analytics/data/github-better-auth-better-auth.json`);
      gh = await safeJson(snap);
    } catch {}
  }
  const stargazers: GitHubStargazer[] = Array.isArray(gh?.stargazers) ? gh.stargazers : [];
  if (!stargazers.length) return NextResponse.json({ items: [] }, { status: 200 });

  // Try D1 cache first unless force=live
  if (force !== "live") {
    try {
      const cached = await d1All<any>(
        `SELECT g.login, i.score, i.reason, g.avatar_url, g.company, g.company_org, g.company_public_members, g.html_url
         FROM gh_interesting i JOIN gh_stargazers g
           ON g.uid=i.uid AND g.login=i.login
         WHERE i.uid=?
         ORDER BY i.score DESC
         LIMIT 30`,
        uid
      );
      if (cached.length) {
        const items = cached.map((r) => ({
          login: r.login,
          score: r.score,
          reason: r.reason,
          avatar_url: r.avatar_url,
          company: r.company,
          company_org: r.company_org,
          company_public_members: r.company_public_members,
          html_url: r.html_url || `https://github.com/${r.login}`,
        }));
        return NextResponse.json({ items, source: "d1" }, { status: 200 });
      }
    } catch {}
  }

  // Prefer live LLM ranking when API key is available, unless force=static
  const apiKey = (globalThis as any).process?.env?.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (apiKey && force !== "static") {
    try {
      const client = new OpenAI({ apiKey });
      const max = Math.min(120, stargazers.length);
      const take = stargazers.slice(0, max);
      const batchSize = 60;
      const scores = new Map<string, { score: number; reason: string }>();
      for (let i = 0; i < take.length; i += batchSize) {
        const batch = take.slice(i, i + batchSize);
        const content = batch
          .map((s) => ({
            login: s.login,
            company: s.company || "",
            company_org: s.company_org || "",
            company_public_members: s.company_public_members || 0,
          }));
        const sys =
          "You are ranking GitHub stargazers most likely to be B2B buyers for a developer tool. Return ONLY strict JSON as {\"rank\":[{\"login\":\"...\",\"score\":0-100,\"reason\":\"...\"}...]}. Prioritize fast-growing companies (recent funding, headcount growth), and buyer titles like VP Engineering or CTO. Use heuristics from the provided fields; don't fabricate companies.";
        const user = `Stargazers: ${JSON.stringify(content)}`;
        const model = (globalThis as any).process?.env?.OPENAI_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
        const resp = await client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: sys },
            { role: "user", content: user },
          ],
          temperature: 0,
        });
        const text = resp.choices?.[0]?.message?.content || "{}";
        const parsed = JSON.parse(text);
        const rank: any[] = Array.isArray(parsed?.rank) ? parsed.rank : [];
        for (const r of rank) {
          const login = String(r?.login || "");
          if (!login) continue;
          const sc = Number(r?.score ?? 0);
          const rs = String(r?.reason || "LLM ranked");
          scores.set(login, { score: Math.max(0, Math.min(100, sc)), reason: rs });
        }
      }
      const ranked = take.map((s) => ({ login: s.login, ...(scores.get(s.login) || heuristicScore(s)) }));
      ranked.sort((a, b) => b.score - a.score);
      const byLogin = new Map(stargazers.map((s) => [s.login, s] as const));
      const items = ranked.slice(0, 30).map((r) => {
        const s = byLogin.get(r.login);
        return {
          login: r.login,
          score: r.score,
          reason: r.reason,
          avatar_url: s?.avatar_url,
          company: s?.company,
          company_org: s?.company_org,
          company_public_members: s?.company_public_members,
          html_url: s?.html_url || `https://github.com/${r.login}`,
        };
      });
      // Upsert into D1 cache for subsequent requests
      try {
        const now = Date.now();
        for (const it of items) {
          await d1Run(
            `INSERT INTO gh_stargazers(uid, login, starred_at, avatar_url, company, company_org, company_public_members, html_url)
             VALUES(?,?,?,?,?,?,?,?)
             ON CONFLICT(uid,login) DO UPDATE SET avatar_url=excluded.avatar_url, company=excluded.company,
               company_org=excluded.company_org, company_public_members=excluded.company_public_members, html_url=excluded.html_url`,
            uid, it.login, null, it.avatar_url || null, it.company || null, it.company_org || null, it.company_public_members || null, it.html_url
          );
          await d1Run(
            `INSERT INTO gh_interesting(uid, login, score, reason, last_scored_at)
             VALUES(?,?,?,?,?)
             ON CONFLICT(uid,login) DO UPDATE SET score=excluded.score, reason=excluded.reason, last_scored_at=excluded.last_scored_at`,
            uid, it.login, it.score, it.reason, now
          );
        }
      } catch {}
      return NextResponse.json({ items, source: "llm" }, { status: 200 });
    } catch {
      // fall through to static/heuristic
    }
  }

  // If no API key or LLM failed, try static DB unless force=live
  if (force !== "live") {
    try {
      const local = await fetch(`${origin}/analytics/data/interesting_stargazers.json`);
      const json = await safeJson(local);
      if (Array.isArray(json) && json.length) {
        return NextResponse.json({ items: json, source: "static" }, { status: 200 });
      }
    } catch {}
  }

  // Final fallback: heuristic ranking
  const ranked = stargazers.slice(0, 120).map((s) => ({ login: s.login, ...heuristicScore(s) }));
  ranked.sort((a, b) => b.score - a.score);
  const byLogin = new Map(stargazers.map((s) => [s.login, s] as const));
  const items = ranked.slice(0, 30).map((r) => {
    const s = byLogin.get(r.login);
    return {
      login: r.login,
      score: r.score,
      reason: r.reason,
      avatar_url: s?.avatar_url,
      company: s?.company,
      company_org: s?.company_org,
      company_public_members: s?.company_public_members,
      html_url: s?.html_url || `https://github.com/${r.login}`,
    };
  });
  // Cache heuristic results too
  try {
    const now = Date.now();
    for (const it of items) {
      await d1Run(
        `INSERT INTO gh_stargazers(uid, login, starred_at, avatar_url, company, company_org, company_public_members, html_url)
         VALUES(?,?,?,?,?,?,?,?)
         ON CONFLICT(uid,login) DO UPDATE SET avatar_url=excluded.avatar_url, company=excluded.company,
           company_org=excluded.company_org, company_public_members=excluded.company_public_members, html_url=excluded.html_url`,
        uid, it.login, null, it.avatar_url || null, it.company || null, it.company_org || null, it.company_public_members || null, it.html_url
      );
      await d1Run(
        `INSERT INTO gh_interesting(uid, login, score, reason, last_scored_at)
         VALUES(?,?,?,?,?)
         ON CONFLICT(uid,login) DO UPDATE SET score=excluded.score, reason=excluded.reason, last_scored_at=excluded.last_scored_at`,
        uid, it.login, it.score, it.reason, now
      );
    }
  } catch {}
  return NextResponse.json({ items, source: "heuristic" }, { status: 200 });
}


