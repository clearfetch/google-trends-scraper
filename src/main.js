import { Actor, log } from 'apify';
import { gotScraping } from 'got-scraping';
import {
    PROPERTIES, TRENDS, exploreUrl, parseGeo, parseKeywordLine, parseRegions, parseRelated, parseTimeRange, parseTimeline, parseTrendingRss,
    parseTrendsJson, pickWidgets, summarize, webUrl, widgetUrl,
} from './trends.js';

const EVENT_KEYWORD = 'keyword';
const EVENT_TRENDING = 'trending-search';
const KEYWORD_FIELDS = ['keywords', 'keyword', 'searchTerms', 'queries', 'terms', 'q'];
// Google Trends limits requests per IP. From Apify's IPs (2026-09-29): 1.5 s apart, most data requests got 429;
// 8 s apart, 23 of 26 succeeded. The gap starts short, widens on each 429 and narrows again on success.
const BACKOFF_MS = [10000, 20000, 40000, 80000];
const MAX_GAP_MS = 15000;
const HEADER_OPTIONS = { browsers: [{ name: 'chrome', minVersion: 120 }], devices: ['desktop'] };

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const lines = collectLines(input, KEYWORD_FIELDS);
const trendingGeos = collectLines(input, ['trendingNowGeos', 'trendingGeos', 'trendingNow']);
if (!lines.length && !trendingGeos.length) {
    await Actor.fail('Nothing to look up. Pass "keywords" (e.g. ["coffee", "chatgpt vs gemini"]) and/or "trendingNowGeos" (e.g. ["US", "GB"]).');
}
const timeRange = parseTimeRange(input.timeRange, input.customTimeRange);
if (timeRange.error) await Actor.fail(`"timeRange": ${timeRange.error}.`);
const geo = parseGeo(input.geo);
if (geo.error) await Actor.fail(`"geo": ${geo.error}.`);
const property = String(input.property ?? '');
if (!(property in PROPERTIES)) await Actor.fail(`"property" must be one of: ${Object.keys(PROPERTIES).map((p) => `"${p}"`).join(', ')}.`);
const query = {
    geo: geo.geo,
    time: timeRange.time,
    category: Math.max(0, Math.floor(Number(input.category ?? 0)) || 0),
    property,
    hl: String(input.language || 'en-US'),
    tz: 0,
};
const includeRegions = input.includeRegions !== false;
const includeRelated = input.includeRelatedQueries !== false;
const minGapMs = clamp(Number(input.minDelaySecs ?? 2), 1, 30) * 1000;
const maxItems = clamp(Number(input.maxItems ?? 0), 0, 1e6);
const timeoutMs = clamp(Number(input.timeoutSecs ?? 30), 5, 120) * 1000;
const wantsProxy = input.proxyConfiguration?.useApifyProxy === true || input.proxyConfiguration?.proxyUrls?.length > 0;
const proxyConfiguration = wantsProxy ? await Actor.createProxyConfiguration(input.proxyConfiguration) : undefined;

let stop = false;
let charged = 0;
let failed = 0;
let partial = 0;
let gapMs = minGapMs;
let lastRequestAt = 0;
let cookie = '';
let throttled = 0;

for (const g of trendingGeos) {
    if (stop) break;
    await trendingNow(g);
}

if (lines.length) {
    await refreshCookie();
    let done = 0;
    const seen = new Set();
    for (const line of lines) {
        if (stop) break;
        const key = line.toLowerCase().replace(/\s+/g, ' ');
        if (seen.has(key)) continue;
        seen.add(key);
        await lookUp(line);
        done += 1;
        if (done % 10 === 0) await Actor.setStatusMessage(`${done}/${lines.length} keywords, ${charged} results, ${failed} failed`);
    }
}

if (stop) log.warning('Stopped early: the maximum cost or item count set for this run was reached.');
await Actor.setStatusMessage(`${charged} results, ${failed} failed${partial ? `, ${partial} incomplete (not charged)` : ''}`, { isStatusMessageTerminal: true });
log.info(`Finished: ${charged} result(s), ${failed} failed, ${partial} incomplete and not charged; Google throttled ${throttled} request(s), final gap ${(gapMs / 1000).toFixed(1)} s`);
await Actor.exit();

// ---------------------------------------------------------------------------------------------------------

async function lookUp(line) {
    const parsed = parseKeywordLine(line);
    if (parsed.error) return reportError(line, parsed.error);
    const { terms } = parsed;
    const q = { ...query, terms };
    const base = {
        ok: true,
        type: 'keyword',
        keyword: terms.join(' vs '),
        terms,
        geo: q.geo || 'worldwide',
        timeRange: q.time,
        category: q.category,
        property: q.property || 'web',
        url: webUrl(q),
    };

    let widgets;
    try {
        widgets = pickWidgets(parseTrendsJson((await trendsGet(exploreUrl(q))).body), terms.length);
    } catch (err) {
        return reportError(line, `Google Trends did not answer: ${err.message}`, base);
    }
    if (!widgets.timeline) return reportError(line, 'Google Trends returned no chart for this query (too little search volume, or an unsupported category)', base);

    const row = { ...base, interestOverTime: [], averages: {}, peakDate: null, peakValue: null, latestValue: null, changePercent: null, interestByRegion: [], relatedQueries: [], missingSections: [] };
    const section = async (name, widget, apply) => {
        if (!widget) return;
        try {
            apply(parseTrendsJson((await trendsGet(widgetUrl(widget, q))).body));
        } catch (err) {
            row.missingSections.push(name);
            log.warning(`${base.keyword}: ${name} failed: ${err.message}`);
        }
    };

    await section('interestOverTime', widgets.timeline, (data) => {
        const t = parseTimeline(data, terms);
        row.interestOverTime = t.points;
        row.averages = t.averages;
        Object.assign(row, summarize(t.points));
    });
    if (includeRegions) await section('interestByRegion', widgets.regions, (data) => { row.interestByRegion = parseRegions(data, terms); });
    if (includeRelated) {
        for (const [i, w] of widgets.related.entries()) {
            await section(`relatedQueries:${terms[i]}`, w, (data) => { row.relatedQueries.push(...parseRelated(data, terms[i])); });
        }
    }
    row.scrapedAt = new Date().toISOString();

    const hasSignal = row.interestOverTime.some((pt) => Object.values(pt.values).some((v) => v > 0));
    if (!row.missingSections.includes('interestOverTime') && !hasSignal) {
        return reportError(line, 'Google Trends has too little search data for this query in this region and time range', base);
    }
    if (row.missingSections.length) {
        // Written so the data that did arrive is not lost, but not charged: the row is not what was asked for.
        partial += 1;
        row.partial = true;
        await Actor.pushData(row);
        return;
    }
    row.partial = false;
    await pushCharged(row, EVENT_KEYWORD);
}

async function trendingNow(g) {
    const parsed = parseGeo(g);
    if (parsed.error || !parsed.geo) return reportError(g, parsed.error ?? 'trending searches need a country code, e.g. US');
    try {
        const res = await request(`${TRENDS}/trending/rss?geo=${parsed.geo}`);
        if (res.statusCode === 404 || res.statusCode === 400) return reportError(g, `Google has no trending feed for "${parsed.geo}"`);
        if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}`);
        const items = parseTrendingRss(res.body, parsed.geo);
        if (!items.length) return reportError(g, `the trending feed for "${parsed.geo}" is empty right now`);
        const now = new Date().toISOString();
        for (const [i, item] of items.entries()) {
            if (stop) break;
            await pushCharged({ ...item, rank: i + 1, scrapedAt: now }, EVENT_TRENDING);
        }
    } catch (err) {
        return reportError(g, `could not read the trending feed: ${err.message}`);
    }
}

/**
 * One Trends request at a time, spaced by the current gap. A 429 waits out a backoff, widens the gap and, after two
 * in a row, fetches a fresh cookie; a success narrows the gap back towards the minimum.
 */
async function trendsGet(url) {
    let streak = 0;
    for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt += 1) {
        const wait = lastRequestAt + gapMs - Date.now();
        if (wait > 0) await sleep(wait);
        lastRequestAt = Date.now();
        const res = await request(url, { headers: { cookie } });
        if (res.statusCode === 200) {
            gapMs = Math.max(minGapMs, gapMs * 0.85);
            return res;
        }
        if (res.statusCode !== 429 && res.statusCode < 500) throw new Error(`HTTP ${res.statusCode}`);
        throttled += 1;
        streak += 1;
        gapMs = Math.min(MAX_GAP_MS, gapMs * 1.6);
        if (attempt === BACKOFF_MS.length) break;
        log.info(`Google Trends is throttling (HTTP ${res.statusCode}); waiting ${BACKOFF_MS[attempt] / 1000} s, then ${(gapMs / 1000).toFixed(1)} s between requests`);
        await sleep(BACKOFF_MS[attempt]);
        if (streak >= 2) await refreshCookie();
    }
    throw new Error('still throttled after retries');
}

/** Trends hands out its NID cookie even on the 429 it answers to a cookieless first visit. */
async function refreshCookie() {
    try {
        const res = await request(`${TRENDS}/trends/explore?geo=US&q=weather`);
        const fresh = [res.headers['set-cookie'] ?? []].flat().map((c) => c.split(';')[0]).filter(Boolean);
        if (fresh.length) cookie = fresh.join('; ');
    } catch (err) {
        log.warning(`Could not get a Google Trends cookie: ${err.message}`);
    }
    lastRequestAt = Date.now();
}

async function request(url, extra = {}) {
    const proxyUrl = proxyConfiguration ? await proxyConfiguration.newUrl() : undefined;
    return gotScraping({
        url,
        proxyUrl,
        throwHttpErrors: false,
        timeout: { request: timeoutMs },
        retry: { limit: 1 },
        headerGeneratorOptions: HEADER_OPTIONS,
        ...extra,
    });
}

async function pushCharged(item, event) {
    if (stop) return;
    const result = await Actor.pushData(item, event);
    charged += 1;
    if (result?.eventChargeLimitReached || (maxItems && charged >= maxItems)) stop = true;
}

async function reportError(inputValue, error, extra = {}) {
    failed += 1;
    log.warning(`${inputValue}: ${error}`);
    await Actor.pushData({ ...extra, ok: false, input: String(inputValue), error, scrapedAt: new Date().toISOString() });
}

function collectLines(inp, keys) {
    const out = [];
    const push = (v) => {
        if (v === null || v === undefined || v === '') return;
        if (Array.isArray(v)) return v.forEach(push);
        if (typeof v === 'object') return push(v.keyword ?? v.term ?? v.query ?? v.value);
        // Commas are not separators: a term can contain one. Newlines are.
        String(v).split(/[\n\r]+/).map((s) => s.trim()).filter(Boolean).forEach((s) => out.push(s));
    };
    for (const key of keys) push(inp[key]);
    return out;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(n, lo, hi) {
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
}
