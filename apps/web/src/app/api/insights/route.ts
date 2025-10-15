import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

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

type InsightsPayload = {
  topics: { topic: string; count: number }[];
  seo_recommendations: string[];
  unanswered_questions: string[];
  action_plans: string[];
  seo_keywords: string[];
};
async function readDiscordMessages(limitChars = 120000): Promise<string> {
  const url = process.env.DISCORD_JSON_URL ||
    "https://raw.githubusercontent.com/dialin-ai/analytics/main/data/discord-1288403910284935182.json";
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

export async function GET(_req: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY missing in environment" }, { status: 400 });
    }
    const client = new OpenAI({ apiKey });
    const transcript = await readDiscordMessages();
    if (!transcript) {
      return NextResponse.json({ error: "No Discord messages found" }, { status: 404 });
    }

    const system = [
      "You are an analytics assistant. Given Discord chat transcripts, you:",
      "1) Extract the top discussion topics as an array of {topic, count}.",
      "2) Provide 3-5 concise, high-impact SEO recommendations informed by the discussions (actionable, specific).",
      "3) Identify 3 frequently asked but unanswered questions.",
      "4) Provide 3-6 concrete action plans for improving the repository and docs.",
      "5) Provide 10-20 high-signal SEO keywords as an array of strings under 'seo_keywords'.",
      "Return strict JSON with keys: topics, seo_recommendations, unanswered_questions, action_plans, seo_keywords.",
    ].join(" \n");

    const user = [
      "Here is a transcript excerpt (author: message). Analyze it and respond with strict JSON only.",
      transcript,
    ].join("\n\n");

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
        return {
          topics,
          seo_recommendations: seo as string[],
          unanswered_questions: unanswered as string[],
          action_plans: action as string[],
          seo_keywords: keywords as string[],
        };
      } catch {
        return { topics: [], seo_recommendations: [], unanswered_questions: [], action_plans: [], seo_keywords: [] };
      }
    }

    const parsed = coerceInsights(content);
    return NextResponse.json(parsed, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to get insights";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


