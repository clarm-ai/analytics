import { NextRequest, NextResponse } from "next/server";

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

function toLocalWeekdayName(date: Date): keyof WeekdayStats {
  const day = date.getDay(); // 0..6 Sun..Sat
  switch (day) {
    case 0:
      return "Sunday";
    case 1:
      return "Monday";
    case 2:
      return "Tuesday";
    case 3:
      return "Wednesday";
    case 4:
      return "Thursday";
    case 5:
      return "Friday";
    case 6:
      return "Saturday";
    default:
      return "Monday";
  }
}

async function readDiscordMessages(req: NextRequest): Promise<DiscordMessage[]> {
  try {
    const directUrl = process.env.DISCORD_JSON_URL;
    if (directUrl) {
      const res = await fetch(directUrl, { cache: "no-store" });
      if (!res.ok) return [];
      const parsed = await res.json();
      if (!Array.isArray(parsed)) return [];
      return parsed as DiscordMessage[];
    }

    // Fallback to repository-provided static JSON served from public under /analytics/data/...
    const origin = new URL(req.url).origin;
    const basePath = "/analytics";
    const localUrl = `${origin}${basePath}/data/discord-1288403910284935182.json`;
    const res = await fetch(localUrl, { cache: "no-store" });
    if (res.ok) {
      const parsed = await res.json();
      if (Array.isArray(parsed)) return parsed as DiscordMessage[];
    }

    // Final fallback: raw file from the repository
    const rawUrl = "https://raw.githubusercontent.com/dialin-ai/analytics/main/data/discord-1288403910284935182.json";
    const rawRes = await fetch(rawUrl, { cache: "no-store" });
    if (!rawRes.ok) return [];
    const rawParsed = await rawRes.json();
    if (!Array.isArray(rawParsed)) return [];
    return rawParsed as DiscordMessage[];
  } catch {
    return [];
  }
}

function computeContributors(msgs: DiscordMessage[]): Contributor[] {
  const byId = new Map<string, Contributor>();
  for (const m of msgs) {
    const id = (m.author_id || m.author || "").trim();
    if (!id) continue;
    const display = (m.author_display_name || m.author || id).trim();
    const avatar = m.author_avatar_url;
    const prev = byId.get(id);
    if (prev) {
      prev.count += 1;
      // fill missing avatar/display if present
      if (!prev.avatarUrl && avatar) prev.avatarUrl = avatar;
      if (!prev.displayName && display) prev.displayName = display;
    } else {
      byId.set(id, { authorId: id, displayName: display, avatarUrl: avatar, count: 1 });
    }
  }
  return Array.from(byId.values()).sort((a, b) => b.count - a.count).slice(0, 10);
}

function computeWeekdays(msgs: DiscordMessage[]): WeekdayStats {
  const stats: WeekdayStats = {
    Monday: 0,
    Tuesday: 0,
    Wednesday: 0,
    Thursday: 0,
    Friday: 0,
    Saturday: 0,
    Sunday: 0,
  };
  for (const m of msgs) {
    const ts = (m.timestamp || "").trim();
    if (!ts) continue;
    let d: Date | null = null;
    try {
      // support ISO with Z or offset
      d = new Date(ts);
      if (isNaN(d.getTime())) d = null;
    } catch {
      d = null;
    }
    if (!d) continue;
    const name = toLocalWeekdayName(d);
    stats[name] += 1;
  }
  return stats;
}

export async function GET(req: NextRequest) {
  try {
    const msgs = await readDiscordMessages(req);
    const contributors = computeContributors(msgs);
    const weekdays = computeWeekdays(msgs);
    const body: StatsResponse = {
      contributors,
      weekdays,
      sampleSize: msgs.length,
    };
    return NextResponse.json(body, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to compute stats";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


