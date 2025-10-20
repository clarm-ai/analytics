#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';

// Usage:
//   node scripts/fetch_discord_channel.mjs <channelId> [sinceYYYY-MM-DD]
// Writes: apps/web/public/data/discord-<channelId>.json

// Try to load the repo root .env (two levels up from apps/web)
const ENV_PATHS = [
  path.resolve(process.cwd(), '../../.env'),
  path.resolve(process.cwd(), '../.env'),
  path.resolve(process.cwd(), '.env'),
];
for (const p of ENV_PATHS) {
  try { dotenv.config({ path: p }); } catch {}
}

async function main() {
  const [channelId, sinceArg] = process.argv.slice(2);
  if (!channelId) {
    console.error('Usage: node scripts/fetch_discord_channel.mjs <channelId> [sinceYYYY-MM-DD]');
    process.exit(1);
  }
  const tokenRaw = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN || '';
  if (!tokenRaw) {
    console.error('Missing DISCORD_BOT_TOKEN in .env');
    process.exit(1);
  }
  const auth = tokenRaw.toLowerCase().startsWith('bot ') ? tokenRaw : `Bot ${tokenRaw}`;

  const limit = 100;
  let before = null;
  const messages = [];
  const cutoff = sinceArg && /^\d{4}-\d{2}-\d{2}$/.test(sinceArg) ? new Date(`${sinceArg}T00:00:00Z`).getTime() : null;

  const base = `https://discord.com/api/v9/channels/${channelId}/messages`;
  for (let pages = 0; pages < 1000; pages += 1) {
    const url = new URL(base);
    url.searchParams.set('limit', String(limit));
    if (before) url.searchParams.set('before', before);
    const res = await fetch(url.toString(), { headers: { Authorization: auth, 'User-Agent': 'repo-analytics/1.0' } });
    if (res.status === 429) {
      const j = await res.json().catch(() => ({}));
      const retry = Number(j.retry_after || 1);
      await new Promise((r) => setTimeout(r, (retry + 0.1) * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`Discord HTTP ${res.status}`);
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const m of batch) {
      const ts = Date.parse(m.timestamp || '');
      if (cutoff && Number.isFinite(ts) && ts < cutoff) {
        before = null; // stop outer
        break;
      }
      const author = m.author || {};
      const avatar = (() => {
        const id = author.id;
        const av = author.avatar;
        if (id && av) {
          const ext = String(av).startsWith('a_') ? 'gif' : 'png';
          return `https://cdn.discordapp.com/avatars/${id}/${av}.${ext}?size=80`;
        }
        const disc = author.discriminator;
        let idx = 0; try { idx = Number(disc) % 5; } catch {}
        return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
      })();
      messages.push({
        message_id: m.id,
        author: author.username,
        author_id: author.id,
        author_display_name: author.global_name || author.display_name || author.username,
        author_avatar_url: avatar,
        timestamp: m.timestamp,
        text: m.content || '',
        attachments: Array.isArray(m.attachments) ? m.attachments.map((a) => a?.url).filter(Boolean) : [],
      });
    }
    if (!before) break;
    before = batch[batch.length - 1]?.id;
  }

  const outDir = path.resolve(process.cwd(), 'public', 'data');
  await fs.mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, `discord-${channelId}.json`);
  await fs.writeFile(outFile, JSON.stringify(messages, null, 2) + '\n', 'utf8');
  console.log(`Saved ${messages.length} messages -> ${outFile}`);
}

main().catch((e) => { console.error(e); process.exit(1); });


