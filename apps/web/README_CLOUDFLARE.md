# Deploy to Cloudflare Pages

This app is configured to deploy on Cloudflare Pages using `@cloudflare/next-on-pages`.

## Prereqs
- Cloudflare account
- `wrangler` CLI (`npm i -g wrangler`)
- Set secrets in Cloudflare Pages project:
  - `OPENAI_API_KEY`
  - `GITHUB_TOKEN` (optional but recommended)
  - `OPENAI_MODEL` (optional, defaults to `gpt-4o-mini`)

## Build locally

```bash
cd apps/web
npm i
npm run pages:build
```

## Cloudflare Pages
- Create a new Pages project
- Framework preset: Next.js
- Build command: `npm run pages:build`
- Build output directory: `.`
- Root directory: `apps/web`
- Add environment variables listed above

## Wrangler (optional)
You can also deploy via `wrangler pages deploy` from `apps/web`.

### D1 setup

```bash
# from apps/web
npx wrangler d1 create analytics
# copy the returned database_id into wrangler.toml under [[d1_databases]] database_id

# Apply migrations locally
npx wrangler d1 migrations apply analytics --local

# Or apply in Cloudflare
npx wrangler d1 migrations apply analytics

# Seed demo data (optional)
SEED_TOKEN=dev-secret curl -X POST -H "Authorization: Bearer dev-secret" \
  "http://localhost:3005/api/seed?uid=demo"
```

Ensure Pages project has a D1 binding named `DB` mapped to your database.
