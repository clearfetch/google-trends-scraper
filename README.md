# Google Trends Scraper - Interest, Regions, Related & Trending

Get Google Trends data for any list of keywords without a browser: interest over time, interest by country or
state, and top and rising related queries, for single keywords or comparisons of up to five terms
("chatgpt vs gemini"). It also returns what is trending in Google Search right now in any country. **$3 per 1,000
keywords, $0.50 per 1,000 trending searches.** No login, no proxy.

## What data you get

**One row per keyword or comparison:**

- `interestOverTime`: every point in the range with `date`, `label`, `value` (0-100) and `values` per compared term,
  `isPartial` for the period still running
- `averages` per term, and for the first term: `peakValue`, `peakDate`, `latestValue`, `changePercent` (last quarter
  of the range against the first)
- `interestByRegion`: countries worldwide, or states and regions within a country, highest first, with values per term
- `relatedQueries`: top queries (scored 0-100) and rising queries (growth in percent, or "Breakout"), per term,
  each with a link to its own Trends page
- `keyword`, `terms`, `geo`, `timeRange`, `category`, `property`, and `url`, the same query on trends.google.com

**One row per trending search** (with **Trending now: countries**): `title`, `rank`, `approxTraffic` ("2000+") and
`approxTrafficMin` (2000), `publishedAt`, picture and linked `news` articles when Google has them.

## How to use

1. Add keywords, one per line. Put up to five terms on one line with `vs` to compare them.
2. Pick the country (or leave it empty for worldwide) and the time range; optionally a category or YouTube, News,
   Images or Shopping search. Add country codes under **Trending now** for today's trending searches.
3. Run it, then download JSON, CSV or Excel, or pull the rows through the API.

## Input

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `keywords` | array | — | One keyword per line; `a vs b vs c` compares up to 5. Also `searchTerms`, `keyword`. |
| `geo` | string | worldwide | Country (`US`) or region (`US-CA`) code. |
| `timeRange` | string | `today 12-m` | `now 1-H`, `now 4-H`, `now 1-d`, `now 7-d`, `today 1-m`, `today 3-m`, `today 12-m`, `today 5-y`, `all`. |
| `customTimeRange` | string | — | `2025-01-01 2025-06-30`; overrides `timeRange`. |
| `category` | integer | `0` | Google Trends category id (0 = all). |
| `property` | string | web | `images`, `news`, `froogle` (Shopping) or `youtube`. |
| `includeRegions` | boolean | `true` | Interest by region. |
| `includeRelatedQueries` | boolean | `true` | Top and rising related queries. |
| `trendingNowGeos` | array | `[]` | Country codes for today's trending searches. |
| `language` | string | `en-US` | Language for query and region names. |
| `maxItems` | integer | `0` | Stop after this many charged rows (0 = no limit). |
| `minDelaySecs` | integer | `2` | Minimum wait between requests; the Actor slows down further on its own when Google pushes back. |
| `timeoutSecs` | integer | `30` | Per request. |
| `proxyConfiguration` | object | off | Not needed; your own proxies can speed up very large runs. |

## Output example

Real rows from a run on 2026-09-29 (arrays shortened here to their first items):

```json
{
    "ok": true,
    "type": "keyword",
    "keyword": "coffee",
    "terms": ["coffee"],
    "geo": "US",
    "timeRange": "today 3-m",
    "category": 0,
    "property": "web",
    "url": "https://trends.google.com/trends/explore?q=coffee&date=today+3-m&geo=US&hl=en-US",
    "interestOverTime": [
        { "date": "2026-06-29T00:00:00.000Z", "label": "Jun 29, 2026", "value": 53, "values": { "coffee": 53 }, "isPartial": false },
        { "date": "2026-06-30T00:00:00.000Z", "label": "Jun 30, 2026", "value": 50, "values": { "coffee": 50 }, "isPartial": false }
    ],
    "averages": { "coffee": 56 },
    "peakDate": "2026-07-19T00:00:00.000Z",
    "peakValue": 100,
    "latestValue": 49,
    "changePercent": -9.7,
    "interestByRegion": [
        { "geoCode": "US-KS", "geoName": "Kansas", "value": 100, "values": { "coffee": 100 } },
        { "geoCode": "US-HI", "geoName": "Hawaii", "value": 99, "values": { "coffee": 99 } }
    ],
    "relatedQueries": [
        { "term": "coffee", "kind": "top", "query": "coffee near me", "value": 100, "formattedValue": "100", "link": "https://trends.google.com/trends/explore?q=coffee+near+me&date=today+3-m&geo=US" },
        { "term": "coffee", "kind": "rising", "query": "top songs this week", "value": 21750, "formattedValue": "Breakout", "link": "https://trends.google.com/trends/explore?q=top+songs+this+week&date=today+3-m&geo=US" }
    ],
    "missingSections": [],
    "scrapedAt": "2026-09-29T12:38:22.632Z",
    "partial": false
}
```

```json
{
    "ok": true,
    "type": "trending",
    "geo": "US",
    "title": "taylor sheridan",
    "approxTraffic": "2000+",
    "approxTrafficMin": 2000,
    "publishedAt": "2026-09-29T12:20:00.000Z",
    "picture": null,
    "pictureSource": null,
    "news": [],
    "rank": 1,
    "scrapedAt": "2026-09-29T12:38:11.470Z"
}
```

A line that cannot be answered comes back as one row with `ok: false` and a plain reason, such as `Google Trends has
too little search data for this query in this region and time range`. Those rows are free.

## Pricing

- **$0.003 per keyword or comparison**, which is $3 per 1,000, with every section you asked for.
- **$0.0005 per trending search**, $0.50 per 1,000 (a country's feed is usually 10-20 of them).
- Lines that fail, keywords without enough search data, and rows where Google withheld a section after all retries
  (`partial: true`) are never charged.

Paid Apify plans pay less: 10% off on Bronze, 20% on Silver and 30% on Gold and higher tiers.

Apify also charges a run-start fee of $0.00005 per started GB of allocated memory (minimum one event), including runs that produce no chargeable results.

## Use cases

- **SEO and content planning**: which topics are rising, which related queries are breaking out, where interest is
  strongest.
- **Product and market research**: compare brands, products or categories over five years, by country or state.
- **E-commerce and seasonality**: when demand for a product peaks, in Shopping search specifically.
- **Newsrooms and social teams**: today's trending searches by country on a schedule.
- **Data science**: clean time series for models and dashboards, one run for hundreds of keywords.

## FAQ

**Why does a large run take a while?** Google Trends limits how often one IP may ask, and answers too-fast requests
with HTTP 429. Instead of failing those keywords, the Actor paces itself: it starts at one request every two seconds,
waits and slows down when Google pushes back, and speeds up again when it can. Each keyword takes four or more
requests. A run that finishes a little later with complete data beats one that returns errors.

**Are the numbers search volumes?** No. Google Trends reports relative interest from 0 to 100, where 100 is the
peak within the query's own range and region. In a comparison, all terms share one scale, so they can be compared
directly.

**Does it need a proxy?** No. Your own proxies can speed up very large runs, since Google's limit is per IP.

**Why is a row marked partial?** Google occasionally keeps refusing one section even after several retries. The
row is written with what did arrive, lists the missing section in `missingSections`, and is not charged.

**Is it legal?** It reads the same public, aggregated and anonymous data that anyone sees on trends.google.com. You
are responsible for how you use it.

## Integrations

Run it from the Apify API or a client library, schedule it in Apify Console, or connect it to n8n, Make, Zapier or
any MCP client through Apify's integrations. Results are available as JSON, CSV, Excel and through the dataset API.

## More tools from clearfetch

- [TikTok Scraper](https://apify.com/clearfetch/tiktok-scraper): hashtags, profiles, sounds and video stats in one Actor
- [Website Sitemap Extractor](https://apify.com/clearfetch/website-sitemap-extractor): every URL of a website from its sitemaps, from just the domain
- [ATS Jobs Scraper](https://apify.com/clearfetch/ats-jobs-scraper): every open job from company careers pages on Greenhouse, Lever, Ashby, Workday and more

## Changelog

- **1.0.0** (2026-09) — first release: interest over time, by region and related queries for keywords and
  comparisons of up to five terms, trending searches by country, self-pacing against Google's rate limit.
