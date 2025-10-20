#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

const ROOT = path.resolve(process.cwd());
const PUBLIC_DIR = path.join(ROOT, 'public', 'data');
// Allow overriding repo: node generate_interesting_stargazers.mjs owner repo
const argv = process.argv.slice(2);
let OWNER = 'better-auth';
let REPO = 'better-auth';
const fromEnv = process.env.REPO || process.env.GITHUB_REPO;
if (fromEnv && fromEnv.includes('/')) { const [o, r] = fromEnv.split('/'); if (o && r) { OWNER = o; REPO = r; } }
if (argv.length >= 2) { OWNER = argv[0] || OWNER; REPO = argv[1] || REPO; }
else if (argv.length === 1 && argv[0].includes('/')) { const [o, r] = argv[0].split('/'); if (o && r) { OWNER = o; REPO = r; } }
const SNAPSHOT = path.join(PUBLIC_DIR, `github-${OWNER}-${REPO}.json`);
const OUT = path.join(PUBLIC_DIR, `interesting_stargazers-${OWNER}-${REPO}.json`);

function heuristicScore(s) {
  const titleBoost = /cto|chief technology|vp eng|vp of engineering|head of eng|director of eng|founder|co[- ]founder|principal/i;
  const companyBoost = /openai|google|microsoft|amazon|aws|meta|facebook|datadog|vercel|cloudflare|hashicorp|stripe|uber|airbnb|netflix|snowflake/i;
  let score = 0;
  const reasons = [];
  if (s.company) {
    if (companyBoost.test(s.company)) { score += 12; reasons.push('known tech company'); }
    if (titleBoost.test(s.company)) { score += 16; reasons.push('senior title'); }
  }
  if (s.company_org) { score += 6; reasons.push(`org @${s.company_org}`); }
  if (typeof s.company_public_members === 'number') {
    const m = s.company_public_members;
    if (m >= 50) { score += 16; reasons.push('large public member count'); }
    else if (m >= 10) { score += 8; reasons.push('medium public member count'); }
  }
  return { score, reason: reasons.join(', ') || 'baseline' };
}

async function main() {
  await fs.mkdir(PUBLIC_DIR, { recursive: true });
  const json = JSON.parse(await fs.readFile(SNAPSHOT, 'utf8'));
  const stargazers = Array.isArray(json?.stargazers) ? json.stargazers : [];
  if (!stargazers.length) {
    await fs.writeFile(OUT, '[]');
    console.log('No stargazers found. Wrote empty list.');
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  let ranked = [];
  if (apiKey) {
    try {
      const client = new OpenAI({ apiKey });
      const max = Math.min(200, stargazers.length);
      const take = stargazers.slice(0, max);
      const batchSize = 60;
      const scores = new Map();
      for (let i = 0; i < take.length; i += batchSize) {
        const batch = take.slice(i, i + batchSize).map((s) => ({
          login: s.login,
          company: s.company || '',
          company_org: s.company_org || '',
          company_public_members: s.company_public_members || 0,
        }));
        const sys = 'You are ranking GitHub stargazers most likely to be B2B buyers for a developer tool. Return ONLY strict JSON as {"rank":[{"login":"...","score":0-100,"reason":"..."}]}. Prioritize fast-growing companies (recent funding, headcount growth) and buyer titles like VP Engineering or CTO. Use heuristics from provided fields; do not invent data.';
        const user = `Stargazers: ${JSON.stringify(batch)}`;
        const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
        const resp = await client.chat.completions.create({ model, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], temperature: 0 });
        const text = resp.choices?.[0]?.message?.content || '{}';
        const parsed = JSON.parse(text);
        const rank = Array.isArray(parsed?.rank) ? parsed.rank : [];
        for (const r of rank) {
          const login = String(r?.login || ''); if (!login) continue;
          const sc = Number(r?.score ?? 0);
          const rs = String(r?.reason || 'LLM ranked');
          scores.set(login, { score: Math.max(0, Math.min(100, sc)), reason: rs });
        }
      }
      ranked = stargazers.slice(0, 200).map((s) => ({ login: s.login, ...(scores.get(s.login) || heuristicScore(s)) }));
    } catch (e) {
      ranked = stargazers.slice(0, 200).map((s) => ({ login: s.login, ...heuristicScore(s) }));
    }
  } else {
    ranked = stargazers.slice(0, 200).map((s) => ({ login: s.login, ...heuristicScore(s) }));
  }

  ranked.sort((a, b) => b.score - a.score);
  const byLogin = new Map(stargazers.map((s) => [s.login, s]));
  const items = ranked.slice(0, 50).map((r) => {
    const s = byLogin.get(r.login) || {};
    return {
      login: r.login,
      score: r.score,
      reason: r.reason,
      avatar_url: s.avatar_url,
      company: s.company,
      company_org: s.company_org,
      company_public_members: s.company_public_members,
      html_url: s.html_url || `https://github.com/${r.login}`,
    };
  });

  await fs.writeFile(OUT, JSON.stringify(items, null, 2));
  console.log(`Wrote ${items.length} interesting stargazers to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


