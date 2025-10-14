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

type InsightsResponse = {
  topics: { topic: string; count: number }[];
  seo_recommendations: string[];
  unanswered_questions: string[];
  action_plans: string[];
  seo_keywords?: string[];
};

export default function Home() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [insights, setInsights] = useState<InsightsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [sRes, iRes] = await Promise.all([
          fetch("/api/stats", { cache: "no-store" }),
          fetch("/api/insights", { cache: "no-store" }),
        ]);
        if (!sRes.ok) throw new Error("Failed to load stats");
        const s: StatsResponse = await sRes.json();
        setStats(s);
        if (iRes.ok) {
          const i: InsightsResponse = await iRes.json();
          setInsights(i);
        } else {
          setInsights({ topics: [], seo_recommendations: [], unanswered_questions: [], action_plans: [], seo_keywords: [] });
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Failed to load";
        setError(msg);
      }
    }
    load();
  }, []);

  const weekdayBars = useMemo(() => {
    if (!stats) return null;
    const entries = Object.entries(stats.weekdays);
    const max = Math.max(1, ...entries.map(([, v]) => v));
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 12 }}>
        {entries.map(([day, value]) => (
          <div key={day} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
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
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Discord Analytics</h1>
        <nav style={{ display: "flex", gap: 16 }}>
          <Link href="/topics" style={{ color: "#93c5fd" }}>Most Discussed Topics</Link>
          <a href="/api/stats" style={{ color: "#94a3b8" }}>Stats JSON</a>
          <a href="/api/insights" style={{ color: "#94a3b8" }}>Insights JSON</a>
        </nav>
      </header>

      {error && (
        <div style={{ background: "#7f1d1d", padding: 12, borderRadius: 8, marginBottom: 16 }}>{error}</div>
      )}

      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 24 }}>
        <div style={{ background: "#0b1220", border: "1px solid #1f2937", borderRadius: 12, padding: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Top Topics</h2>
          {!insights ? (
            <div style={{ color: "#94a3b8" }}>Loading…</div>
          ) : insights.topics?.length ? (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
              {insights.topics.slice(0, 10).map((t) => (
                <li
                  key={t.topic}
                  style={{ display: "flex", justifyContent: "space-between", gap: 12, background: "#0f172a", padding: 10, borderRadius: 8 }}
                >
                  <span>{t.topic}</span>
                  <span style={{ color: "#94a3b8" }}>{t.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div style={{ color: "#94a3b8" }}>No topics found.</div>
          )}
        </div>

        <div style={{ background: "#0b1220", border: "1px solid #1f2937", borderRadius: 12, padding: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Top Contributors</h2>
          {!stats ? (
            <div style={{ color: "#94a3b8" }}>Loading…</div>
          ) : stats.contributors.length ? (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
              {stats.contributors.slice(0, 10).map((c) => (
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
          ) : (
            <div style={{ color: "#94a3b8" }}>No contributors.</div>
          )}
        </div>
      </section>

      <section style={{ background: "#0b1220", border: "1px solid #1f2937", borderRadius: 12, padding: 16, marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Contributions by Weekday</h2>
        {!stats ? <div style={{ color: "#94a3b8" }}>Loading…</div> : weekdayBars}
      </section>

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
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {insights.unanswered_questions.slice(0, 3).map((q, i) => (
                <li key={i} style={{ marginBottom: 8 }}>{q}</li>
              ))}
            </ul>
          ) : (
            <div style={{ color: "#94a3b8" }}>No unanswered questions detected.</div>
          )}
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
    </div>
  );
}
