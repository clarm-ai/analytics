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
