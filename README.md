# Zillow House Scorer

A Chrome extension that scores Zillow listings against a downsizing checklist and shows a ranked report.
It runs in your own logged-in Chrome browser, because Zillow blocks automated access from servers.

## Criteria

**Must-haves.** A house that clearly fails one is listed under "Ruled out". If the listing doesn't say, the house is marked "Check".

- Price $250,000–$360,000
- Exactly 3 bedrooms, at least 2 full bathrooms (3/2.5 is OK, 4/2 is not)
- 1,600–2,000 sq ft, or up to 2,350 sq ft if there is an upstairs room
- Garage for at least 2 cars

**Wants (scored, max 100).** "?" means the listing doesn't say and scores 0.

| Feature | Yes | Partly | ? | No |
|---|---|---|---|---|
| Screened porch on back | +30 | +15 | 0 | −30 |
| Fenced backyard | +25 | +10 | 0 | −25 |
| Patio for grilling | +20 | +10 (deck only) | 0 | −20 |
| Shed / workshop | +15 | – | 0 | 0 |
| Sprinkler system | +10 | – | 0 | 0 |

Criteria and points are in `CRITERIA` / `POINTS` at the top of `extension/scorer.js`.

## How it reads a listing

It reads the MLS "Facts & features" section (`Patio & porch`, `Fencing`, `Levels`/`Stories`, `Garage spaces`,
`Additional structures`, lot `Features`) and falls back to the listing description.

## Install

See `extension/HOW_TO_INSTALL.txt`. In short: open `chrome://extensions`, turn on Developer mode,
click "Load unpacked", and select the `extension` folder.

## Layout

- `extension/scorer.js`: parses page text and scores a listing (also runs in Node)
- `extension/report.js`: builds the ranked report HTML
- `extension/content.js`: the on-page House Scorer box, plus the search scan (one background tab per listing)
- `extension/background.js`: opens and closes the scan tabs and opens the report
- `extension/results.html` / `results.js`: the report page

## Offline testing

Save listing pages from Chrome as "Webpage, Single File" (`.mhtml`) into `samples/` (git-ignored), then:

```
python3 tools/extract_mhtml.py           # samples/*.mhtml -> samples/html/*.html
cd tools && npm install
npm run score-samples                     # prints scores, writes samples/sample_report.html
```

To test the full extension against the saved pages, serve them as a fake www.zillow.com:

```
openssl req -x509 -newkey rsa:2048 -nodes -keyout samples/key.pem -out samples/cert.pem -days 30 -subj "/CN=www.zillow.com"
python3 tools/mock_server.py &            # https on 127.0.0.1:8443
CHROME_PATH=/path/to/chrome-for-testing npm run e2e
```
