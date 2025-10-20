#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

// Ensure every topic has at least one example with non-empty text.
// Usage: node scripts/repair_examples.mjs <channelId>

function tokenize(text){ return (text||'').toLowerCase().split(/[^a-z0-9]+/g).filter(Boolean); }

async function main(){
  const [channelId] = process.argv.slice(2);
  if(!channelId){ console.error('Usage: node scripts/repair_examples.mjs <channelId>'); process.exit(1); }
  const dataDir = path.resolve(process.cwd(), 'public', 'data');
  const discord = JSON.parse(await fs.readFile(path.join(dataDir, `discord-${channelId}.json`), 'utf8'));
  const topicIndexPath = path.join(dataDir, `topic_index-${channelId}.json`);
  const examplesIndexPath = path.join(dataDir, `examples_index-${channelId}.json`);
  const topicsJson = JSON.parse(await fs.readFile(topicIndexPath, 'utf8'));
  const examplesIdx = JSON.parse(await fs.readFile(examplesIndexPath, 'utf8'));

  const byId = new Map(discord.map((m)=> [String(m.message_id||''), m]));

  let changed = false;
  for (const t of topicsJson.topics || []){
    const name = t.topic;
    let arr = Array.isArray(examplesIdx[name]) ? examplesIdx[name] : [];
    arr = arr.filter((m)=> m && typeof m.text === 'string' && m.text.trim().length > 0);
    // If empty, try to find a relevant example from discord messages
    if (!arr.length){
      const toks = new Set(tokenize(name));
      const candidates = discord
        .filter((m)=> typeof m.text === 'string' && m.text.trim().length > 20)
        .map((m)=>{ const mtoks = new Set(tokenize(m.text)); let overlap=0; toks.forEach((w)=>{ if (mtoks.has(w)) overlap++; }); return { m, overlap }; })
        .filter((r)=> r.overlap >= 1)
        .sort((a,b)=> b.overlap - a.overlap)
        .slice(0, 5)
        .map((r)=> ({
          message_id: String(r.m.message_id||''),
          author_id: r.m.author_id || r.m.author,
          author_display_name: r.m.author_display_name || r.m.author,
          author_avatar_url: r.m.author_avatar_url,
          timestamp: r.m.timestamp,
          text: r.m.text,
        }));
      if (candidates.length){ examplesIdx[name] = candidates; changed = true; }
    } else {
      examplesIdx[name] = arr; // keep filtered
      changed = true;
    }
    // Update topic example_ids to reflect filtered/selected messages
    const ids = (examplesIdx[name]||[]).map((m)=> String(m.message_id||''));
    if (JSON.stringify(ids) !== JSON.stringify(t.example_ids||[])) { t.example_ids = ids; changed = true; }
  }

  if (changed){
    await fs.writeFile(examplesIndexPath, JSON.stringify(examplesIdx, null, 2)+"\n", 'utf8');
    await fs.writeFile(topicIndexPath, JSON.stringify({ topics: topicsJson.topics }, null, 2)+"\n", 'utf8');
    console.log('Repaired examples for channel:', channelId);
  } else {
    console.log('No changes needed for channel:', channelId);
  }
}

main().catch((e)=>{ console.error(e); process.exit(1); });


