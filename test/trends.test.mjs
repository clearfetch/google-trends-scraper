/**
 * Offline tests for src/trends.js against real Google Trends responses captured on 2026-09-29.
 * Run: node test/trends.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    exploreUrl, parseGeo, parseKeywordLine, parseRegions, parseRelated, parseTimeRange, parseTimeline, parseTrendingRss, parseTrendsJson,
    pickWidgets, summarize, trafficNumber, webUrl, widgetUrl,
} from '../src/trends.js';

const F = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

// --- inputs ---------------------------------------------------------------------------------------------------
assert.deepEqual(parseKeywordLine('coffee'), { terms: ['coffee'] });
assert.deepEqual(parseKeywordLine('  chatgpt  vs gemini VS. claude '), { terms: ['chatgpt', 'gemini', 'claude'] });
assert.deepEqual(parseKeywordLine('salt, pepper'), { terms: ['salt, pepper'] }, 'a comma stays inside a term');
assert.match(parseKeywordLine('a vs b vs c vs d vs e vs f').error, /at most 5/);
assert.match(parseKeywordLine('   ').error, /empty/);
assert.deepEqual(parseTimeRange(undefined), { time: 'today 12-m' });
assert.deepEqual(parseTimeRange('now 7-d'), { time: 'now 7-d' });
assert.match(parseTimeRange('last week').error, /unknown timeRange/);
assert.deepEqual(parseTimeRange('today 12-m', '2025-01-01 2025-06-30'), { time: '2025-01-01 2025-06-30' }, 'custom range wins');
assert.match(parseTimeRange('', '2025-06-30 2025-01-01').error, /start before/);
assert.match(parseTimeRange('', '2001-01-01 2002-01-01').error, /2004/);
assert.match(parseTimeRange('', 'last year').error, /must look like/);
assert.deepEqual(parseGeo('us'), { geo: 'US' });
assert.deepEqual(parseGeo('US-CA'), { geo: 'US-CA' });
assert.deepEqual(parseGeo(''), { geo: '' });
assert.match(parseGeo('United States').error, /not a country code/);

// --- URLs -----------------------------------------------------------------------------------------------------
const q = { terms: ['chatgpt', 'gemini'], geo: 'US', time: 'today 3-m', category: 0, property: '', hl: 'en-US', tz: 0 };
const ex = new URL(exploreUrl(q));
assert.equal(ex.pathname, '/trends/api/explore');
assert.deepEqual(JSON.parse(ex.searchParams.get('req')), { comparisonItem: [{ keyword: 'chatgpt', geo: 'US', time: 'today 3-m' }, { keyword: 'gemini', geo: 'US', time: 'today 3-m' }], category: 0, property: '' });
assert.equal(webUrl(q), 'https://trends.google.com/trends/explore?q=chatgpt%2Cgemini&date=today+3-m&geo=US&hl=en-US');

// --- explore and widgets --------------------------------------------------------------------------------------
assert.throws(() => parseTrendsJson('<html>429 Too Many Requests</html>'), /not a Google Trends response/);
const single = pickWidgets(parseTrendsJson(F('explore-single.txt')), 1);
assert.ok(single.timeline && single.regions && single.related.length === 1 && single.related[0]);
const w = new URL(widgetUrl(single.timeline, { hl: 'en-US', tz: 0 }));
assert.equal(w.pathname, '/trends/api/widgetdata/multiline');
assert.ok(w.searchParams.get('token') && JSON.parse(w.searchParams.get('req')).comparisonItem);
assert.equal(new URL(widgetUrl(single.regions, { hl: 'en-US', tz: 0 })).pathname, '/trends/api/widgetdata/comparedgeo');
const compare = pickWidgets(parseTrendsJson(F('explore-compare.txt')), 2);
assert.equal(compare.related.length, 2, 'one related-queries widget per compared term');
assert.ok(compare.related.every(Boolean));
assert.equal(compare.regions.id, 'GEO_MAP', 'the combined map, not the per-term ones');

// --- timeline -------------------------------------------------------------------------------------------------
const t1 = parseTimeline(parseTrendsJson(F('multiline-single.txt')), ['coffee']);
assert.equal(t1.points.length, 53);
assert.equal(t1.points[0].date, '2025-09-28T00:00:00.000Z');
assert.equal(t1.points.at(-1).isPartial, true, 'the running week is partial');
assert.ok(Number.isInteger(t1.averages.coffee), 'single-term average computed when Google sends none');
const t2 = parseTimeline(parseTrendsJson(F('multiline-compare.txt')), ['chatgpt', 'gemini']);
assert.deepEqual(t2.averages, { chatgpt: 64, gemini: 25 });
assert.deepEqual(t2.points[0].values, { chatgpt: 68, gemini: 25 });
assert.equal(t2.points[0].value, 68, 'value is the first term');
const s = summarize(t2.points);
assert.equal(s.peakValue, 100);
assert.ok(s.peakDate && s.latestValue !== null && typeof s.changePercent === 'number');
assert.deepEqual(summarize([]), { peakDate: null, peakValue: null, latestValue: null, changePercent: null });
assert.equal(summarize([{ date: 'a', value: 50, isPartial: false }, { date: 'b', value: 99, isPartial: true }]).latestValue, 50, 'partial points are not the latest value');

// --- regions --------------------------------------------------------------------------------------------------
const r1 = parseRegions(parseTrendsJson(F('geo-single.txt')), ['coffee']);
assert.ok(r1.length > 40 && r1.every((r) => /^[A-Z]{2}$/.test(r.geoCode)), 'worldwide map is by country, countries without data left out');
assert.equal(r1[0].value, 100);
assert.ok(r1.every((r, i) => i === 0 || (r1[i - 1].value ?? -1) >= (r.value ?? -1)), 'highest first');
const r2 = parseRegions(parseTrendsJson(F('geo-compare.txt')), ['chatgpt', 'gemini']);
assert.equal(r2.length, 51, 'US map is by state');
assert.ok(r2[0].geoCode.startsWith('US-') && typeof r2[0].values.gemini === 'number');

// --- related queries ------------------------------------------------------------------------------------------
const rq = parseRelated(parseTrendsJson(F('related-single.txt')), 'coffee');
assert.equal(rq.filter((r) => r.kind === 'top').length, 25);
assert.equal(rq.filter((r) => r.kind === 'rising').length, 25);
assert.deepEqual(Object.keys(rq[0]).sort(), ['formattedValue', 'kind', 'link', 'query', 'term', 'value']);
assert.ok(rq[0].link.startsWith('https://trends.google.com/trends/explore?q='));
assert.ok(rq.some((r) => r.kind === 'rising' && r.formattedValue === 'Breakout'), 'breakout kept as formattedValue');
assert.deepEqual(parseRelated({ default: { rankedList: [] } }, 'x'), [], 'empty lists are fine');
assert.ok(parseRelated(parseTrendsJson(F('related-compare-1.txt')), 'gemini').every((r) => r.term === 'gemini'));

// --- trending now ---------------------------------------------------------------------------------------------
const tr = parseTrendingRss(F('trending-us.xml'), 'US');
assert.ok(tr.length >= 5);
assert.equal(tr[0].title, 'wnba playoffs');
assert.equal(tr[0].approxTraffic, '2000+');
assert.equal(tr[0].approxTrafficMin, 2000);
assert.equal(tr[0].publishedAt, '2026-09-29T12:10:00.000Z');
assert.deepEqual(tr[0].news, []);
const withNews = parseTrendingRss(`<rss><channel><item><title>A &amp; B</title><ht:approx_traffic>10K+</ht:approx_traffic>
  <ht:news_item><ht:news_item_title>Head &quot;line&quot;</ht:news_item_title><ht:news_item_url>https://x.test/a</ht:news_item_url><ht:news_item_source>X</ht:news_item_source></ht:news_item>
  </item></channel></rss>`, 'GB');
assert.deepEqual([withNews[0].title, withNews[0].approxTrafficMin, withNews[0].news[0].title, withNews[0].news[0].url], ['A & B', 10000, 'Head "line"', 'https://x.test/a']);

assert.deepEqual(['2000+', '10K+', '1.5M+', '200,000+', '', null].map(trafficNumber), [2000, 10000, 1500000, 200000, null, null]);

console.log('ALL TRENDS TESTS PASSED');
