import fetch from 'node-fetch';
import { parseStringPromise } from 'xml2js';
import { load as cheerioLoad } from 'cheerio';

// --- Env helper -----------------------------------------------------------
function getEnv(env, name, { required = false } = {}) {
	const v = env[name];
	if (required && (!v || !v.trim())) {
		throw new Error(`Missing required env: ${name}`);
	}
	return v;
}

// --- RSS fetch ------------------------------------------------------------
async function fetchRssItems(rssUrl, limit = 5) {
	const res = await fetch(rssUrl);
	if (!res.ok) throw new Error(`RSS fetch failed: ${res.status}`);
	const xml = await res.text();

	const data = await parseStringPromise(xml);
	const items = (data?.rss?.channel?.[0]?.item || []).slice(0, limit);

	return items.map((item) => ({
		title: item.title?.[0] || '',
		link: item.link?.[0] || '',
		description: item.description?.[0] || '',
		pubDate: item.pubDate?.[0] || '', // optional, not used for filtering
	}));
}

// --- Article scraping -----------------------------------------------------
async function fetchArticleContent(url) {
	const res = await fetch(url, {
		headers: {
			'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
		},
	});
	if (!res.ok) throw new Error(`Article fetch failed (${res.status}) for ${url}`);
	const html = await res.text();
	const $ = cheerioLoad(html);

	const title = $('h1.title_xl').text().trim();
	const subheadline = $('p.subheadline').text().trim();
	let articleBody = [];

	$('section.content').each((i, section) => {
		$(section)
			.find('p.paragraph, h2.inline_title')
			.each((j, element) => {
				const text = $(element).text().trim();
				if (text) articleBody.push(text);
			});
	});

	let fullArticleText = [title, subheadline, ...articleBody].join('\n\n');

	if (fullArticleText.trim().length < 200) {
		const articleContainer = $('article.article-full');
		articleContainer
			.find(
				'.article_breadcrumb, .share-toolsv2-container, .etx-player, .ad_element, .article-read-also_container, .article-links, #right_rail, figure, figcaption'
			)
			.remove();
		fullArticleText = articleContainer.text();
	}

	return fullArticleText.replace(/\s{2,}/g, ' ').trim();
}

// --- Gemini summarization -------------------------------------------------
async function summarizeWithGemini(env, articles) {
	const GEMINI_KEY = getEnv(env, 'GEMINI_KEY', { required: true });
	const GEMINI_API_URL_BASE =
		env.GEMINI_API_URL || 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=';

	const promptParts = [
		'You are an assistant that summarizes multiple news articles into concise bullet points.',
		'Include title, date if available, 3-6 bullets per article, clearly separated.',
		'',
	];

	for (const a of articles) {
		promptParts.push(`### ${a.title}`);
		if (a.description) promptParts.push(`Summary: ${a.description}`);
		if (a.pubDate) promptParts.push(`Date: ${a.pubDate}`);
		promptParts.push('');
		promptParts.push('Full text:');
		promptParts.push(a.content);
		promptParts.push('');
	}

	const prompt = promptParts.join('\n');

	const url = `${GEMINI_API_URL_BASE}${encodeURIComponent(GEMINI_KEY)}`;
	const body = {
		contents: [{ role: 'user', parts: [{ text: prompt }] }],
		generationConfig: { temperature: 0.4, maxOutputTokens: 1200 },
	};

	const res = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		const errTxt = await res.text().catch(() => '');
		throw new Error(`Gemini API error ${res.status}: ${errTxt}`);
	}

	const json = await res.json();
	const candidate = json.candidates?.[0];
	const parts = candidate?.content?.parts || candidate?.content?.[0]?.parts || [];
	return parts
		.map((p) => p.text)
		.filter(Boolean)
		.join('\n')
		.trim();
}

// --- Discord webhook ------------------------------------------------------
async function postToDiscord(webhookUrl, content) {
	const chunks = [];
	for (let i = 0; i < content.length; i += 1800) chunks.push(content.slice(i, i + 1800));

	for (const chunk of chunks) {
		const res = await fetch(webhookUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ content: chunk }),
		});
		if (!res.ok) {
			const t = await res.text().catch(() => '');
			throw new Error(`Discord webhook error ${res.status}: ${t}`);
		}
	}
}

// --- Worker entrypoint ----------------------------------------------------
export default {
	async scheduled(event, env, ctx) {
		try {
			const rssUrl = env.RSS_URL || 'https://feeds.leparisien.fr/leparisien/rss/etudiant/vie-etudiante';
			const webhook = getEnv(env, 'DISCORD_WEBHOOK_URL', { required: true });

			console.log(`[info] Fetching RSS: ${rssUrl}`);
			const articles = await fetchRssItems(rssUrl, env.LIMIT);
			if (!articles.length) return console.log('[warn] No RSS items found.');

			// Changed: use a rolling list of previously posted links in KV for dedup
			const POSTED_LIST_KEY = 'posted:list';
			const POSTED_MAX = Number(env.POSTED_MAX || 50);
			const postedJson = await env.STATE_NEWS.get(POSTED_LIST_KEY);
			const postedList = Array.isArray(safeJsonParse(postedJson)) ? safeJsonParse(postedJson) : [];
			const postedSet = new Set(postedList);

			// Filter only new articles by link (skip items without links)
			const newArticles = articles.filter((a) => a.link && !postedSet.has(a.link));
			if (!newArticles.length) return console.log('[info] No new articles.');

			console.log(`[info] Found ${newArticles.length} new articles`);

			// Scrape content
			for (const a of newArticles) {
				a.content = await fetchArticleContent(a.link);
			}

			// Summarize all at once
			const summary = await summarizeWithGemini(env, newArticles);

			// Build Discord message
			const message = ['📰 **News Digest**', '', summary, '', ...newArticles.map((a) => a.link)].join('\n');
      
			await postToDiscord(webhook, message);

			// Changed: update rolling list in KV with newly posted links
			const merged = [...newArticles.map((a) => a.link), ...postedList];
			const deduped = [];
			const seen = new Set();
			for (const id of merged) {
				if (!id || seen.has(id)) continue;
				seen.add(id);
				deduped.push(id);
				if (deduped.length >= POSTED_MAX) break;
			}
			await env.STATE_NEWS.put(POSTED_LIST_KEY, JSON.stringify(deduped));
			console.log(`[ok] Updated posted list with ${newArticles.length} links; total tracked: ${deduped.length}`);
			console.log('[ok] Posted news digest to Discord');
		} catch (err) {
			console.error('[error]', err.message);
		}
	},
};  

// Helper: safe JSON.parse returning null on failure
function safeJsonParse(s) {
	if (!s) return null;
	try {
		return JSON.parse(s);
	} catch {
		return null;
	}
}
