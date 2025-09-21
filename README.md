# Gemini News Scraper → Gemini Summary → Discord (Cloudflare Worker)

This Cloudflare Worker fetches an RSS feed, scrapes each article, summarizes it with Gemini, and posts a daily digest to a Discord channel via webhook. It deduplicates by remembering the last N links posted in KV.

## Requirements
- Node.js 18+
- Cloudflare account + Wrangler
- KV Namespace bound as `STATE_NEWS`
- Secrets: Gemini API key and Discord Webhook URL

## Project layout
- Worker entry: `src/index.js`
- Config: `wrangler.jsonc`
- Local env vars: `.dev.vars`

## Setup
1) Install dependencies
```pwsh
npm install
```

2) Create and bind KV Namespace (production + preview)
```pwsh
npx wrangler kv:namespace create STATE_NEWS
```
Copy the returned `id` and `preview_id` into `wrangler.jsonc` under `kv_namespaces`:
```jsonc
"kv_namespaces": [
	{
		"binding": "STATE_NEWS",
		"id": "YOUR_PROD_ID",
		"preview_id": "YOUR_PREVIEW_ID"
	}
]
```

3) Set secrets (for deploys)
```pwsh
npx wrangler secret put GEMINI_KEY
npx wrangler secret put DISCORD_WEBHOOK_URL
# Optional:
npx wrangler secret put GEMINI_API_URL
```

4) Local development variables (.dev.vars)
Create or edit `.dev.vars` in the project root:
```env
GEMINI_KEY=your_gemini_api_key
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/XXX/YYY
# Optional overrides for local dev
# GEMINI_API_URL=https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=
# RSS_URL=https://feeds.leparisien.fr/leparisien/rss/etudiant/vie-etudiante
# LIMIT=10
# POSTED_MAX=50
```
Wrangler automatically loads `.dev.vars` for `wrangler dev`.

## Local testing
1) Trigger scheduled logic locally (recommended)
```pwsh
npx wrangler dev --test-scheduled --local
```
What to expect in logs:
- `[info] Fetching RSS: …`
- `[info] Found N new articles` or `[info] No new articles.`
- `[ok] Posted news digest to Discord`
- `[ok] Updated posted list with N links; total tracked: X`

2) Reset dedupe state in dev
- Local KV in dev is ephemeral; restart `wrangler dev` to clear `posted:list`.
- If you enabled persistence, delete the local KV storage folder to reset.

## Scheduling
- For testing, `wrangler.jsonc` can use `"*/1 * * * *"` to run every minute.
- For production at 7:00 Europe/Paris, set your desired cron(s) and deploy. (You can either compute DST offsets yourself or trigger two UTC crons and guard in code.)

## Deployment
```pwsh
npm run deploy
```
Ensure the KV namespace and required secrets are configured before deploying.

## How deduplication works
- KV key: `posted:list` (JSON array of recent links)
- On each run:
	1. Read `posted:list` and build a Set for O(1) checks
	2. Filter RSS items to only links not present
	3. Scrape + summarize the new items and post a digest to Discord
	4. Prepend newly posted links, dedupe, trim to `POSTED_MAX` (default 50), save back

## Troubleshooting
- No posts appearing:
	- Verify `DISCORD_WEBHOOK_URL` is set (dev: `.dev.vars`, prod: `wrangler secret`)
	- Check logs for `Discord webhook error …`
- Gemini errors:
	- Verify `GEMINI_KEY` and network access in logs
- Too many or too few items:
	- Adjust `LIMIT` in `wrangler.jsonc` vars or `.dev.vars`
- Repeated posts in production:
	- Confirm the Worker is bound to the correct `STATE_NEWS` namespace and that writes to `posted:list` succeed

## Notes
- Discord messages are auto-chunked under 2000 characters.
- The scraper uses site-specific selectors with a fallback for robustness; tweak selectors in `fetchArticleContent` as needed.
