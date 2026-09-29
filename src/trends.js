/**
 * Google Trends request building and response parsing. No network here, so every rule is testable on fixtures.
 *
 * Flow per keyword (or comparison of up to five): `explore` returns one widget per chart, each with a request
 * object and a short-lived token; each widget's data comes from `widgetdata/<kind>` with that request and token.
 * Every Trends response starts with the anti-JSON-hijacking prefix `)]}'`, which is stripped before parsing.
 */

export const TRENDS = 'https://trends.google.com';

export const TIME_RANGES = {
    'now 1-H': 'Past hour',
    'now 4-H': 'Past 4 hours',
    'now 1-d': 'Past day',
    'now 7-d': 'Past 7 days',
    'today 1-m': 'Past 30 days',
    'today 3-m': 'Past 90 days',
    'today 12-m': 'Past 12 months',
    'today 5-y': 'Past 5 years',
    all: '2004 to present',
};

export const PROPERTIES = { '': 'Web search', images: 'Image search', news: 'News search', froogle: 'Google Shopping', youtube: 'YouTube search' };

/**
 * One input line to a list of terms: "coffee" is one term, "chatgpt vs gemini vs claude" compares up to five.
 * Returns { terms } or { error }.
 */
export function parseKeywordLine(line) {
    const text = String(line ?? '').trim();
    if (!text) return { error: 'empty keyword' };
    const terms = text.split(/\s+vs\.?\s+/i).map((t) => t.trim()).filter(Boolean);
    if (terms.length > 5) return { error: 'Google Trends compares at most 5 terms at once' };
    if (terms.some((t) => t.length > 100)) return { error: 'a term is longer than 100 characters' };
    return { terms };
}

/** Validates the time range: one of TIME_RANGES, or "YYYY-MM-DD YYYY-MM-DD". Returns { time } or { error }. */
export function parseTimeRange(timeRange, customTimeRange) {
    const custom = String(customTimeRange ?? '').trim();
    if (custom) {
        const m = custom.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})$/);
        if (!m || Number.isNaN(Date.parse(m[1])) || Number.isNaN(Date.parse(m[2]))) return { error: 'customTimeRange must look like "2025-01-01 2025-06-30"' };
        if (m[1] >= m[2]) return { error: 'customTimeRange must start before it ends' };
        if (m[1] < '2004-01-01') return { error: 'Google Trends data starts on 2004-01-01' };
        return { time: `${m[1]} ${m[2]}` };
    }
    const t = String(timeRange ?? 'today 12-m').trim() || 'today 12-m';
    if (!(t in TIME_RANGES)) return { error: `unknown timeRange "${t}"; use one of ${Object.keys(TIME_RANGES).join(', ')}` };
    return { time: t };
}

/** "US", "us", "US-CA", "" (worldwide). Returns { geo } or { error }. */
export function parseGeo(geo) {
    const g = String(geo ?? '').trim().toUpperCase();
    if (!g) return { geo: '' };
    if (!/^[A-Z]{2}(-[A-Z0-9]{1,3}){0,2}$/.test(g)) return { error: `"${geo}" is not a country code (e.g. US) or region code (e.g. US-CA)` };
    return { geo: g };
}

export function exploreUrl({ terms, geo, time, category, property, hl, tz }) {
    const req = {
        comparisonItem: terms.map((keyword) => ({ keyword, geo, time })),
        category: Number(category) || 0,
        property: property ?? '',
    };
    return `${TRENDS}/trends/api/explore?hl=${encodeURIComponent(hl)}&tz=${tz}&req=${encodeURIComponent(JSON.stringify(req))}`;
}

/** The public Trends page for the same query, for the row's link. */
export function webUrl({ terms, geo, time, category, property, hl }) {
    const p = new URLSearchParams();
    p.set('q', terms.join(','));
    p.set('date', time);
    if (geo) p.set('geo', geo);
    if (Number(category)) p.set('cat', String(category));
    if (property) p.set('gprop', property);
    p.set('hl', hl);
    return `${TRENDS}/trends/explore?${p.toString()}`;
}

const WIDGET_PATH = { fe_line_chart: 'multiline', fe_multi_heat_map: 'comparedgeo', fe_geo_chart_explore: 'comparedgeo', fe_related_searches: 'relatedsearches' };

export function widgetUrl(widget, { hl, tz }) {
    const path = WIDGET_PATH[widget.type];
    if (!path) return null;
    return `${TRENDS}/trends/api/widgetdata/${path}?hl=${encodeURIComponent(hl)}&tz=${tz}&req=${encodeURIComponent(JSON.stringify(widget.request))}&token=${encodeURIComponent(widget.token)}`;
}

/** Strips the `)]}'` prefix and parses. Throws on anything that is not Trends JSON (an HTML error page, say). */
export function parseTrendsJson(body) {
    const text = String(body ?? '');
    const start = text.indexOf('{');
    if (start === -1 || !/^\s*\)\]\}'/.test(text)) throw new Error('not a Google Trends response');
    return JSON.parse(text.slice(start));
}

/**
 * The widgets this Actor reads, from an explore response: the timeline, the combined region map, and the related
 * queries per term. Comparisons also carry one region map per term (GEO_MAP_0...), which the combined map covers.
 */
export function pickWidgets(explore, termCount) {
    const widgets = explore.widgets ?? [];
    const byId = Object.fromEntries(widgets.map((w) => [w.id, w]));
    const related = termCount > 1
        ? Array.from({ length: termCount }, (_, i) => byId[`RELATED_QUERIES_${i}`] ?? null)
        : [byId.RELATED_QUERIES ?? null];
    return { timeline: byId.TIMESERIES ?? null, regions: byId.GEO_MAP ?? null, related };
}

/** Interest over time: one point per date with each term's 0-100 value. */
export function parseTimeline(data, terms) {
    const points = (data.default?.timelineData ?? []).map((p) => {
        const values = Object.fromEntries(terms.map((t, i) => [t, p.hasData?.[i] === false ? null : num(p.value?.[i])]));
        return { date: new Date(Number(p.time) * 1000).toISOString(), label: p.formattedTime ?? null, value: values[terms[0]], values, isPartial: p.isPartial === true };
    });
    // Google sends averages only for comparisons; for one term it is the mean of the complete points.
    const averages = Object.fromEntries(terms.map((t, i) => {
        const given = num(data.default?.averages?.[i]);
        if (given !== null) return [t, given];
        const vals = points.filter((p) => !p.isPartial && p.values[t] !== null).map((p) => p.values[t]);
        return [t, vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null];
    }));
    return { points, averages };
}

/** Summary numbers for the first term: peak, latest complete value, and the change over the range. */
export function summarize(points) {
    const complete = points.filter((p) => !p.isPartial && p.value !== null);
    if (!complete.length) return { peakDate: null, peakValue: null, latestValue: null, changePercent: null };
    const peak = complete.reduce((a, b) => (b.value > a.value ? b : a));
    // Change between the average of the first and the last quarter of the range, which a single noisy point
    // cannot swing the way first-vs-last would.
    const q = Math.max(1, Math.floor(complete.length / 4));
    const avg = (xs) => xs.reduce((s, p) => s + p.value, 0) / xs.length;
    const first = avg(complete.slice(0, q));
    const last = avg(complete.slice(-q));
    return {
        peakDate: peak.date,
        peakValue: peak.value,
        latestValue: complete.at(-1).value,
        changePercent: first > 0 ? Math.round(((last - first) / first) * 1000) / 10 : null,
    };
}

/** Interest by region, highest first, regions without data left out. */
export function parseRegions(data, terms) {
    return (data.default?.geoMapData ?? [])
        .filter((r) => (r.hasData ?? []).some(Boolean))
        .map((r) => {
            const values = Object.fromEntries(terms.map((t, i) => [t, r.hasData?.[i] === false ? null : num(r.value?.[i])]));
            return { geoCode: r.geoCode ?? r.coordinates ?? null, geoName: r.geoName ?? null, value: values[terms[0]], values };
        })
        .sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
}

/**
 * Related queries for one term as flat rows. Top queries are scored 0-100 against the most searched one; rising
 * queries carry the growth in percent, and "Breakout" (over 5000%) is kept as formattedValue.
 */
export function parseRelated(data, term) {
    const [top, rising] = data.default?.rankedList ?? [];
    const rows = [];
    for (const [kind, list] of [['top', top], ['rising', rising]]) {
        for (const k of list?.rankedKeyword ?? []) {
            rows.push({ term, kind, query: k.query ?? k.topic?.title ?? null, value: num(k.value), formattedValue: k.formattedValue ?? null, link: k.link ? `${TRENDS}${k.link}` : null });
        }
    }
    return rows;
}

/** Google's daily "Trending now" RSS for one country. */
export function parseTrendingRss(xml, geo) {
    const items = [];
    for (const m of String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
        const body = m[1];
        const tag = (name, src = body) => decodeXml(src.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`))?.[1]?.trim() ?? '') || null;
        const traffic = tag('ht:approx_traffic');
        const news = [...body.matchAll(/<ht:news_item>([\s\S]*?)<\/ht:news_item>/g)].map((n) => ({
            title: tag('ht:news_item_title', n[1]),
            url: tag('ht:news_item_url', n[1]),
            source: tag('ht:news_item_source', n[1]),
            picture: tag('ht:news_item_picture', n[1]),
        }));
        const pub = tag('pubDate');
        items.push({
            ok: true,
            type: 'trending',
            geo,
            title: tag('title'),
            approxTraffic: traffic,
            approxTrafficMin: trafficNumber(traffic),
            publishedAt: pub && !Number.isNaN(Date.parse(pub)) ? new Date(pub).toISOString() : null,
            picture: tag('ht:picture'),
            pictureSource: tag('ht:picture_source'),
            news,
        });
    }
    return items;
}

/** "2000+" is 2000, "10K+" is 10000, "1M+" is 1000000. */
export function trafficNumber(text) {
    const m = String(text ?? '').replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*([KkMm])?/);
    if (!m) return null;
    return Math.round(Number(m[1]) * ({ k: 1e3, m: 1e6 }[m[2]?.toLowerCase()] ?? 1));
}

function decodeXml(s) {
    return s.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
}

function num(v) {
    const n = Number(v);
    return v === null || v === undefined || v === '' || !Number.isFinite(n) ? null : n;
}
