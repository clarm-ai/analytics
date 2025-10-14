"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

type Topic = { topic: string; count: number };
type InsightsResponse = { topics: Topic[] };

export default function TopicsPage() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/insights", { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to load insights");
        const data: InsightsResponse = await res.json();
        setTopics((data.topics || []).sort((a, b) => b.count - a.count));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Failed to load";
        setError(msg);
      }
    }
    load();
  }, []);

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto", color: "#e5e7eb" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Most Discussed Topics</h1>
        <nav>
          <Link href="/" style={{ color: "#93c5fd" }}>← Back</Link>
        </nav>
      </header>
      {error && (
        <div style={{ background: "#7f1d1d", padding: 12, borderRadius: 8, marginBottom: 16 }}>{error}</div>
      )}
      <div style={{ background: "#0b1220", border: "1px solid #1f2937", borderRadius: 12, padding: 16 }}>
        {!topics.length ? (
          <div style={{ color: "#94a3b8" }}>Loading…</div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
            {topics.map((t) => (
              <li key={t.topic} style={{ display: "flex", justifyContent: "space-between", gap: 12, background: "#0f172a", padding: 10, borderRadius: 8 }}>
                <span>{t.topic}</span>
                <span style={{ color: "#94a3b8" }}>{t.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}


