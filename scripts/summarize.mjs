/** Prints what a local run produced: one line per row and the charges. */
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const dir = 'storage/datasets/default';
const rows = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'))) : [];
for (const r of rows) {
    if (!r.ok) console.log(`  ERROR    ${String(r.input).padEnd(30)} ${r.error}`);
    else if (r.type === 'trending') console.log(`  trending ${r.geo} #${String(r.rank).padEnd(3)} ${String(r.title).slice(0, 40).padEnd(40)} ${r.approxTraffic ?? ''} ${r.publishedAt ?? ''} news ${r.news.length}`);
    else console.log(`  keyword  ${r.keyword.padEnd(30)} ${r.geo} ${r.timeRange}: points ${r.interestOverTime.length}, avg ${JSON.stringify(r.averages)}, peak ${r.peakValue} ${String(r.peakDate).slice(0, 10)}, change ${r.changePercent}%, regions ${r.interestByRegion.length} (top ${r.interestByRegion[0]?.geoName}), related ${r.relatedQueries.length} (${r.relatedQueries.filter((q) => q.kind === 'rising').length} rising)${r.partial ? `  PARTIAL missing ${r.missingSections.join(',')}` : ''}`);
}
console.log(`rows ${rows.length}: ok ${rows.filter((r) => r.ok).length}, errors ${rows.filter((r) => !r.ok).length}, partial ${rows.filter((r) => r.partial).length}`);
const logDir = 'storage/datasets/charging_log';
if (existsSync(logDir)) {
    const counts = {};
    for (const f of readdirSync(logDir).filter((x) => x.endsWith('.json'))) {
        const e = JSON.parse(readFileSync(`${logDir}/${f}`, 'utf8'));
        counts[e.eventName] = (counts[e.eventName] ?? 0) + (e.count ?? 1);
    }
    console.log('charged   :', Object.values(counts).reduce((a, b) => a + b, 0), counts);
}
