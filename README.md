## Discord Analytics Web App

This project includes a Next.js frontend that renders analytics from Discord channel data and an LLM-powered insights endpoint.

### Structure
- apps/web: Next.js app with API routes and UI
- scripts: data fetchers/scrapers (Discord, renderer)
- data: local JSON exports (gitignored)

### Features
- Top topics (LLM-extracted)
- Top contributors with avatar and display name
- Contributions by weekday
- SEO recommendations (LLM)
- Unanswered questions (LLM)
- Dedicated page: `Most Discussed Topics`

### Prerequisites
- Node.js 18+
- Data JSON under `data/discord-*.json` (an array of messages). Use scripts in `scripts/` to fetch/scrape.
- `.env` at project root with:

```
OPENAI_API_KEY=sk-...
# Optional (default: gpt-4o-mini)
OPENAI_MODEL=gpt-4o-mini
```

If you plan to re-fetch via REST, also set:

```
DISCORD_TOKEN=Bot <token>
```

### Run the Web App

```
cd apps/web
npm run dev
```

Open http://localhost:3000

### Data Format
`data/discord-*.json` should be a list of objects with at least:
- `author`, `author_id`, `author_display_name`, `author_avatar_url`
- `timestamp` (ISO), `text`, `attachments` (array)

The API picks the newest `discord-*.json` by modification time.

### API Endpoints
- `GET /api/stats` — computes contributors and weekday counts from the JSON.
- `GET /api/insights` — calls OpenAI to extract topics, SEO recommendations, and unanswered questions.

### Scripts
- `scripts/discord_fetch_via_api.py` — fetch via Discord REST (requires `DISCORD_TOKEN`).
- `scripts/discord_scrape_channel.py` — scrape via Playwright (renders DOM).
- `scripts/render_discord_json_to_html.py` — quick HTML rendering from JSON.

### Security Notes
- Tokens live in `.env` and are never committed.
- `data/` is gitignored.
