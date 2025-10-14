import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import OpenAI from "openai";
import * as dotenv from "dotenv";

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

function getNewestDiscordFile(): { jsonPath: string; base: string; mtimeMs: number } | null {
  const projectRoot = path.resolve(process.cwd(), "../../");
  const dataDir = path.join(projectRoot, "data");
  const files = fs.readdirSync(dataDir).filter((f) => f.endsWith(".json") && f.startsWith("discord-"));
  if (files.length === 0) return null;
  const fileWithMtime = files
    .map((f) => ({ f, mtime: fs.statSync(path.join(dataDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0];
  const jsonPath = path.join(dataDir, fileWithMtime.f);
  return { jsonPath, base: path.parse(fileWithMtime.f).name, mtimeMs: fileWithMtime.mtime };
}

function ensureEnvLoaded(): void {
  // Attempt to load the project root .env explicitly once per module load
  try {
    const projectRoot = path.resolve(process.cwd(), "../../");
    const envPath = path.join(projectRoot, ".env");
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath });
    }
  } catch {
    // ignore
  }
}

function readDiscordMessages(limitChars = 120000): string {
  const newest = getNewestDiscordFile();
  if (!newest) return "";
  const jsonPath = newest.jsonPath;
  const raw = fs.readFileSync(jsonPath, "utf-8");
  const parsed = JSON.parse(raw) as DiscordMessage[];
  // Concatenate messages as a compact transcript (author: text)
  const lines: string[] = [];
  for (const m of parsed) {
    const who = (m.author_display_name || m.author || m.author_id || "user").replace(/\s+/g, " ");
    const text = (m.text || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    lines.push(`${who}: ${text}`);
    if (lines.join("\n").length > limitChars) break;
  }
  return lines.join("\n");
}

export async function GET(_req: NextRequest) {
  try {
    ensureEnvLoaded();
    const newest = getNewestDiscordFile();
    if (!newest) {
      return NextResponse.json({ error: "No Discord messages found" }, { status: 404 });
    }

    // Cache in data/insights-<basename>.json; invalidate if source mtime changes.
    const projectRoot = path.resolve(process.cwd(), "../../");
    const cachePath = path.join(projectRoot, "data", `insights-${newest.base}.json`);
    const url = new URL(_req.url);
    const forceRefresh = url.searchParams.get("refresh") === "1";
    if (!forceRefresh && fs.existsSync(cachePath)) {
      try {
        const cachedRaw = fs.readFileSync(cachePath, "utf-8");
        const cachedObj = JSON.parse(cachedRaw) as { sourceMtimeMs: number; result: InsightsPayload };
        if (cachedObj && typeof cachedObj.sourceMtimeMs === "number" && cachedObj.sourceMtimeMs === newest.mtimeMs) {
          return NextResponse.json(cachedObj.result, { status: 200, headers: { "x-insights-cache": "hit" } });
        }
      } catch {
        // ignore invalid cache
      }
    }
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY missing in environment" }, { status: 400 });
    }
    const client = new OpenAI({ apiKey });
    const transcript = readDiscordMessages();
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
    // Write cache
    try {
      fs.writeFileSync(
        cachePath,
        JSON.stringify({ sourceFile: path.basename(newest.jsonPath), sourceMtimeMs: newest.mtimeMs, result: parsed }, null, 2),
        "utf-8"
      );
    } catch {
      // ignore cache write errors
    }
    return NextResponse.json(parsed, { status: 200, headers: { "x-insights-cache": "miss" } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to get insights";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


