"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Contributor = {
  authorId: string;
  displayName: string;
  avatarUrl?: string;
  count: number;
};

type WeekdayStats = {
  Monday: number;
  Tuesday: number;
  Wednesday: number;
  Thursday: number;
  Friday: number;
  Saturday: number;
  Sunday: number;
};

type StatsResponse = {
  contributors: Contributor[];
  weekdays: WeekdayStats;
  sampleSize: number;
};

type SEOKeywordCluster = {
  cluster: string; intent: "informational" | "commercial" | "navigational" | "transactional";
  primary: string; secondary: string[];
};
type SEOBrief = {
  slug: string; h1: string; title_tag: string; meta_description: string;
  outline: string[]; faqs: { q: string; a: string }[];
  internal_links: { anchor: string; url: string }[];
};
type SEOTask = { title: string; rationale: string; impact: 1|2|3; effort: 1|2|3; score: number };

type InsightsResponse = {
  topics: { topic: string; count: number }[];
  seo_recommendations: string[];
  unanswered_questions: string[];
  action_plans: string[];
  seo_keywords?: string[];
  seo_keyword_clusters?: SEOKeywordCluster[];
  seo_briefs?: SEOBrief[];
  seo_faqs?: { q: string; a: string; jsonld?: unknown }[];
  seo_titles?: { page: string; title_tag: string; meta_description: string }[];
  seo_tasks?: SEOTask[];
};

type GitHubContributor = {
  login: string;
  contributions: number;
  avatar_url?: string;
  html_url?: string;
};

type GitHubStargazer = {
  login: string;
  starred_at?: string;
  avatar_url?: string;
  company?: string;
  company_org?: string;
  company_public_members?: number;
};

type StarsTimelinePoint = { date: string; count: number };

type GitHubResponse = {
  repo: { name: string; description?: string; stars: number; forks: number; openIssues: number; watchers: number; owner_avatar_url?: string };
  contributors: GitHubContributor[];
  stargazers: GitHubStargazer[];
  stars_timeline: StarsTimelinePoint[];
  companies_summary: { company_org: string; stargazer_count: number; public_members?: number }[];
};

type InterestingItem = {
  login: string;
  score: number;
  reason: string;
  avatar_url?: string;
  company?: string;
  company_org?: string;
  company_public_members?: number;
  html_url?: string;
};

export default function Home() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [insights, setInsights] = useState<InsightsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"discord" | "github">("discord");
  const [gh, setGh] = useState<GitHubResponse | null>(null);
  // Repo switching (owner/name)
  const [repoOwner, setRepoOwner] = useState<string>("better-auth");
  const [repoName, setRepoName] = useState<string>("better-auth");
  const [showRepoMenu, setShowRepoMenu] = useState<boolean>(false);
  // Map repos -> Discord channel IDs (for static discord data)
  const repoToChannel: Record<string, string> = {
    "better-auth/better-auth": "1288403910284935182",
    "trycua/cua": "1328377437779787828",
  };
  // Currently selected mapping key and resolved channel id for Discord data
  const selectedKey = `${repoOwner}/${repoName}`;
  const selectedChannelId = repoToChannel[selectedKey] || "1288403910284935182";
  const [topicExamples, setTopicExamples] = useState<Record<string, { text: string; author?: string; when?: string }[]>>({});
  const [topicIndex, setTopicIndex] = useState<Record<string, string[]>>({});
  const [questionExamples, setQuestionExamples] = useState<Record<string, { text: string; author?: string; when?: string }[]>>({});
  const [interesting, setInteresting] = useState<InterestingItem[] | null>(null);
  // Date range selection
  const [rangeMode, setRangeMode] = useState<'all'|'7'|'30'|'90'|'custom'>('all');
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>('');
  const [discordMsgs, setDiscordMsgs] = useState<any[] | null>(null);

  function getRangeBounds(): { from?: number; to?: number } {
    if (rangeMode === 'all') return {};
    const now = Date.now();
    if (rangeMode === '7' || rangeMode === '30' || rangeMode === '90') {
      const days = Number(rangeMode);
      return { from: now - days * 86400000, to: now };
    }
    let from: number | undefined;
    let to: number | undefined;
    if (customFrom) {
      const d = new Date(customFrom + 'T00:00:00Z');
      if (!isNaN(d.getTime())) from = d.getTime();
    }
    if (customTo) {
      const d = new Date(customTo + 'T23:59:59Z');
      if (!isNaN(d.getTime())) to = d.getTime();
    }
    return { from, to };
  }

  function getRangeQuery(): string {
    const { from, to } = getRangeBounds();
    const parts: string[] = [];
    if (typeof from === 'number') parts.push(`from=${encodeURIComponent(String(from))}`);
    if (typeof to === 'number') parts.push(`to=${encodeURIComponent(String(to))}`);
    return parts.length ? `&${parts.join('&')}` : '';
  }

  function filterStargazersByRange(items: any[], from?: number, to?: number): any[] {
    if (!Array.isArray(items) || (!from && !to)) return Array.isArray(items) ? items : [];
    return items.filter((s) => {
      const t = s.starred_at ? new Date(s.starred_at).getTime() : NaN;
      if (Number.isNaN(t)) return false;
      if (from && t < from) return false;
      if (to && t > to) return false;
      return true;
    });
  }

  function buildTimelineFromStargazers(items: any[]): { date: string; count: number }[] {
    const map = new Map<string, number>();
    for (const s of items || []) {
      const t = s.starred_at ? new Date(s.starred_at) : null;
      if (!t || Number.isNaN(t.getTime())) continue;
      t.setUTCHours(0, 0, 0, 0);
      const key = t.toISOString().slice(0, 10);
      map.set(key, (map.get(key) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([date, count]) => ({ date, count }));
  }

  function applyGithubDateFilter(data: any, from?: number, to?: number): any {
    if (!data) return data;
    if (!from && !to) return data;
    const filteredStargazers = filterStargazersByRange(data.stargazers || [], from, to);
    const timeline = buildTimelineFromStargazers(filteredStargazers);
    return { ...data, stargazers: filteredStargazers, stars_timeline: timeline };
  }

  // GitHub section intentionally ignores date filters for stargazers and timeline

  async function computeStatsFromDiscord(prefix: string, channelId: string): Promise<StatsResponse | null> {
    try {
      const res = await fetch(`${prefix}/data/discord-${encodeURIComponent(channelId)}.json`, { cache: "no-store" }).catch(() => null);
      if (!res || !res.ok) return null;
      const arr: any[] = await res.json();
      if (!Array.isArray(arr) || !arr.length) return null;
      const { from, to } = getRangeBounds();
      const messages = arr.filter((m) => {
        const ts = String(m.timestamp || '').trim();
        const d = ts ? new Date(ts) : null;
        if (!d || Number.isNaN(d.getTime())) return false;
        const ms = d.getTime();
        if (from && ms < from) return false;
        if (to && ms > to) return false;
        return true;
      });
      const byId = new Map<string, Contributor>();
      const weekdays: WeekdayStats = { Monday: 0, Tuesday: 0, Wednesday: 0, Thursday: 0, Friday: 0, Saturday: 0, Sunday: 0 };
      const toWeekday = (d: Date): keyof WeekdayStats => {
        const idx = d.getDay();
        return (['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][idx] as keyof WeekdayStats) || 'Monday';
      };
      for (const m of messages) {
        const id = String(m.author_id || m.author || '').trim();
        if (id) {
          const display = String(m.author_display_name || m.author || id);
          const avatar = m.author_avatar_url || undefined;
          const prev = byId.get(id);
          if (prev) {
            prev.count += 1; if (!prev.avatarUrl && avatar) prev.avatarUrl = avatar; if (!prev.displayName && display) prev.displayName = display;
          } else {
            byId.set(id, { authorId: id, displayName: display, avatarUrl: avatar, count: 1 });
          }
        }
        const ts = String(m.timestamp || '').trim();
        if (ts) { const d = new Date(ts); if (!isNaN(d.getTime())) { const w = toWeekday(d); weekdays[w] += 1; } }
      }
      const contributors = Array.from(byId.values()).sort((a, b) => b.count - a.count).slice(0, 10);
      const sampleSize = Object.values(weekdays).reduce((a,b)=>a+b,0);
      return { contributors, weekdays, sampleSize };
    } catch { return null; }
  }

  const copyToClipboard = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {}
    }
  };

  const copyWithFeedback = async (button: HTMLButtonElement, value: string, copiedLabel = "Copied") => {
    const original = button.textContent || "Copy";
    try {
      button.disabled = true;
      await copyToClipboard(value);
      button.textContent = copiedLabel;
    } finally {
      setTimeout(() => {
        button.textContent = original;
        button.disabled = false;
      }, 1200);
    }
  };

  // Console banner to confirm successful deploy when the page loads
  useEffect(() => {
    try {
      const styleBadge = "background:#16a34a;color:#fff;padding:2px 6px;border-radius:4px";
      // eslint-disable-next-line no-console
      console.log("%cGrowMyOSS Analytics%c deploy successful", styleBadge, "");
      // eslint-disable-next-line no-console
      console.log("Build info:", {
        time: new Date().toISOString(),
        href: typeof window !== "undefined" ? window.location.href : "",
        basePath: "/analytics",
      });
    } catch {
      // ignore
    }
  }, []);

  // Auto-load Interesting Stargazers when GitHub tab opens
  useEffect(() => {
    async function loadInteresting() {
      try {
        const prefix = (typeof window !== "undefined" && (window.location.pathname.startsWith("/analytics") || window.location.pathname === "/")) ? "/analytics" : "";
        // Prefer repo-specific static snapshot
        const staticPath = `${prefix}/data/interesting_stargazers-${repoOwner}-${repoName}.json`;
        const snap = await fetch(staticPath, { cache: "no-store" }).catch(() => null);
        if (snap && snap.ok) {
          const items = await snap.json();
          setInteresting(Array.isArray(items) ? items : []);
          return;
        }
        // Fallback to generic file (legacy)
        const legacy = await fetch(`${prefix}/data/interesting_stargazers.json`, { cache: "no-store" }).catch(() => null);
        if (legacy && legacy.ok) {
          const items = await legacy.json();
          setInteresting(Array.isArray(items) ? items : []);
          return;
        }
        // Final fallback to API
        const res = await fetch(`${prefix}/api/github/interesting`, { cache: "no-store" }).catch(() => null);
        if (res && res.ok) {
          const data = await res.json();
          const items = Array.isArray(data.items) ? data.items : [];
          setInteresting(items);
        }
      } catch {}
    }
    if (activeTab === "github" && interesting === null) {
      loadInteresting();
    }
  }, [activeTab, interesting, repoOwner, repoName]);

  useEffect(() => {
    async function load() {
      try {
        // Build absolute paths with detected basePath to avoid root-relative 404s on Pages.
        const prefix = (typeof window !== "undefined" &&
          (window.location.pathname.startsWith("/analytics") || window.location.pathname === "/"))
          ? "/analytics"
          : "";
        // Resolve selected channel based on repo selection
        const selectedKey = `${repoOwner}/${repoName}`;
        const selectedChannelId = repoToChannel[selectedKey] || "1288403910284935182";
        const { from, to } = getRangeBounds();
        const fromParam = from ? `&from=${from}` : '';
        const toParam = to ? `&to=${to}` : '';
        const [sRes, iRes] = await Promise.all([
          fetch(`${prefix}/api/stats?channel=${encodeURIComponent(selectedChannelId)}${fromParam}${toParam}`, { cache: "no-store" }).catch(() => null),
          fetch(`${prefix}/api/insights?channel=${encodeURIComponent(selectedChannelId)}${fromParam}${toParam}`, { cache: "no-store" }).catch(() => null),
        ]);

        let usedStaticStats = false;
        if (sRes && sRes.ok) {
          const s: StatsResponse = await sRes.json();
          const totalWeekday = Object.values(s.weekdays || {}).reduce((a, b) => a + (b || 0), 0);
          if ((s.contributors?.length ?? 0) === 0 || totalWeekday === 0 || (s.sampleSize ?? 0) === 0) {
            // Try computing from per-channel static Discord dump
            const computed = await computeStatsFromDiscord(prefix, selectedChannelId);
            if (computed) {
              setStats(computed);
              usedStaticStats = true;
            } else {
              // Final fallback to legacy static
              const staticStats = await fetch(`${prefix}/stats.json`, { cache: "no-store" }).catch(() => null);
              if (staticStats && staticStats.ok) {
                const ss: StatsResponse = await staticStats.json();
                setStats(ss);
                usedStaticStats = true;
              } else {
                setStats(s);
              }
            }
          } else {
            setStats(s);
          }
        } else {
          const computed = await computeStatsFromDiscord(prefix, selectedChannelId);
          if (computed) {
            setStats(computed);
            usedStaticStats = true;
          } else {
            const staticStats = await fetch(`${prefix}/stats.json`, { cache: "no-store" }).catch(() => null);
            if (staticStats && staticStats.ok) {
              const s: StatsResponse = await staticStats.json();
              setStats(s);
              usedStaticStats = true;
            } else {
              throw new Error("Failed to load stats");
            }
          }
        }

        if (iRes && iRes.ok) {
          const i: InsightsResponse = await iRes.json();
          setInsights(i);
        } else {
          // Prefer per-channel static insights file
          const staticInsights = await fetch(`${prefix}/data/insights-${selectedChannelId}.json`, { cache: "no-store" }).catch(() => null);
          if (staticInsights && staticInsights.ok) {
            const i: InsightsResponse = await staticInsights.json();
            setInsights(i);
          } else {
            const legacy = await fetch(`${prefix}/insights.json`, { cache: "no-store" }).catch(() => null);
            if (legacy && legacy.ok) {
              const i: InsightsResponse = await legacy.json();
              setInsights(i);
            } else {
              setInsights({ topics: [], seo_recommendations: [], unanswered_questions: [], action_plans: [], seo_keywords: [] });
            }
          }
        }

        // Load precomputed topic index with example_ids if present
        const idxRes = await fetch(`${prefix}/data/topic_index-${selectedChannelId}.json`, { cache: "no-store" }).catch(() => null);
        if (idxRes && idxRes.ok) {
          const idx = await idxRes.json();
          const map: Record<string, string[]> = {};
          const { from, to } = getRangeBounds();
          for (const t of idx.topics || []) {
            if (!t || !t.topic) continue;
            let ids: string[] = Array.isArray(t.example_ids) ? t.example_ids : [];
            if (ids.length === 0) continue;
            // Best-effort: intersect with examples_index filtered by date range to ensure count is accurate
            try {
              const exIdxRes = await fetch(`${prefix}/data/examples_index-${selectedChannelId}.json`, { cache: 'no-store' }).catch(() => null);
              if (exIdxRes && exIdxRes.ok) {
                const exIdx = await exIdxRes.json();
                const arr: any[] = Array.isArray(exIdx[t.topic]) ? exIdx[t.topic] : [];
                if (arr.length) {
                  const filt = arr.filter((m: any) => {
                    const ts = new Date(String(m.timestamp || '')).getTime();
                    if (Number.isNaN(ts)) return false;
                    if (from && ts < from) return false;
                    if (to && ts > to) return false;
                    return true;
                  });
                  const idSet = new Set(filt.map((m: any) => String(m.message_id || '')));
                  ids = ids.filter((id) => idSet.has(String(id)));
                }
              }
            } catch {}
            map[t.topic] = ids;
          }
          setTopicIndex(map);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Failed to load";
        setError(msg);
      }
    }
    load();
  }, [repoOwner, repoName, rangeMode, customFrom, customTo]);

  const weekdayBars = useMemo(() => {
    if (!stats) return null;
    const entries = Object.entries(stats.weekdays);
    const max = Math.max(1, ...entries.map(([, v]) => v));
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 12 }}>
        {entries.map(([day, value]) => (
          <div key={day} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 12, color: "#cbd5e1" }}>{value}</div>
            <div
              style={{
                height: 120,
                width: "100%",
                background: "#1f2937",
                borderRadius: 8,
                display: "flex",
                alignItems: "flex-end",
                padding: 4,
              }}
            >
              <div
                style={{
                  width: "100%",
                  height: `${(value / max) * 100}%`,
                  background: "linear-gradient(180deg, #60a5fa, #3b82f6)",
                  borderRadius: 6,
                }}
                title={`${day}: ${value}`}
              />
            </div>
            <div style={{ fontSize: 12, color: "#cbd5e1", textAlign: "center" }}>{day.slice(0, 3)}</div>
          </div>
        ))}
      </div>
    );
  }, [stats]);

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto", color: "#e5e7eb" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "#3b82f6" }}>{activeTab === "github" ? "GitHub Analytics" : "Discord Analytics"}</h1>
        <nav style={{ display: "flex", gap: 8, alignItems: 'center' }}>
          <button
            onClick={() => setActiveTab("discord")}
            style={{
              background: activeTab === "discord" ? "#2563eb" : "#0b1220",
              border: "1px solid #1f2937",
              color: "#e5e7eb",
              padding: "6px 10px",
              borderRadius: 6,
            }}
          >
            Discord
          </button>
          <button
            onClick={async () => {
              setActiveTab("github");
              // Always refetch on tab switch (static snapshot, not date-filtered)
              setGh(null);
                try {
                  const prefix = (typeof window !== "undefined" &&
                    (window.location.pathname.startsWith("/analytics") || window.location.pathname === "/"))
                    ? "/analytics"
                    : "";
                  // Prefer repo-specific static snapshot first
                  const snap = await fetch(`${prefix}/data/github-${repoOwner}-${repoName}.json`, { cache: "no-store" }).catch(() => null);
                  if (snap && snap.ok) {
                    const data: GitHubResponse = await snap.json();
                    setGh(data);
                  } else {
                    // Fallback to API (works for default repo)
                    const res = await fetch(`${prefix}/api/github?owner=${encodeURIComponent(repoOwner)}&repo=${encodeURIComponent(repoName)}`, { cache: "no-store" }).catch(() => null);
                    if (res && res.ok) {
                      const data: GitHubResponse = await res.json();
                      setGh(data);
                    } else {
                      const fallback = await fetch(`${prefix}/github.json`, { cache: "no-store" }).catch(() => null);
                      if (fallback && fallback.ok) {
                        const data: GitHubResponse = await fallback.json();
                        setGh(data);
                      }
                    }
                  }
                } catch {
                  // ignore
                }
            }}
            style={{
              background: activeTab === "github" ? "#2563eb" : "#0b1220",
              border: "1px solid #1f2937",
              color: "#e5e7eb",
              padding: "6px 10px",
              borderRadius: 6,
            }}
          >
            GitHub
          </button>
          {/* Date range moved after GitHub */}
          <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <select value={rangeMode} onChange={(e)=> setRangeMode(e.target.value as any)} style={{ background: '#0b1220', color: '#e5e7eb', border: '1px solid #1f2937', borderRadius: 6, padding: '6px 8px' }}>
              <option value="all">All time</option>
              <option value="7">Last 7d</option>
              <option value="30">Last 30d</option>
              <option value="90">Last 90d</option>
              <option value="custom">Custom</option>
            </select>
            {rangeMode === 'custom' ? (
              <>
                <input type="date" value={customFrom} onChange={(e)=> setCustomFrom(e.target.value)} style={{ background: '#0b1220', color: '#e5e7eb', border: '1px solid #1f2937', borderRadius: 6, padding: '6px 8px' }} />
                <input type="date" value={customTo} onChange={(e)=> setCustomTo(e.target.value)} style={{ background: '#0b1220', color: '#e5e7eb', border: '1px solid #1f2937', borderRadius: 6, padding: '6px 8px' }} />
              </>
            ) : null}
          </div>
          {/* Repo switcher */}
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setShowRepoMenu((v) => !v)}
              style={{
                background: "#0b1220",
                border: "1px solid #1f2937",
                borderRadius: 999,
                padding: 2,
                width: 34,
                height: 34,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              title={`${repoOwner}/${repoName}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={(gh?.repo as any)?.owner_avatar_url || `https://github.com/${repoOwner}.png`} alt="repo avatar" width={28} height={28} style={{ borderRadius: 999 }} />
            </button>
            {showRepoMenu ? (
              <div style={{ position: "absolute", right: 0, top: 40, background: "#0b1220", border: "1px solid #1f2937", borderRadius: 8, minWidth: 220, zIndex: 10 }}>
                <div style={{ padding: 8, color: "#94a3b8", fontSize: 12 }}>Switch repository</div>
                <button
                  onClick={() => {
                    setRepoOwner("better-auth");
                    setRepoName("better-auth");
                    setGh(null); setInteresting(null); setShowRepoMenu(false);
                  }}
                  style={{ width: "100%", textAlign: "left", padding: 10, background: "transparent", border: 0, color: "#e5e7eb", cursor: "pointer" }}
                >
                  better-auth/better-auth
                </button>
                <a href={`https://github.com/trycua/cua`} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      setRepoOwner("trycua");
                      setRepoName("cua");
                      setGh(null); setInteresting(null); setShowRepoMenu(false);
                    }}
                    style={{ width: "100%", textAlign: "left", padding: 10, background: "transparent", border: 0, color: "#e5e7eb", cursor: "pointer" }}
                  >
                    trycua/cua
                  </button>
                </a>
              </div>
            ) : null}
          </div>
        </nav>
      </header>

      {error && (
        <div style={{ background: "#7f1d1d", padding: 12, borderRadius: 8, marginBottom: 16 }}>{error}</div>
      )}

      {activeTab === "discord" && (
      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 24 }}>
        <div style={{ background: "#0b1220", border: "1px solid #1f2937", borderRadius: 12, padding: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Top Topics</h2>
          {!insights ? (
            <div style={{ color: "#94a3b8" }}>Loading…</div>
          ) : insights.topics?.length ? (
            <div style={{ maxHeight: 420, overflowY: "auto" }}>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
              {insights.topics.slice(0, 10).map((t) => (
                <li
                  key={t.topic}
                  style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, background: "#0f172a", padding: 10, borderRadius: 8 }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                      <span>{t.topic}</span>
                      <button
                        style={{ background: "#111827", border: "1px solid #1f2937", color: "#cbd5e1", padding: "4px 8px", borderRadius: 6 }}
                        onClick={async () => {
                          try {
                            // Toggle close if already open
                            if (topicExamples[t.topic]) {
                              setTopicExamples((prev) => {
                                const next = { ...prev } as Record<string, { text: string; author?: string; when?: string }[]>;
                                delete next[t.topic];
                                return next;
                              });
                              return;
                            }
                            const prefix = (typeof window !== "undefined" && (window.location.pathname.startsWith("/analytics") || window.location.pathname === "/")) ? "/analytics" : "";
                            const selectedKeyInner = `${repoOwner}/${repoName}`;
                            const channelId = repoToChannel[selectedKeyInner] || "1288403910284935182";
                            const ids = topicIndex[t.topic];
                            let res: Response | null = null;
                            if (ids && ids.length) {
                              const { from, to } = getRangeBounds();
                              const fromParam = from ? `&from=${from}` : '';
                              const toParam = to ? `&to=${to}` : '';
                              res = await fetch(`${prefix}/api/examples?ids=${encodeURIComponent(ids.join(','))}&channel=${encodeURIComponent(channelId)}${fromParam}${toParam}`, { cache: 'no-store' });
                            }
                            if (!res || !res.ok) {
                              // Try strict topic selection first
                              const { from, to } = getRangeBounds();
                              const fromParam = from ? `&from=${from}` : '';
                              const toParam = to ? `&to=${to}` : '';
                              res = await fetch(`${prefix}/api/examples?topic=${encodeURIComponent(t.topic)}&limit=10&channel=${encodeURIComponent(channelId)}${fromParam}${toParam}`, { cache: "no-store" });
                            }
                            if (!res.ok) {
                              const { from, to } = getRangeBounds();
                              const fromParam = from ? `&from=${from}` : '';
                              const toParam = to ? `&to=${to}` : '';
                              res = await fetch(`${prefix}/api/examples?q=${encodeURIComponent(t.topic)}&limit=10&channel=${encodeURIComponent(channelId)}${fromParam}${toParam}`, { cache: "no-store" });
                            }
                            if (res && res.ok) {
                              const data = await res.json();
                              let items = Array.isArray(data.items) ? data.items : [];
                              if (!items.length) {
                                // Frontend static fallback for production edge quirks
                                const idxRes = await fetch(`${prefix}/data/examples_index-${selectedChannelId}.json`, { cache: 'no-store' }).catch(() => null);
                                if (idxRes && idxRes.ok) {
                                  const idx = await idxRes.json();
                                  const arr = Array.isArray(idx[t.topic]) ? idx[t.topic] : [];
                                  if (arr.length) items = arr.slice(0, 10);
                                }
                              }
                              const mapped = (items || [])
                                .filter((m: any) => typeof m.text === 'string' && m.text.trim().length > 0)
                                .map((m: any) => ({ text: m.text as string, author: m.author_display_name || m.author_id, when: m.timestamp }));
                              setTopicExamples((prev) => ({ ...prev, [t.topic]: mapped }));
                            }
                          } catch {}
                        }}
                      >
                        Examples
                      </button>
                    </div>
                    {topicExamples[t.topic] ? (
                      <ul style={{ marginTop: 8, paddingLeft: 16, display: "grid", gap: 6, maxHeight: 200, overflowY: "auto" }}>
                        {topicExamples[t.topic].map((ex, i) => (
                          <li key={i} style={{ color: "#94a3b8", fontSize: 13 }}>
                            <span style={{ color: "#e5e7eb" }}>{ex.author || "user"}</span>: {ex.text}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  <span style={{ color: "#94a3b8", textAlign: "right" }}>{t.count}</span>
                </li>
              ))}
            </ul>
            </div>
          ) : (
            <div style={{ color: "#94a3b8" }}>No topics found.</div>
          )}
        </div>

        <div style={{ background: "#0b1220", border: "1px solid #1f2937", borderRadius: 12, padding: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Top Contributors</h2>
          {!stats ? (
            <div style={{ color: "#94a3b8" }}>Loading…</div>
          ) : stats.contributors.length ? (
            <div style={{ maxHeight: 300, overflowY: "auto" }}>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
                {stats.contributors.map((c) => (
                  <li key={c.authorId} style={{ display: "flex", alignItems: "center", gap: 12, background: "#0f172a", padding: 10, borderRadius: 8 }}>
                    {c.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.avatarUrl} alt="avatar" width={32} height={32} style={{ borderRadius: 999 }} />
                    ) : (
                      <div style={{ width: 32, height: 32, borderRadius: 999, background: "#1f2937" }} />
                    )}
                    <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{c.displayName}</div>
                        <div style={{ color: "#94a3b8", fontSize: 12 }}>{c.authorId}</div>
                      </div>
                      <div style={{ color: "#93c5fd" }}>{c.count}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div style={{ color: "#94a3b8" }}>No contributors.</div>
          )}
        </div>
      </section>
      )}

      {activeTab === "discord" && (
      <section style={{ background: "#0b1220", border: "1px solid #1f2937", borderRadius: 12, padding: 16, marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Contributions by Weekday</h2>
        <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 8 }}>Contribution = one Discord message posted in the server.</div>
        {!stats ? <div style={{ color: "#94a3b8" }}>Loading…</div> : weekdayBars}
      </section>
      )}

      {activeTab === "discord" && (
      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        <div style={{ background: "#0b1220", border: "1px solid #1f2937", borderRadius: 12, padding: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>SEO Recommendations</h2>
          {!insights ? (
            <div style={{ color: "#94a3b8" }}>Loading…</div>
          ) : insights.seo_recommendations?.length ? (
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              {insights.seo_recommendations.slice(0, 3).map((r, i) => (
                <li key={i} style={{ marginBottom: 8 }}>{r}</li>
              ))}
            </ol>
          ) : (
            <div style={{ color: "#94a3b8" }}>No recommendations.</div>
          )}
          <div style={{ height: 12 }} />
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Keywords</h3>
          {!insights ? (
            <div style={{ color: "#94a3b8" }}>Loading…</div>
          ) : insights.seo_keywords && insights.seo_keywords.length ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {insights.seo_keywords.slice(0, 20).map((k, i) => (
                <span key={i} style={{ background: "#0f172a", border: "1px solid #1f2937", padding: "4px 8px", borderRadius: 999 }}>{k}</span>
              ))}
            </div>
          ) : (
            <div style={{ color: "#94a3b8" }}>No keywords.</div>
          )}
        </div>

        <div style={{ background: "#0b1220", border: "1px solid #1f2937", borderRadius: 12, padding: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Unanswered Questions</h2>
          {!insights ? (
            <div style={{ color: "#94a3b8" }}>Loading…</div>
          ) : insights.unanswered_questions?.length ? (
            <div style={{ maxHeight: 420, overflowY: "auto" }}>
              <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "grid", gap: 8 }}>
                {insights.unanswered_questions.slice(0, 10).map((q, i) => (
                  <li key={i} style={{ background: "#0f172a", padding: 10, borderRadius: 8 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "start" }}>
                      <div style={{ whiteSpace: "pre-wrap" }}>{q}</div>
                      <button
                        style={{ background: "#111827", border: "1px solid #1f2937", color: "#cbd5e1", padding: "4px 8px", borderRadius: 6 }}
                        onClick={async () => {
                          try {
                            // Toggle close if already open
                            if (questionExamples[q]) {
                              setQuestionExamples((prev) => {
                                const next = { ...prev } as Record<string, { text: string; author?: string; when?: string }[]>;
                                delete next[q];
                                return next;
                              });
                              return;
                            }
                            const prefix = (typeof window !== "undefined" && (window.location.pathname.startsWith("/analytics") || window.location.pathname === "/")) ? "/analytics" : "";
                            const selectedKeyInner = `${repoOwner}/${repoName}`;
                            const channelId = repoToChannel[selectedKeyInner] || "1288403910284935182";
                            const { from, to } = getRangeBounds();
                            const fromParam = from ? `&from=${from}` : '';
                            const toParam = to ? `&to=${to}` : '';
                            let res: Response | null = await fetch(`${prefix}/api/examples?q=${encodeURIComponent(q)}&limit=10&channel=${encodeURIComponent(channelId)}${fromParam}${toParam}`, { cache: "no-store" }).catch(() => null);
                            if (!res || !res.ok) {
                              // As a fallback, try topic selection using the full question text
                              res = await fetch(`${prefix}/api/examples?topic=${encodeURIComponent(q)}&limit=10&channel=${encodeURIComponent(channelId)}${fromParam}${toParam}`, { cache: "no-store" }).catch(() => null);
                            }
                            if (res && res.ok) {
                              const data = await res.json();
                              let items = Array.isArray(data.items) ? data.items : [];
                              if (!items.length) {
                                // Fallback to static examples index: pick messages with highest token overlap
                                const idxRes = await fetch(`${prefix}/data/examples_index-${selectedChannelId}.json`, { cache: 'no-store' }).catch(() => null);
                                if (idxRes && idxRes.ok) {
                                  const idx = await idxRes.json();
                                  const allItems: any[] = [];
                                  for (const arr of Object.values(idx as Record<string, any[]>)) {
                                    for (const m of (arr as any[])) allItems.push(m);
                                  }
                                  const qTokens = Array.from(new Set(q.toLowerCase().split(/[^a-z0-9]+/g).filter((w) => w && w.length >= 4)));
                                  items = allItems
                                    .map((m: any) => {
                                      const text = String(m.text || '').toLowerCase();
                                      let score = 0;
                                      if (text.includes(q.toLowerCase())) score += 5;
                                      for (const tok of qTokens) if (text.includes(tok)) score += 1;
                                      return { m, score };
                                    })
                                    .filter((r: any) => r.score > 0)
                                    .sort((a: any, b: any) => b.score - a.score)
                                    .slice(0, 10)
                                    .map((r: any) => r.m);
                                }
                              }
                              const mapped = (items || [])
                                .filter((m: any) => typeof m.text === 'string' && m.text.trim().length > 0)
                                .map((m: any) => ({ text: m.text as string, author: m.author_display_name || m.author_id, when: m.timestamp }));
                              setQuestionExamples((prev) => ({ ...prev, [q]: mapped }));
                            }
                          } catch {}
                        }}
                      >
                        View Question
                      </button>
                    </div>
                    {questionExamples[q] ? (
                      <ul style={{ marginTop: 8, paddingLeft: 16, display: "grid", gap: 6, maxHeight: 200, overflowY: "auto" }}>
                        {questionExamples[q].map((ex, j) => (
                          <li key={j} style={{ color: "#94a3b8", fontSize: 13 }}>
                            <span style={{ color: "#e5e7eb" }}>{ex.author || "user"}</span>: {ex.text}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div style={{ color: "#94a3b8" }}>No unanswered questions detected.</div>
          )}
        </div>

        {/* SEO Deep Dive */}
        <div style={{ background: "#0b1220", border: "1px solid #1f2937", borderRadius: 12, padding: 16, gridColumn: "1 / -1" }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>SEO Deep Dive</h2>
          {/* Keyword Clusters */}
          {insights?.seo_keyword_clusters?.length ? (
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Keyword Clusters</h3>
              <div style={{ display: "grid", gap: 8, height: 150, overflowY: "auto" }}>
                {insights.seo_keyword_clusters.map((c, i) => (
                  <div key={i} style={{ background: "#0f172a", border: "1px solid #1f2937", borderRadius: 8, padding: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <div><b>{c.cluster}</b> • {c.intent} • Primary: {c.primary}</div>
                      <button onClick={(e) => copyWithFeedback(e.currentTarget, [c.primary, ...c.secondary].join(", "))} style={{ background: "#111827", border: "1px solid #1f2937", color: "#cbd5e1", padding: "2px 6px", borderRadius: 6 }}>Copy</button>
                    </div>
                    {c.secondary?.length ? (<div style={{ color: "#94a3b8", fontSize: 13, marginTop: 6 }}>{c.secondary.join(" • ")}</div>) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* FAQ Ideas */}
          {insights?.seo_faqs?.length ? (
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>FAQ Ideas</h3>
              <div style={{ display: "grid", gap: 8, height: 150, overflowY: "auto" }}>
                {insights.seo_faqs.map((f, i) => (
                  <div key={i} style={{ background: "#0f172a", border: "1px solid #1f2937", borderRadius: 8, padding: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <div><b>Q:</b> {f.q}</div>
                      <button onClick={(e) => copyWithFeedback(e.currentTarget, typeof f.jsonld === "string" ? f.jsonld : JSON.stringify(f.jsonld || {}, null, 2), "Copied JSON-LD")} style={{ background: "#111827", border: "1px solid #1f2937", color: "#cbd5e1", padding: "2px 6px", borderRadius: 6 }}>Copy JSON-LD</button>
                    </div>
                    <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 6 }}><b>A:</b> {f.a}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Titles & Metas */}
          {insights?.seo_titles?.length ? (
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Titles & Metas</h3>
              <div style={{ display: "grid", gap: 8, height: 150, overflowY: "auto" }}>
                {insights.seo_titles.map((t, i) => (
                  <div key={i} style={{ background: "#0f172a", border: "1px solid #1f2937", borderRadius: 8, padding: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <div><b>{t.page}</b></div>
                      <button onClick={(e) => copyWithFeedback(e.currentTarget, JSON.stringify(t, null, 2))} style={{ background: "#111827", border: "1px solid #1f2937", color: "#cbd5e1", padding: "2px 6px", borderRadius: 6 }}>Copy</button>
                    </div>
                    <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 6 }}>{t.title_tag} — {t.meta_description}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div style={{ background: "#0b1220", border: "1px solid #1f2937", borderRadius: 12, padding: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Action Plans</h2>
          {!insights ? (
            <div style={{ color: "#94a3b8" }}>Loading…</div>
          ) : insights.action_plans?.length ? (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {insights.action_plans.slice(0, 6).map((q, i) => (
                <li key={i} style={{ marginBottom: 6 }}>{q}</li>
              ))}
            </ul>
          ) : (
            <div style={{ color: "#94a3b8" }}>No action plans.</div>
          )}
        </div>
      </section>
      )}

      {activeTab === "github" && (
      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        <div style={{ background: "#0b1220", border: "1px solid #1f2937", borderRadius: 12, padding: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Repository</h2>
          {!gh ? (
            <div style={{ color: "#94a3b8" }}>Loading…</div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ fontWeight: 600 }}>{gh.repo.name}</div>
              {gh.repo.description ? <div style={{ color: "#94a3b8" }}>{gh.repo.description}</div> : null}
              <div style={{ display: "flex", gap: 12, color: "#cbd5e1" }}>
                <span>Stars (in range): {gh.stargazers?.length ?? 0}</span>
                <span>Total Stars: {gh.repo.stars}</span>
                <span>Forks: {gh.repo.forks}</span>
                <span>Issues: {gh.repo.openIssues}</span>
                <span>Watchers: {gh.repo.watchers}</span>
              </div>
            </div>
          )}
        </div>

        <div style={{ background: "#0b1220", border: "1px solid #1f2937", borderRadius: 12, padding: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Top Contributors</h2>
          {!gh ? (
            <div style={{ color: "#94a3b8" }}>Loading…</div>
          ) : gh.contributors?.length ? (
            <div style={{ maxHeight: 300, overflowY: "auto" }}>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
                {gh.contributors.map((c) => {
                  const profile = c.html_url || `https://github.com/${c.login}`;
                  return (
                    <li key={c.login} style={{ display: "flex", alignItems: "center", gap: 12, background: "#0f172a", padding: 10, borderRadius: 8 }}>
                      <a href={profile} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex" }}>
                        {c.avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={c.avatar_url} alt="avatar" width={32} height={32} style={{ borderRadius: 999 }} />
                        ) : (
                          <div style={{ width: 32, height: 32, borderRadius: 999, background: "#1f2937" }} />
                        )}
                      </a>
                      <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
                        <div>
                          <a href={profile} target="_blank" rel="noopener noreferrer" style={{ color: "#e5e7eb", textDecoration: "none", fontWeight: 600 }}>{c.login}</a>
                          {profile ? <div style={{ color: "#94a3b8", fontSize: 12 }}>{profile}</div> : null}
                        </div>
                        <div style={{ color: "#93c5fd" }}>{c.contributions}</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <div style={{ color: "#94a3b8" }}>No contributors.</div>
          )}
        </div>

        <div style={{ background: "#0b1220", border: "1px solid #1f2937", borderRadius: 12, padding: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Recent Stargazers</h2>
          {!gh ? (
            <div style={{ color: "#94a3b8" }}>Loading…</div>
          ) : gh.stargazers?.length ? (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8, maxHeight: 360, overflowY: "auto" }}>
              {gh.stargazers.map((s) => {
                const profile = `https://github.com/${s.login}`;
                return (
                  <li key={s.login} style={{ display: "flex", alignItems: "center", gap: 12, background: "#0f172a", padding: 10, borderRadius: 8 }}>
                    <a href={profile} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex" }}>
                      {s.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={s.avatar_url} alt="avatar" width={28} height={28} style={{ borderRadius: 999 }} />
                      ) : (
                        <div style={{ width: 28, height: 28, borderRadius: 999, background: "#1f2937" }} />
                      )}
                    </a>
                    <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
                      <div>
                        <a href={profile} target="_blank" rel="noopener noreferrer" style={{ color: "#e5e7eb", textDecoration: "none", fontWeight: 600 }}>{s.login}</a>
                        <div style={{ color: "#94a3b8", fontSize: 12 }}>
                          {s.company ? s.company : "No company listed"}
                          {s.company_org ? ` • @${s.company_org}` : ""}
                          {typeof s.company_public_members === "number" ? ` • public members: ${s.company_public_members}` : ""}
                        </div>
                      </div>
                      <div style={{ color: "#cbd5e1", fontSize: 12 }}>{s.starred_at ? new Date(s.starred_at).toLocaleDateString() : ""}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div style={{ color: "#94a3b8" }}>No stargazers.</div>
          )}
        </div>

        <div style={{ background: "#0b1220", border: "1px solid #1f2937", borderRadius: 12, padding: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Stars Over Time (Last 24 Days)</h2>
          {!gh ? (
            <div style={{ color: "#94a3b8" }}>Loading…</div>
          ) : gh.stars_timeline?.length ? (
            (() => {
              // Build a continuous last-24-days series starting from today (UTC) and fill zeros
              const byDate = new Map<string, number>(gh.stars_timeline.map((p) => [p.date, p.count] as const));
              const today = new Date();
              today.setUTCHours(0, 0, 0, 0);
              const series: { date: string; count: number }[] = [];
              for (let offset = 23; offset >= 0; offset -= 1) {
                const d = new Date(today);
                d.setUTCDate(d.getUTCDate() - (23 - offset));
                const key = d.toISOString().slice(0, 10);
                const count = byDate.get(key) || 0;
                series.push({ date: key, count });
              }
              const max = Math.max(1, ...series.map((p) => p.count));
              return (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 8 }}>
                  {series.map((p) => (
                    <div key={p.date} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                      <div style={{ fontSize: 10, color: "#cbd5e1" }}>{p.count}</div>
                      <div style={{ height: 100, width: "100%", background: "#1f2937", borderRadius: 8, display: "flex", alignItems: "flex-end", padding: 4 }}>
                        <div style={{ width: "100%", height: `${(p.count / max) * 100}%`, background: "linear-gradient(180deg, #60a5fa, #3b82f6)", borderRadius: 6 }} title={`${p.date}: ${p.count}`} />
                      </div>
                      <div style={{ fontSize: 10, color: "#cbd5e1", textAlign: "center" }}>{new Date(p.date).toLocaleDateString()}</div>
                    </div>
                  ))}
                </div>
              );
            })()
          ) : (
            <div style={{ color: "#94a3b8" }}>No stars data.</div>
          )}
        </div>

        <div style={{ background: "#0b1220", border: "1px solid #1f2937", borderRadius: 12, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600 }}>Interesting Stargazers</h2>
            <button
              style={{ background: "#111827", border: "1px solid #1f2937", color: "#cbd5e1", padding: "4px 8px", borderRadius: 6 }}
              onClick={async () => {
                try {
                  const prefix = (typeof window !== "undefined" && (window.location.pathname.startsWith("/analytics") || window.location.pathname === "/")) ? "/analytics" : "";
                  const res = await fetch(`${prefix}/api/github/interesting`, { cache: "no-store" }).catch(() => null);
                  if (res && res.ok) {
                    const data = await res.json();
                    const items = Array.isArray(data.items) ? data.items : [];
                    if (items.length) {
                      setInteresting(items);
                      return;
                    }
                  }
                  {
                    const snap = await fetch(`${prefix}/data/interesting_stargazers-${repoOwner}-${repoName}.json`, { cache: "no-store" }).catch(() => null);
                    if (snap && snap.ok) {
                      const items = await snap.json();
                      setInteresting(Array.isArray(items) ? items : []);
                    }
                  }
                } catch {}
              }}
            >
              Refresh
            </button>
          </div>
          {/* Column header to clarify score meaning */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ color: "#94a3b8", fontSize: 12 }}>Stargazer</div>
            <div style={{ color: "#94a3b8", fontSize: 12 }}>Score</div>
          </div>
          {!interesting ? (
            <div style={{ color: "#94a3b8" }}>Loading…</div>
          ) : interesting.length ? (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8, maxHeight: 360, overflowY: "auto" }}>
              {interesting.map((s) => (
                <li key={s.login} style={{ display: "flex", alignItems: "center", gap: 12, background: "#0f172a", padding: 10, borderRadius: 8 }}>
                  <a href={s.html_url || `https://github.com/${s.login}`} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex" }}>
                    {s.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.avatar_url} alt="avatar" width={28} height={28} style={{ borderRadius: 999 }} />
                    ) : (
                      <div style={{ width: 28, height: 28, borderRadius: 999, background: "#1f2937" }} />
                    )}
                  </a>
                  <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
                    <div>
                      <a href={s.html_url || `https://github.com/${s.login}`} target="_blank" rel="noopener noreferrer" style={{ color: "#e5e7eb", textDecoration: "none", fontWeight: 600 }}>{s.login}</a>
                      <div style={{ color: "#94a3b8", fontSize: 12 }}>
                        {s.company ? s.company : "No company listed"}
                        {s.company_org ? ` • @${s.company_org}` : ""}
                        {typeof s.company_public_members === "number" ? ` • public members: ${s.company_public_members}` : ""}
                        {s.reason ? ` • ${s.reason}` : ""}
                      </div>
                    </div>
                    <div style={{ color: "#93c5fd" }}>{s.score}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div style={{ color: "#94a3b8" }}>No interesting prospects ranked yet.</div>
          )}
          <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 8 }}>
            Score is a buyer-likelihood score (0–100) based on LLM ranking of titles and company signals
            (growth, org size). Falls back to heuristic if LLM unavailable.
          </div>
        </div>
      </section>
      )}
    </div>
  );
}
