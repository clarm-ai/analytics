# Web App

## Cloudflare Pages Deploy

- Root directory: `apps/web`
- Build command: `npm run pages:build`
- Environment variables:
  - `OPENAI_API_KEY`
  - `GITHUB_TOKEN`
  - `OPENAI_MODEL` (optional)
- Files included:
  - `wrangler.toml`
  - `.cfignore`
  - `.github/workflows/cloudflare-pages.yml`
