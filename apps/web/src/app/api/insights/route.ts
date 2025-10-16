import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { d1All, d1Run, getUID } from "../_lib/ctx";

export const runtime = "edge";

type DiscordMessage = {
  message_id?: string;
  author?: string;
  author_id?: string;
  author_display_name?: string;
  author_avatar_url?: string;
  timestamp?: string;
  text?: string;
  attachments?: string[];
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

type InsightsPayload = {
  topics: { topic: string; count: number }[];
  seo_recommendations: string[];
  unanswered_questions: string[];
  action_plans: string[];
  seo_keywords: string[];
  seo_keyword_clusters?: SEOKeywordCluster[];
  seo_briefs?: SEOBrief[];
  seo_faqs?: { q: string; a: string; jsonld: unknown }[];
  seo_titles?: { page: string; title_tag: string; meta_description: string }[];
  seo_tasks?: SEOTask[];
};
async function readDiscordMessages(limitChars = 120000, channelId?: string): Promise<string> {
  const fallbackId = channelId && channelId.trim().length ? channelId.trim() : "1288403910284935182";
  const url = process.env.DISCORD_JSON_URL ||
    `https://raw.githubusercontent.com/dialin-ai/analytics/main/data/discord-${fallbackId}.json`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return "";
    const parsed = (await res.json()) as DiscordMessage[];
    const lines: string[] = [];
    for (const m of parsed) {
      const who = (m.author_display_name || m.author || m.author_id || "user").replace(/\s+/g, " ");
      const text = (m.text || "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      lines.push(`${who}: ${text}`);
      if (lines.join("\n").length > limitChars) break;
    }
    return lines.join("\n");
  } catch {
    return "";
  }
}

export async function GET(req: NextRequest) {
  try {
    const uid = getUID(req as unknown as Request);
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY missing in environment" }, { status: 400 });
    }
    const client = new OpenAI({ apiKey });
    const url = new URL(req.url);
    const channelParam = url.searchParams.get("channel") || url.searchParams.get("channel_id") || "";
    const channelId = (channelParam || "").trim() || "1288403910284935182";
    const transcript = await readDiscordMessages(undefined as unknown as number, channelId);
    if (!transcript) {
      return NextResponse.json({ error: "No Discord messages found" }, { status: 404 });
    }

    const system = [
      "You are an analytics assistant. Given Discord chat transcripts, output STRICT JSON only.",
      "Include:",
      "- topics: [{topic,count}]",
      "- seo_recommendations: string[] (3-5)",
      "- unanswered_questions: string[] (3)",
      "- action_plans: string[] (3-6)",
      "- seo_keywords: string[] (10-20)",
      "- seo_keyword_clusters: [{cluster,intent,primary,secondary[]}] (8-12)",
      "- seo_briefs: [{slug,h1,title_tag,meta_description,outline[],faqs:[{q,a}],internal_links:[{anchor,url}]}] (3-5)",
      "- seo_faqs: [{q,a,jsonld}] (8-10) where jsonld is valid FAQPage JSON-LD",
      "- seo_titles: [{page,title_tag,meta_description}] (8-12)",
      "- seo_tasks: [{title,rationale,impact,effort,score}] (6-10) where score=(impact*2)-effort",
      "Rules: title_tag<=60 chars, meta_description<=155. intent in {informational,commercial,navigational,transactional}.",
    ].join(" \n");

    const user = [
      "Here is a transcript excerpt (author: message). Analyze it and respond with strict JSON only.",
      transcript,
    ].join("\n\n");

    // Check D1 cache first (kind includes channel)
    try {
      const cached = await d1All<{ data: string; generated_at: number; ttl_seconds: number }>(
        "SELECT data, generated_at, ttl_seconds FROM insights WHERE uid=? AND kind=?",
        uid,
        `seo:${channelId}`
      );
      if (cached.length) {
        const row = cached[0];
        const expiresAt = (row.generated_at || 0) + (row.ttl_seconds || 0) * 1000;
        if (!row.ttl_seconds || Date.now() < expiresAt) {
          try {
            const obj = JSON.parse(row.data);
            return NextResponse.json(obj, { status: 200 });
          } catch {}
        }
      }
    } catch {}

    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.2,
      max_tokens: 800,
      response_format: { type: "json_object" },
    });

    const content = response.choices?.[0]?.message?.content || "{}";
    function coerceInsights(jsonText: string): InsightsPayload {
      try {
        const o = JSON.parse(jsonText) as unknown;
        const obj = (o && typeof o === "object" ? o : {}) as Record<string, unknown>;
        const topics = Array.isArray(obj.topics)
          ? (obj.topics as unknown[])
              .map((t) => {
                const tt = t as Record<string, unknown>;
                const topic = typeof tt.topic === "string" ? tt.topic : "";
                const count = typeof tt.count === "number" ? tt.count : 0;
                return topic ? { topic, count } : null;
              })
              .filter(Boolean) as { topic: string; count: number }[]
          : [];
        const seo = Array.isArray(obj.seo_recommendations)
          ? (obj.seo_recommendations as unknown[]).filter((x) => typeof x === "string")
          : [];
        const unanswered = Array.isArray(obj.unanswered_questions)
          ? (obj.unanswered_questions as unknown[]).filter((x) => typeof x === "string")
          : [];
        const action = Array.isArray(obj.action_plans)
          ? (obj.action_plans as unknown[]).filter((x) => typeof x === "string")
          : [];
        const keywords = Array.isArray(obj.seo_keywords)
          ? (obj.seo_keywords as unknown[]).filter((x) => typeof x === "string")
          : [];
        const clusters = Array.isArray(obj.seo_keyword_clusters) ? (obj.seo_keyword_clusters as unknown[]).map((c)=>{
          const cc = c as Record<string, unknown>;
          const cluster = typeof cc.cluster === "string" ? cc.cluster : "";
          const intent = (cc.intent === "informational" || cc.intent === "commercial" || cc.intent === "navigational" || cc.intent === "transactional") ? cc.intent : "informational";
          const primary = typeof cc.primary === "string" ? cc.primary : "";
          const secondary = Array.isArray(cc.secondary) ? (cc.secondary as unknown[]).filter((x)=> typeof x === "string") as string[] : [];
          return cluster && primary ? { cluster, intent, primary, secondary } : null;
        }).filter(Boolean) as SEOKeywordCluster[] : undefined;

        const briefs = Array.isArray(obj.seo_briefs) ? (obj.seo_briefs as unknown[]).map((b)=>{
          const bb = b as Record<string, unknown>;
          const slug = typeof bb.slug === "string" ? bb.slug : "";
          const h1 = typeof bb.h1 === "string" ? bb.h1 : "";
          const title_tag = typeof bb.title_tag === "string" ? bb.title_tag : "";
          const meta_description = typeof bb.meta_description === "string" ? bb.meta_description : "";
          const outline = Array.isArray(bb.outline) ? (bb.outline as unknown[]).filter((x)=> typeof x === "string") as string[] : [];
          const faqs = Array.isArray(bb.faqs) ? (bb.faqs as unknown[]).map((f)=>{
            const ff = f as Record<string, unknown>;
            const q = typeof ff.q === "string" ? ff.q : "";
            const a = typeof ff.a === "string" ? ff.a : "";
            return q && a ? { q, a } : null;
          }).filter(Boolean) as { q: string; a: string }[] : [];
          const internal_links = Array.isArray(bb.internal_links) ? (bb.internal_links as unknown[]).map((l)=>{
            const ll = l as Record<string, unknown>;
            const anchor = typeof ll.anchor === "string" ? ll.anchor : "";
            const url = typeof ll.url === "string" ? ll.url : "";
            return anchor && url ? { anchor, url } : null;
          }).filter(Boolean) as { anchor: string; url: string }[] : [];
          return slug && h1 ? { slug, h1, title_tag, meta_description, outline, faqs, internal_links } : null;
        }).filter(Boolean) as SEOBrief[] : undefined;

        const faqsFull = Array.isArray(obj.seo_faqs) ? (obj.seo_faqs as unknown[]).map((f)=>{
          const ff = f as Record<string, unknown>;
          const q = typeof ff.q === "string" ? ff.q : "";
          const a = typeof ff.a === "string" ? ff.a : "";
          const jsonld = ff.jsonld ?? undefined;
          return q && a ? { q, a, jsonld } : null;
        }).filter(Boolean) as { q: string; a: string; jsonld: unknown }[] : undefined;

        const titles = Array.isArray(obj.seo_titles) ? (obj.seo_titles as unknown[]).map((t)=>{
          const tt = t as Record<string, unknown>;
          const page = typeof tt.page === "string" ? tt.page : "";
          const title_tag = typeof tt.title_tag === "string" ? tt.title_tag : "";
          const meta_description = typeof tt.meta_description === "string" ? tt.meta_description : "";
          return page ? { page, title_tag, meta_description } : null;
        }).filter(Boolean) as { page: string; title_tag: string; meta_description: string }[] : undefined;

        const tasks = Array.isArray(obj.seo_tasks) ? (obj.seo_tasks as unknown[]).map((t)=>{
          const tt = t as Record<string, unknown>;
          const title = typeof tt.title === "string" ? tt.title : "";
          const rationale = typeof tt.rationale === "string" ? tt.rationale : "";
          const impact = (tt.impact === 1 || tt.impact === 2 || tt.impact === 3) ? tt.impact : 1;
          const effort = (tt.effort === 1 || tt.effort === 2 || tt.effort === 3) ? tt.effort : 2;
          const score = typeof tt.score === "number" ? tt.score : (impact*2 - effort);
          return title ? { title, rationale, impact, effort, score } : null;
        }).filter(Boolean) as SEOTask[] : undefined;

        return {
          topics,
          seo_recommendations: seo as string[],
          unanswered_questions: unanswered as string[],
          action_plans: action as string[],
          seo_keywords: keywords as string[],
          seo_keyword_clusters: clusters,
          seo_briefs: briefs,
          seo_faqs: faqsFull,
          seo_titles: titles,
          seo_tasks: tasks,
        };
      } catch {
        return { topics: [], seo_recommendations: [], unanswered_questions: [], action_plans: [], seo_keywords: [] };
      }
    }

    const parsed = coerceInsights(content);
    // Cache in D1 with TTL (e.g., 6 hours)
    try {
      const ttlSec = 6 * 3600;
      await d1Run(
        `INSERT INTO insights(uid, kind, data, generated_at, ttl_seconds)
         VALUES(?,?,?,?,?)
         ON CONFLICT(uid,kind) DO UPDATE SET data=excluded.data, generated_at=excluded.generated_at, ttl_seconds=excluded.ttl_seconds`,
        uid,
        `seo:${channelId}`,
        JSON.stringify(parsed),
        Date.now(),
        ttlSec
      );
    } catch {}
    return NextResponse.json(parsed, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to get insights";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


