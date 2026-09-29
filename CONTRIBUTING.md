# Working on this Actor

```bash
npm install
node test/trends.test.mjs               # unit tests against real Google Trends responses, no network
./scripts/run-test.sh default           # a keyword, a comparison and the US trending feed, charging simulated
./scripts/run-test.sh problems          # bad lines and countries, a phrase with no search data, a duplicate
./scripts/run-test.sh batch             # ten keywords, to watch the pacing
node ../../scripts/check-dataset-schema.mjs .   # rows vs .actor/dataset_schema.json, as the platform checks them
```

`src/trends.js` builds the requests and parses Google's responses as pure functions. `src/main.js` does the
pacing, retries and charging.

## Pacing is the product

Google Trends limits requests per IP and answers HTTP 429 when they come too fast. Measured from Apify's IPs:
1.5 s apart, most data requests were refused; 8 s apart, 23 of 26 succeeded. So the Actor sends one request at a
time, starts with a 2 s gap, backs off 10-80 s and widens the gap 1.6x on each 429, fetches a fresh cookie after
two in a row, and narrows the gap 0.85x on each success. A keyword whose section is still refused after all retries
is written with `partial: true` and not charged. Do not add concurrency without measuring it from the platform.
