#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

// Semantic generator without external APIs (improved labeling and QA detection).
// Usage: node scripts/generate_semantic_insights.mjs <channelId>

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .split(/[^a-z0-9@#]+/g)
    .filter(Boolean);
}

function topN(map, n) {
  return [...map.entries()].sort((a,b)=>b[1]-a[1]).slice(0,n);
}

function cosine(a, b) {
  let dot=0, na=0, nb=0; for (const [k,v] of a) { na += v*v; const w = b.get(k)||0; dot += v*w; }
  for (const [,v] of b) nb += v*v; const denom = Math.sqrt(na)*Math.sqrt(nb)||1; return dot/denom;
}

function tfidfVectors(docs) {
  const tf = docs.map((toks)=>{ const m=new Map(); toks.forEach((t)=>m.set(t,(m.get(t)||0)+1)); return m; });
  const df = new Map(); for (const m of tf) for (const k of m.keys()) df.set(k,(df.get(k)||0)+1);
  const N = docs.length;
  return tf.map((m)=>{ const v=new Map(); for (const [k,c] of m) { const idf = Math.log((1+N)/((df.get(k)||1)))+1; v.set(k, c*idf); } return v; });
}

function kmeans(vectors, k=6, iters=20) {
  if (vectors.length===0) return [];
  const centers = vectors.slice(0, k).map((v)=>new Map(v));
  let assign = new Array(vectors.length).fill(0);
  for (let it=0; it<iters; it++) {
    // assign
    for (let i=0;i<vectors.length;i++) {
      let best=0, bestSim=-1; for (let c=0;c<centers.length;c++) { const sim=cosine(vectors[i], centers[c]); if (sim>bestSim) { bestSim=sim; best=c; } }
      assign[i]=best;
    }
    // update
    const sums = centers.map(()=>new Map()); const counts = centers.map(()=>0);
    for (let i=0;i<vectors.length;i++) { const c=assign[i]; counts[c]++; for (const [k,v] of vectors[i]) sums[c].set(k,(sums[c].get(k)||0)+v); }
    for (let c=0;c<centers.length;c++) centers[c]=sums[c];
  }
  return assign;
}

async function main() {
  const [channelId] = process.argv.slice(2);
  if (!channelId) { console.error('Usage: node scripts/generate_semantic_insights.mjs <channelId>'); process.exit(1); }
  const dataDir = path.resolve(process.cwd(), 'public', 'data');
  const discordPath = path.join(dataDir, `discord-${channelId}.json`);
  const raw = await fs.readFile(discordPath, 'utf8');
  const messages = JSON.parse(raw);
  const STOP = new Set(['a','an','and','the','this','that','to','of','in','on','for','is','are','be','we','you','i','it','at','as','by','with','or','from','your','our','their','there','here','has','have','had','do','does','done','did','can','could','should','would','will','just','also','like','into','over','under','out','up','down','again','any','some','more','most','such','so','than','then','too','very','via','www','http','https','com','discord','github','cua','provider','llm','thought','currently','confirming','love']);
  const docs = messages
    .map((m)=> tokenize(String(m.text||'')).filter((t)=> t.length>=3 && !STOP.has(t)))
    .filter((t)=>t.length>=3);
  const vectors = tfidfVectors(docs);
  const groups = kmeans(vectors, Math.min(8, Math.max(3, Math.floor(docs.length/20))));

  const clusters = new Map();
  for (let i=0;i<groups.length;i++) { const g=groups[i]; if (!clusters.has(g)) clusters.set(g, []); clusters.get(g).push(i); }
  const topics = [];
  const topicExamples = {};
  function frequentNGrams(tokens, n, top=3){
    const m = new Map();
    for (let i=0;i<=tokens.length-n;i++){
      const gramTokens = tokens.slice(i,i+n);
      if (gramTokens.some((w)=>STOP.has(w))) continue;
      const gram = gramTokens.join(' ');
      m.set(gram,(m.get(gram)||0)+1);
    }
    return [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0, top).map(([g])=>g);
  }

  // Phrase extraction with IDF weighting (2-4 grams)
  const dfGlobal = new Map();
  for (const d of docs) {
    const uniq = new Set(d);
    for (const t of uniq) dfGlobal.set(t,(dfGlobal.get(t)||0)+1);
  }
  const Ndocs = docs.length;
  function scorePhrase(tokens){
    const freq = tokens.length;
    const idf = tokens.reduce((s,t)=> s + Math.log((1+Ndocs)/((dfGlobal.get(t)||1))) ,0) / Math.max(1,tokens.length);
    return { score: idf, ok: tokens.every((w)=> w.length>=3 && !STOP.has(w)) };
  }
  function bestPhrases(tokensFlat, top=3){
    const counts = new Map();
    const add = (arr)=>{
      for (let n=4;n>=2;n--){
        for (let i=0;i<=arr.length-n;i++){
          const gram = arr.slice(i,i+n);
          if (gram.some((w)=>STOP.has(w))) continue;
          const key = gram.join(' ');
          counts.set(key,(counts.get(key)||0)+1);
        }
      }
    };
    add(tokensFlat);
    const scored = [...counts.entries()].map(([k,c])=>{
      const toks = k.split(' ');
      const s = scorePhrase(toks).score * c;
      return {k, c, s};
    }).filter((r)=> r.c>=2 && r.k.length>=6);
    // Deduplicate similar by prefix
    scored.sort((a,b)=> b.s - a.s);
    const out=[]; const used=new Set();
    for (const r of scored){
      let dup=false; for (const u of used){ if (r.k.includes(u) || u.includes(r.k)) { dup=true; break; } }
      if (!dup){ out.push(r.k); used.add(r.k); }
      if (out.length>=top) break;
    }
    return out;
  }
  for (const [gi, idxs] of clusters) {
    const bag = new Map();
    const tokensFlat = [];
    for (const i of idxs) { for (const t of docs[i]) { bag.set(t,(bag.get(t)||0)+1); tokensFlat.push(t); } }
    const phrases = bestPhrases(tokensFlat, 3);
    let label = phrases[0] || frequentNGrams(tokensFlat, 2, 1)[0] || topN(bag, 3).map(([t])=>t).filter((w)=>!STOP.has(w)).slice(0,3).join(' ');
    label = label.split(' ').filter((w)=> w.length>=3 && !STOP.has(w)).slice(0,4).join(' ');
    // Select example messages with real content and overlap with label
    const labelTokens = new Set(label.split(' ').filter(Boolean));
    const candidateIdxs = idxs
      .map((i)=> ({ i, m: messages[i] }))
      .filter(({m})=> {
        const txt = String(m?.text||'').trim();
        if (txt.length < 20) return false;
        if (/^(ok|thanks|ty|cool|nice|lol|yes|no|yep|np)[.!\s]/i.test(txt)) return false;
        return true;
      })
      .map(({i,m})=>{
        const toks = new Set(tokenize(String(m?.text||'')));
        let overlap = 0; labelTokens.forEach((t)=>{ if (toks.has(t)) overlap++; });
        return { i, score: overlap };
      })
      .sort((a,b)=> b.score - a.score);
    const chosen = (candidateIdxs.length? candidateIdxs : idxs.map((i)=>({i,score:0}))).slice(0, 12).map(({i})=> i);
    const ids = chosen.map((i)=> String(messages[i]?.message_id || ''));
    topics.push({ topic: label || `Cluster ${gi+1}`, count: chosen.length });
    topicExamples[label || `Cluster ${gi+1}`] = chosen.map((i)=> ({
      message_id: String(messages[i]?.message_id||''),
      author_id: messages[i]?.author_id || messages[i]?.author,
      author_display_name: messages[i]?.author_display_name || messages[i]?.author,
      author_avatar_url: messages[i]?.author_avatar_url,
      timestamp: messages[i]?.timestamp,
      text: messages[i]?.text,
    }));
  }

  // SEO heuristics from topics/keywords
  const allTokens = docs.flat(); const freq = new Map(); for (const t of allTokens) freq.set(t,(freq.get(t)||0)+1);
  const keywords = topN(freq, 40).map(([t])=>t);
  // Unanswered questions: question with no likely answer within next 10 messages
  const questions = [];
  for (let i=0;i<messages.length;i++){
    const m = messages[i];
    const text = String(m.text||'');
    if (text.includes('?')){
      let answered=false;
      for (let j=i+1; j<Math.min(messages.length, i+11); j++){
        const n = messages[j];
        if (n.author_id && n.author_id !== m.author_id){
          const t = String(n.text||'').toLowerCase();
          const hasLink = /https?:\/\//.test(t);
          const hasAction = /(try|use|run|update|fix|works|resolved|solution|guide|docs)/.test(t);
          const overlap = tokenize(text).filter((w)=>!STOP.has(w)).slice(0,8).filter((w)=> t.includes(w)).length;
          if (hasLink || hasAction || overlap>=2){ answered=true; break; }
        }
      }
      if (!answered) questions.push(text);
    }
  }
  // CUA-specific action plans (agent + local LLM focus)
  const recs = [
    'Add end-to-end quickstart: local LLM (Ollama) + CUA Computer agent',
    'Publish security guide on prompt-injection defenses for agents',
    'Create provider compatibility matrix (OpenAI/Ollama/Llama.cpp) with examples',
  ];
  const actions = [
    'Release working examples: MiniCPM, Phi-4, and GPT-4o via OAICOMpat',
    'Document headless vs. headed desktop runs and resource tuning on macOS/Linux',
    'Write troubleshooting for window focus / input issues in long trajectories',
    'Add recipe: redact sensitive data from trajectories before sharing',
    'Add guide: migrating from pure API calls to CUA agent tools',
  ];

  // SEO deep dive (lightweight templates)
  const clustersOut = topics.slice(0,8).map((t)=> ({ cluster: t.topic, intent: 'informational', primary: t.topic, secondary: keywords.slice(0,10) }));
  const briefs = topics.slice(0,4).map((t)=> ({
    slug: t.topic.replace(/[^a-z0-9]+/gi,'-').replace(/^-+|-+$/g,'').toLowerCase(),
    h1: `Understanding ${t.topic}`,
    title_tag: `${t.topic} – Best practices and fixes`,
    meta_description: `Guide to ${t.topic}: best practices, common issues, and fixes for CUA users.`.slice(0,150),
    outline: ['Overview','Common issues','Fixes','Examples'],
    faqs: [ { q: `How do I get started with ${t.topic}?`, a: 'Follow the quickstart and examples on this page.' } ],
    internal_links: [ { anchor: 'CUA Docs', url: 'https://github.com/trycua/cua' } ],
  }));

  const insights = {
    topics,
    seo_recommendations: recs,
    unanswered_questions: questions.slice(0,10),
    action_plans: actions,
    seo_keywords: keywords,
    seo_keyword_clusters: clustersOut,
    seo_briefs: briefs,
  };
  await fs.writeFile(path.join(dataDir, `insights-${channelId}.json`), JSON.stringify(insights, null, 2)+"\n", 'utf8');

  // Write per-channel topic/examples index files
  const topicIndex = topics.map((t)=> ({ topic: t.topic, count: t.count, example_ids: (topicExamples[t.topic]||[]).map((m)=>String(m.message_id)) }));
  await fs.writeFile(path.join(dataDir, `topic_index-${channelId}.json`), JSON.stringify({ topics: topicIndex }, null, 2)+"\n", 'utf8');
  await fs.writeFile(path.join(dataDir, `examples_index-${channelId}.json`), JSON.stringify(topicExamples, null, 2)+"\n", 'utf8');

  console.log('Wrote:', `insights-${channelId}.json`, `topic_index-${channelId}.json`, `examples_index-${channelId}.json`);
}

main().catch((e)=>{ console.error(e); process.exit(1); });


