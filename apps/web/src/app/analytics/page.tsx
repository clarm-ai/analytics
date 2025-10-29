'use client';
import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiCsvUrl } from '@/src/lib/api';

type Row = {
  platform: string;
  organization_id: string | null;
  assistant_id: number | null;
  end_user_id_type: string | null;
  end_user_identifier: string | null;
  workspace_or_guild_id: string | null;
  messages_sent_to_user: number;
  messages_from_user: number;
  first_date: string;
  last_date: string;
};

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export default function AnalyticsOverview() {
  const [rows, setRows] = useState<Row[]>([]);
  const [start, setStart] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return ymd(d); });
  const [end, setEnd] = useState(() => ymd(new Date()));
  const [loading, setLoading] = useState(false);
  const csvUrl = useMemo(() => apiCsvUrl('/analytics/end-users/messages/export', { start_date: start, end_date: end }), [start, end]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        const data = await apiGet<Row[]>('/analytics/end-users/messages', { start_date: start, end_date: end, limit: 200 });
        if (mounted) setRows(data);
      } finally { setLoading(false); }
    })();
    return () => { mounted = false; };
  }, [start, end]);

  const totals = useMemo(() => {
    const byPlatform: Record<string, number> = {};
    const conv = new Set<string>();
    let msgs = 0;
    for (const r of rows) {
      const t = (r.messages_from_user ?? 0) + (r.messages_sent_to_user ?? 0);
      msgs += t;
      const p = r.platform || 'unknown';
      byPlatform[p] = (byPlatform[p] || 0) + t;
      conv.add(`${p}|${r.assistant_id ?? ''}|${r.end_user_identifier ?? ''}|${r.workspace_or_guild_id ?? ''}`);
    }
    return { messages: msgs, conversations: conv.size, byPlatform };
  }, [rows]);

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>Analytics</h1>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <label>Start <input type="date" value={start} onChange={e => setStart(e.target.value)} /></label>
        <label>End <input type="date" value={end} onChange={e => setEnd(e.target.value)} /></label>
        <a href={csvUrl} style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6 }}>Download CSV</a>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 12, color: '#666', textTransform: 'uppercase' }}>Messages</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{totals.messages}</div>
        </div>
        <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 12, color: '#666', textTransform: 'uppercase' }}>Unique conversations</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{totals.conversations}</div>
        </div>
        <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 12, color: '#666', textTransform: 'uppercase' }}>By platform</div>
          <div style={{ marginTop: 8 }}>
            {Object.entries(totals.byPlatform).map(([p, n]) => (
              <div key={p} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ textTransform: 'capitalize' }}>{p}</span><span>{n}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ border: '1px solid #eee', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', fontSize: 14 }}>
          <thead style={{ background: '#fafafa', color: '#555' }}>
            <tr>
              <th style={{ padding: 8, textAlign: 'left' }}>Platform</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Assistant</th>
              <th style={{ padding: 8, textAlign: 'left' }}>User Identifier</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Channel</th>
              <th style={{ padding: 8, textAlign: 'right' }}>User msgs</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Assistant msgs</th>
              <th style={{ padding: 8, textAlign: 'left' }}>First</th>
              <th style={{ padding: 8, textAlign: 'left' }}>Last</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td style={{ padding: 16 }} colSpan={8}>Loading…</td></tr>}
            {!loading && rows.slice(0, 50).map((r, i) => (
              <tr key={i} style={{ borderTop: '1px solid #f0f0f0' }}>
                <td style={{ padding: 8, textTransform: 'capitalize' }}>{r.platform}</td>
                <td style={{ padding: 8 }}>{r.assistant_id ?? '-'}</td>
                <td style={{ padding: 8, wordBreak: 'break-all' }}>{r.end_user_identifier ?? '-'}</td>
                <td style={{ padding: 8 }}>{r.workspace_or_guild_id ?? '-'}</td>
                <td style={{ padding: 8, textAlign: 'right' }}>{r.messages_from_user}</td>
                <td style={{ padding: 8, textAlign: 'right' }}>{r.messages_sent_to_user}</td>
                <td style={{ padding: 8 }}>{r.first_date}</td>
                <td style={{ padding: 8 }}>{r.last_date}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && <tr><td style={{ padding: 16 }} colSpan={8}>No data</td></tr>}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12 }}>
        <a href="/analytics/explore" style={{ color: '#2563eb', textDecoration: 'underline' }}>Go to Explore (full filters)</a>
      </div>
    </div>
  );
}


