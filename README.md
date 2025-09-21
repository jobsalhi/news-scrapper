# Gemini News Scraper → Gemini Summary → Discord

This script fetches items from an RSS feed, scrapes each article, summarizes it using Gemini, and posts the bullet points to a Discord channel via webhook.

## Requirements
- Node.js 18+
- API key for Google Gemini (Generative Language API)
- Discord Webhook URL

## Setup
1. Install dependencies:

```pwsh
npm install
```

2. Set environment variables. You can use the existing `.dev.vars` file or your shell environment.

Add to `.dev.vars`:

```
GEMINI_KEY=your_gemini_api_key
GEMINI_API_URL=https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/XXX/YYY
```

Notes:
- `GEMINI_API_URL` can be omitted; the default above is used.
- `.dev.vars` is automatically loaded by `test.js` for local runs.

## Usage
- Dry run (no Discord post):

```pwsh
node test.js --dry-run --limit 3 --url "https://feeds.leparisien.fr/leparisien/rss/etudiant/vie-etudiante"
```

- Post to Discord:

```pwsh
node test.js --limit 5 --url "https://feeds.leparisien.fr/leparisien/rss/etudiant/vie-etudiante"
```

Arguments:
- `--limit <n>`: number of RSS items to process (default 5)
- `--dry-run`: print messages instead of posting to Discord
- `--url <rss>`: override the RSS feed URL

## Notes
- The scraper uses a few common CSS selectors to extract article text and falls back to the document body. You may tweak the `candidates` list in `fetchArticleContent` for better site-specific results.
- Discord has a 2000 character limit per message; messages are chunked automatically.
- The Gemini prompt is tuned for crisp bullet points; adjust as needed.
