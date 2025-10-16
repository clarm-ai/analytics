import { NextRequest, NextResponse } from "next/server";
import { d1Run, getUID } from "../_lib/ctx";

export const runtime = "edge";

async function safeJson(res: Response | undefined) {
  try {
    if (!res || !res.ok) return undefined;
    return await res.json();
  } catch {
    return undefined;
  }
}

export async function POST(req: NextRequest) {
  try {
    const uid = getUID(req as unknown as Request);
    const origin = new URL(req.url).origin;
    const url = new URL(req.url);
    const channelParam = url.searchParams.get("channel") || url.searchParams.get("channel_id") || "";
    const channelId = (channelParam || "").trim() || "1288403910284935182";
    const auth = req.headers.get("authorization") || "";
    const expected = (globalThis as any).process?.env?.SEED_TOKEN || process.env.SEED_TOKEN || "";
    if (!expected || auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    // Seed discord messages from static
    const messagesUrl = `${origin}/analytics/data/discord-${channelId}.json`;
    const messages = (await safeJson(await fetch(messagesUrl, { cache: "no-store" }))) as any[] | undefined;
    if (Array.isArray(messages)) {
      for (const m of messages.slice(-1200)) {
        const message_id = String(m.message_id || m.id || "");
        if (!message_id) continue;
        await d1Run(
          `INSERT INTO discord_messages(uid, message_id, channel_id, author_id, author_display_name, author_avatar_url, ts, content)
           VALUES(?,?,?,?,?,?,?,?)
           ON CONFLICT(uid, message_id) DO UPDATE SET content=excluded.content, ts=excluded.ts`,
          uid,
          message_id,
          m.channel_id || channelId || null,
          m.author_id || m.author || null,
          m.author_display_name || m.author || null,
          m.author_avatar_url || null,
          m.timestamp ? Date.parse(m.timestamp) || null : null,
          m.text || ""
        );
        // FTS mirror
        await d1Run(
          `INSERT INTO discord_messages_fts(rowid, content, uid, message_id)
           SELECT rowid, ?, ?, ? FROM discord_messages WHERE uid=? AND message_id=?`,
          m.text || "",
          uid,
          message_id,
          uid,
          message_id
        );
      }
    }

    // Seed topics mapping
    const examplesUrl = `${origin}/analytics/data/examples_index.json`;
    const examples = (await safeJson(await fetch(examplesUrl, { cache: "no-store" }))) as Record<string, any[]> | undefined;
    if (examples && typeof examples === "object") {
      for (const [topic, arr] of Object.entries(examples)) {
        const list = Array.isArray(arr) ? arr : [];
        for (let i = 0; i < Math.min(50, list.length); i += 1) {
          const m = list[i] as any;
          const message_id = String(m.message_id || "");
          if (!message_id) continue;
          await d1Run(
            `INSERT INTO discord_topics(uid, topic, message_id, score)
             VALUES(?,?,?,?)
             ON CONFLICT(uid, topic, message_id) DO NOTHING`,
            uid,
            topic,
            message_id,
            Math.max(1, 100 - i)
          );
        }
      }
    }

    // Seed interesting stargazers static snapshot
    const stUrl = `${origin}/analytics/data/interesting_stargazers.json`;
    const st = (await safeJson(await fetch(stUrl, { cache: "no-store" }))) as any[] | undefined;
    if (Array.isArray(st)) {
      const now = Date.now();
      for (const it of st.slice(0, 50)) {
        await d1Run(
          `INSERT INTO gh_stargazers(uid, login, starred_at, avatar_url, company, company_org, company_public_members, html_url)
           VALUES(?,?,?,?,?,?,?,?)
           ON CONFLICT(uid,login) DO UPDATE SET avatar_url=excluded.avatar_url, company=excluded.company,
             company_org=excluded.company_org, company_public_members=excluded.company_public_members, html_url=excluded.html_url`,
          uid,
          it.login,
          null,
          it.avatar_url || null,
          it.company || null,
          it.company_org || null,
          it.company_public_members || null,
          it.html_url || `https://github.com/${it.login}`
        );
        await d1Run(
          `INSERT INTO gh_interesting(uid, login, score, reason, last_scored_at)
           VALUES(?,?,?,?,?)
           ON CONFLICT(uid,login) DO UPDATE SET score=excluded.score, reason=excluded.reason, last_scored_at=excluded.last_scored_at`,
          uid,
          it.login,
          it.score || 0,
          it.reason || "static seed",
          now
        );
      }
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to seed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


