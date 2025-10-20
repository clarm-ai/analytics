import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { d1All, getUID } from "../_lib/ctx";

export const runtime = "edge";
export const dynamic = "force-dynamic";

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

async function safeJson(res: Response | undefined) {
  try {
    if (!res || !res.ok) return undefined;
    return await res.json();
  } catch {
    return undefined;
  }
}

async function getExamplesForTopic(origin: string, topic: string, limit: number, all: DiscordMessage[], channelId: string): Promise<any[]> {
  try {
    const local = await fetch(`${origin}/analytics/data/examples_index-${channelId}.json`);
    let idx: any = await safeJson(local);
    if (!idx) {
      const gh = await fetch(`https://raw.githubusercontent.com/dialin-ai/analytics/main/apps/web/public/data/examples_index-${channelId}.json`);
      idx = await safeJson(gh);
    }
    if (idx && typeof idx === "object") {
      let arr: any[] = Array.isArray(idx[topic]) ? idx[topic] : [];
      if (!arr.length) {
        const lower = topic.toLowerCase();
        for (const [k, v] of Object.entries(idx as Record<string, any>)) {
          if (k.toLowerCase() === lower && Array.isArray(v)) {
            arr = v as any[];
            break;
          }
        }
      }
      if (arr.length) return arr.slice(0, limit);
    }
  } catch {}

  try {
    const local = await fetch(`${origin}/analytics/data/topic_index-${channelId}.json`);
    let idx: any = await safeJson(local);
    if (!idx) {
      const gh = await fetch(`https://raw.githubusercontent.com/dialin-ai/analytics/main/apps/web/public/data/topic_index-${channelId}.json`);
      idx = await safeJson(gh);
    }
    if (idx && Array.isArray(idx.topics)) {
      const lower = topic.toLowerCase();
      const entry = idx.topics.find((t: any) => String(t.topic || "").toLowerCase() === lower);
      if (entry && Array.isArray(entry.example_ids)) {
        const idSet = new Set(entry.example_ids.map((s: any) => String(s)));
        const items = all
          .filter((m) => m.message_id && idSet.has(String(m.message_id)))
          .slice(0, limit)
          .map((m) => ({
            message_id: m.message_id,
            author_id: m.author_id || m.author,
            author_display_name: m.author_display_name || m.author,
            author_avatar_url: m.author_avatar_url,
            timestamp: m.timestamp,
            text: m.text,
          }));
        if (items.length) return items;
      }
    }
  } catch {}
  return [];
}
async function getAllMessages(origin: string, channelId: string): Promise<DiscordMessage[]> {
  // Try local static first (fast), then GitHub raw as fallback
  const local = `${origin}/analytics/data/discord-${channelId}.json`;
  try {
    const res = await fetch(local);
    if (res.ok) {
      const parsed = await res.json();
      if (Array.isArray(parsed) && parsed.length) return parsed as DiscordMessage[];
    }
  } catch {}
  try {
    const raw = `https://raw.githubusercontent.com/dialin-ai/analytics/main/apps/web/public/data/discord-${channelId}.json`;
    const res = await fetch(raw);
    if (res.ok) {
      const parsed = await res.json();
      if (Array.isArray(parsed)) return parsed as DiscordMessage[];
    }
  } catch {}
  return [];
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const qRaw = (searchParams.get("q") || "").trim();
  const q = qRaw.toLowerCase();
  const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit") || 10)));
  const idsParam = (searchParams.get("ids") || "").trim();
  const topic = (searchParams.get("topic") || "").trim();
  const uid = getUID(req as unknown as Request);
  const channelParam = searchParams.get("channel") || searchParams.get("channel_id") || "";
  const channelId = (channelParam || "").trim() || "1288403910284935182";
  // Date bounds (ms) - accept ms or YYYY-MM-DD
  function parseBound(v: string | null): number | undefined {
    if (!v) return undefined;
    const ms = Number(v);
    if (!Number.isNaN(ms) && ms > 0) return ms;
    const d = new Date(v);
    return isNaN(d.getTime()) ? undefined : d.getTime();
  }
  const fromMs = parseBound(searchParams.get('from'));
  const toMs = parseBound(searchParams.get('to'));

  let all = await getAllMessages(new URL(req.url).origin.replace(/\/$/, ""), channelId);
  if (fromMs || toMs) {
    all = all.filter((m) => {
      const ts = String(m.timestamp || '').trim();
      if (!ts) return false;
      const t = Date.parse(ts);
      if (Number.isNaN(t)) return false;
      if (fromMs && t < fromMs) return false;
      if (toMs && t > toMs) return false;
      return true;
    });
  }
  let items: any[] = [];

  // Try D1 first when available
  try {
    if (topic) {
      // Resolve via topic mapping in D1
      const rows = await d1All<{ message_id: string }>(
        "SELECT message_id FROM discord_topics WHERE uid=? AND topic=? ORDER BY score DESC LIMIT ?",
        uid,
        topic,
        limit
      );
      const ids = rows.map((r) => r.message_id);
      if (ids.length) {
        const placeholders = ids.map(() => "?").join(",");
        const msgs = await d1All<any>(
          `SELECT message_id, author_id, author_display_name, author_avatar_url, ts, content as text
           FROM discord_messages WHERE uid=? AND message_id IN (${placeholders})`,
          uid,
          ...ids
        );
        if (msgs.length) {
          items = msgs.map((m) => ({
            message_id: m.message_id,
            author_id: m.author_id,
            author_display_name: m.author_display_name,
            author_avatar_url: m.author_avatar_url,
            timestamp: m.ts,
            text: m.text,
          }));
          return NextResponse.json({ items }, { status: 200 });
        }
      }
    }

    if (idsParam && !items.length) {
      const requested = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
      if (requested.length) {
        const placeholders = requested.map(() => "?").join(",");
        const msgs = await d1All<any>(
          `SELECT message_id, author_id, author_display_name, author_avatar_url, ts, content as text
           FROM discord_messages WHERE uid=? AND message_id IN (${placeholders})`,
          uid,
          ...requested
        );
        if (msgs.length) {
          items = msgs.slice(0, limit).map((m) => ({
            message_id: m.message_id,
            author_id: m.author_id,
            author_display_name: m.author_display_name,
            author_avatar_url: m.author_avatar_url,
            timestamp: m.ts,
            text: m.text,
          }));
          return NextResponse.json({ items }, { status: 200 });
        }
      }
    }

    if (q && !items.length) {
      // FTS search if available, fallback to LIKE
      let rows = await d1All<any>(
        `SELECT m.message_id, m.author_id, m.author_display_name, m.author_avatar_url, m.ts, m.content as text
         FROM discord_messages m
         JOIN discord_messages_fts f ON f.rowid = m.rowid
         WHERE f.uid=? AND discord_messages_fts MATCH ?
         LIMIT ?`,
        uid,
        q,
        limit
      );
      if (!rows.length) {
        rows = await d1All<any>(
          `SELECT message_id, author_id, author_display_name, author_avatar_url, ts, content as text
           FROM discord_messages WHERE uid=? AND lower(content) LIKE ? LIMIT ?`,
          uid,
          `%${q}%`,
          limit
        );
      }
      if (rows.length) {
        items = rows.map((m) => ({
          message_id: m.message_id,
          author_id: m.author_id,
          author_display_name: m.author_display_name,
          author_avatar_url: m.author_avatar_url,
          timestamp: m.ts,
          text: m.text,
        }));
        return NextResponse.json({ items }, { status: 200 });
      }
    }
  } catch {}

  // Fast path: if a static examples index exists and topic provided, use it
  // Prefer topic results even when ids are also provided (ids may be stale)
  if (topic) {
    const origin = new URL(req.url).origin;
    const arr = await getExamplesForTopic(origin, topic, limit, all, channelId);
    if (arr.length) return NextResponse.json({ items: arr }, { status: 200 });
  }

  if (idsParam) {
    // Try resolving via static examples_index first (exact mapping id->payload)
    try {
      const origin = new URL(req.url).origin;
      const idxRes = await fetch(`${origin}/analytics/data/examples_index-${channelId}.json`, { cache: "no-store" });
      let ok = idxRes.ok;
      let idx: any = undefined;
      if (ok) {
        idx = await idxRes.json();
      } else {
        // Fallback to GitHub raw if not found locally
        const gh = await fetch(
          `https://raw.githubusercontent.com/dialin-ai/analytics/main/apps/web/public/data/examples_index-${channelId}.json`,
          { cache: "no-store" }
        );
        if (gh.ok) {
          ok = true;
          idx = await gh.json();
        }
      }
      if (ok && idx) {
        const idMap = new Map<string, any>();
        for (const arr of Object.values(idx as Record<string, any[]>)) {
          for (const m of arr as any[]) {
            const id = String((m as any).message_id || "");
            if (id) idMap.set(id, m);
          }
        }
        const requested = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
        const resolved = requested.map((id) => idMap.get(String(id))).filter(Boolean)
          .filter((m: any) => {
            const ts = String(m?.timestamp || '').trim();
            const t = Date.parse(ts);
            if (fromMs && !(t >= (fromMs || 0))) return false;
            if (toMs && !(t <= (toMs || Number.MAX_SAFE_INTEGER))) return false;
            return typeof m?.text === 'string' && m.text.trim().length > 0;
          })
          .slice(0, limit);
        if (resolved.length) {
          items = resolved;
          return NextResponse.json({ items }, { status: 200 });
        }
      }
    } catch {}

    const idSet = new Set(idsParam.split(",").map((s) => s.trim()).filter(Boolean));
    items = all
      .filter((m) => m.message_id && idSet.has(String(m.message_id)))
      .slice(0, limit)
      .map((m) => ({
        message_id: m.message_id,
        author_id: m.author_id || m.author,
        author_display_name: m.author_display_name || m.author,
        author_avatar_url: m.author_avatar_url,
        timestamp: m.timestamp,
        text: m.text,
      }));

    // If still empty and a topic was supplied, fallback to topic-based resolution (static index or LLM)
    if (!items.length && topic) {
      try {
        const origin = new URL(req.url).origin;
        const idxRes = await fetch(`${origin}/analytics/data/examples_index-${channelId}.json`, { cache: "no-store" });
        if (idxRes.ok) {
          const idx = await idxRes.json();
          const arr = Array.isArray(idx[topic]) ? idx[topic] : [];
          if (arr.length) {
            items = arr.slice(0, limit);
            return NextResponse.json({ items }, { status: 200 });
          }
        }
      } catch {}

      // As last resort, run topic selection
      try {
        const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const maxCandidates = Math.min(800, all.length);
        const candidates = all.filter((m) => (m.text || "").trim().length > 4).slice(-maxCandidates);
        const selected = new Set<string>();
        const batchSize = 60;
        for (let i = 0; i < candidates.length && selected.size < limit; i += batchSize) {
          const batch = candidates.slice(i, i + batchSize);
          const lines = batch
            .map((m) => ({ id: m.message_id || String(i), text: (m.text || "").slice(0, 220) }))
            .filter((r) => r.text);
          const sys = `You are selecting Discord messages that best match the user topic. Return ONLY strict JSON as {"ids":["..."]}. Pick at most ${limit - selected.size} ids from the provided list.`;
          const user = `Topic: ${topic}\nMessages:\n${lines.map((r) => `- id:${r.id} text:${r.text.replace(/\s+/g, " ")}`).join("\n")}`;
          const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
          const resp = await client.chat.completions.create({ model, messages: [{ role: "system", content: sys }, { role: "user", content: user }], temperature: 0 });
          const content = resp.choices?.[0]?.message?.content || "{}";
          const parsed = JSON.parse(content);
          const ids: string[] = Array.isArray(parsed?.ids) ? parsed.ids : [];
          ids.forEach((id) => selected.add(id));
        }
        const byId = new Map<string, DiscordMessage>();
        for (const m of candidates) if (m.message_id) byId.set(m.message_id, m);
        items = Array.from(selected)
          .slice(0, limit)
          .map((id) => byId.get(id))
          .filter(Boolean)
          .map((m) => ({
            message_id: m!.message_id,
            author_id: m!.author_id || m!.author,
            author_display_name: m!.author_display_name || m!.author,
            author_avatar_url: m!.author_avatar_url,
            timestamp: m!.timestamp,
            text: m!.text,
          }));
      } catch {}
    }
  } else if (q) {
    items = all
      .filter((m) => (m.text || "").toLowerCase().includes(q))
      .slice(0, limit)
      .map((m) => ({
        message_id: m.message_id,
        author_id: m.author_id || m.author,
        author_display_name: m.author_display_name || m.author,
        author_avatar_url: m.author_avatar_url,
        timestamp: m.timestamp,
        text: m.text,
      }));

    // Heuristic fallback: search precomputed examples_index.json when direct keyword match fails
    if (!items.length) {
      try {
        const origin = new URL(req.url).origin;
        const exRes = await fetch(`${origin}/analytics/data/examples_index.json`, { cache: "no-store" }).catch(() => null);
        let idx: any = null;
        if (exRes && exRes.ok) {
          idx = await exRes.json();
        } else {
          const gh = await fetch("https://raw.githubusercontent.com/dialin-ai/analytics/main/apps/web/public/data/examples_index.json", { cache: "no-store" }).catch(() => null);
          if (gh && gh.ok) idx = await gh.json();
        }
        if (idx && typeof idx === "object") {
          const qTokens = Array.from(new Set(q.split(/[^a-z0-9]+/g).filter((w) => w && w.length >= 4)));
          const allExamples: any[] = [];
          for (const arr of Object.values(idx as Record<string, any[]>)) {
            for (const m of (arr as any[])) allExamples.push(m);
          }
          const scored = allExamples
            .map((m) => {
              const text = String(m.text || "").toLowerCase();
              let score = 0;
              if (text.includes(q)) score += 5;
              for (const tok of qTokens) if (text.includes(tok)) score += 1;
              return { m, score };
            })
            .filter((r) => r.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map((r) => r.m);
          if (scored.length) {
            items = scored.map((m: any) => ({
              message_id: m.message_id,
              author_id: m.author_id || m.author,
              author_display_name: m.author_display_name || m.author,
              author_avatar_url: m.author_avatar_url,
              timestamp: m.timestamp,
              text: m.text,
            }));
          }
        }
      } catch {}
    }

    // Heuristic: if still empty, try mapping question to a topic name and reuse topic examples
    if (!items.length) {
      try {
        const origin = new URL(req.url).origin;
        const tRes = await fetch(`${origin}/analytics/data/topic_index.json`, { cache: "no-store" }).catch(() => null);
        let idx: any = null;
        if (tRes && tRes.ok) idx = await tRes.json();
        if (!idx) {
          const gh = await fetch("https://raw.githubusercontent.com/dialin-ai/analytics/main/apps/web/public/data/topic_index.json", { cache: "no-store" }).catch(() => null);
          if (gh && gh.ok) idx = await gh.json();
        }
        if (idx && Array.isArray(idx.topics)) {
          const lowerQ = q.toLowerCase();
          let best: any = null;
          let bestScore = 0;
          for (const t of idx.topics) {
            const topicName = String(t.topic || "").toLowerCase();
            if (!topicName) continue;
            let score = 0;
            if (lowerQ.includes(topicName)) score += 5;
            const toks = topicName.split(/[^a-z0-9]+/g).filter(Boolean);
            for (const tok of toks) if (lowerQ.includes(tok)) score += 1;
            if (score > bestScore) {
              bestScore = score;
              best = t;
            }
          }
          if (best && Array.isArray(best.example_ids)) {
            const idSet = new Set(best.example_ids.map((s: any) => String(s)));
            const fromAll = all
              .filter((m) => m.message_id && idSet.has(String(m.message_id)))
              .slice(0, limit)
              .map((m) => ({
                message_id: m.message_id,
                author_id: m.author_id || m.author,
                author_display_name: m.author_display_name || m.author,
                author_avatar_url: m.author_avatar_url,
                timestamp: m.timestamp,
                text: m.text,
              }));
            if (fromAll.length) items = fromAll;
          }
        }
      } catch {}
    }

    // If keyword search returns nothing, fall back to LLM selection using the question text
    if (!items.length) {
      try {
        const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const maxCandidates = Math.min(800, all.length);
        const candidates = all
          .filter((m) => (m.text || "").trim().length > 4)
          .slice(-maxCandidates);
        const selected = new Set<string>();
        const batchSize = 60;
        for (let i = 0; i < candidates.length && selected.size < limit; i += batchSize) {
          const batch = candidates.slice(i, i + batchSize);
          const lines = batch
            .map((m) => ({ id: m.message_id || String(i), text: (m.text || "").slice(0, 220) }))
            .filter((r) => r.text);
          const sys = `You are selecting Discord messages that best match the user's question. Return ONLY strict JSON as {"ids":["..."]}. Pick at most ${limit - selected.size} ids from the provided list, only if strongly relevant. No explanations.`;
          const user = `Question: ${qRaw}\nMessages:\n${lines.map((r) => `- id:${r.id} text:${r.text.replace(/\s+/g, " ")}`).join("\n")}`;
          const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
          const resp = await client.chat.completions.create({
            model,
            messages: [
              { role: "system", content: sys },
              { role: "user", content: user },
            ],
            temperature: 0,
          });
          const content = resp.choices?.[0]?.message?.content || "{}";
          const parsed = JSON.parse(content);
          const ids: string[] = Array.isArray(parsed?.ids) ? parsed.ids : [];
          ids.forEach((id) => selected.add(id));
        }
        const byId = new Map<string, DiscordMessage>();
        for (const m of candidates) if (m.message_id) byId.set(m.message_id, m);
        items = Array.from(selected)
          .slice(0, limit)
          .map((id) => byId.get(id))
          .filter(Boolean)
          .map((m) => ({
            message_id: m!.message_id,
            author_id: m!.author_id || m!.author,
            author_display_name: m!.author_display_name || m!.author,
            author_avatar_url: m!.author_avatar_url,
            timestamp: m!.timestamp,
            text: m!.text,
          }));
      } catch {}
    }
  } else if (topic) {
    // Use LLM to select the best-matching message_ids for the topic
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const maxCandidates = Math.min(800, all.length);
    // Lightweight prefilter: non-empty text, limit to latest N
    const candidates = all
      .filter((m) => (m.text || "").trim().length > 4)
      .slice(-maxCandidates);
    const selected = new Set<string>();
    const batchSize = 60;
    for (let i = 0; i < candidates.length && selected.size < limit; i += batchSize) {
      const batch = candidates.slice(i, i + batchSize);
      const lines = batch
        .map((m) => ({ id: m.message_id || String(i), text: (m.text || "").slice(0, 220) }))
        .filter((r) => r.text);
      const sys = `You are selecting Discord messages that best match the user topic. Return ONLY strict JSON as {"ids":["..."]}. Pick at most ${limit - selected.size} ids from the provided list, only if strongly relevant. No explanations.`;
      const user = `Topic: ${topic}\nMessages:\n${lines
        .map((r) => `- id:${r.id} text:${r.text.replace(/\s+/g, " ")}`)
        .join("\n")}`;
      try {
        const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
        const resp = await client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: sys },
            { role: "user", content: user },
          ],
          temperature: 0,
        });
        const content = resp.choices?.[0]?.message?.content || "{}";
        const parsed = JSON.parse(content);
        const ids: string[] = Array.isArray(parsed?.ids) ? parsed.ids : [];
        ids.forEach((id) => selected.add(id));
      } catch {}
    }
    const byId = new Map<string, DiscordMessage>();
    for (const m of candidates) if (m.message_id) byId.set(m.message_id, m);
    items = Array.from(selected)
      .slice(0, limit)
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((m) => ({
        message_id: m!.message_id,
        author_id: m!.author_id || m!.author,
        author_display_name: m!.author_display_name || m!.author,
        author_avatar_url: m!.author_avatar_url,
        timestamp: m!.timestamp,
        text: m!.text,
      }));
  }

  return NextResponse.json({ items }, { status: 200 });
}


