# Zillow House Scorer

A Chrome extension that scores Zillow listings against a downsizing checklist and shows a ranked report.
It runs in your own logged-in Chrome browser, because Zillow blocks automated access from servers.

## Criteria

**Must-haves.** A house that clearly fails one is listed under "Ruled out". If the listing doesn't say, the house is marked "Check".

- Price $250,000–$360,000
- Exactly 3 bedrooms, at least 2 full bathrooms (3/2.5 is OK, 4/2 is not)
- 1,600–2,000 sq ft, or up to 2,350 sq ft if there is an upstairs room
- Garage for at least 2 cars

**Wants (scored, max 145).** "?" means the listing doesn't say and scores 0.

| Feature | Yes | Partly | ? | No |
|---|---|---|---|---|
| Screened porch on back | +30 | +15 | 0 | −30 |
| Fenced backyard | +25 | +10 | 0 | −25 |
| Patio for grilling | +20 | +10 (deck only) | 0 | −20 |
| Shed / workshop | +15 | – | 0 | 0 |
| Sprinkler system | +10 | – | 0 | 0 |
| Well (water or irrigation) | +5 | – | 0 | 0 (city water) |
| Dock | +10 | +5 (shared dock) | 0 | – |
| Boat slip | +10 | – | 0 | – |
| HOA | 0 (fee shown) | – | 0 | 0 (no HOA) |
| Pool at the house | +10 | – | 0 | – |
| Community pool | +5 | – | 0 | – |
| Clubhouse | +5 | – | 0 | – |

These are the defaults (`DEFAULT_CONFIG` in `extension/scorer.js`). On the **Filters** page (`extension/filters.html`) you can change any value,
turn individual criteria on or off, and save them as named presets (e.g. "Outside", "Inside"). Saved listing facts are re-scored with the
filter in use, so changing a filter updates the report without rescanning Zillow.

## Towns

The report keeps one list of every house scored, from every search. Each house's town comes from its address (`townOf` in `scorer.js`).
The **Town** menu on the report shows one town at a time, and **Group by town** splits "All towns" into a section per town.
The menu always lists Manning, Santee, Sumter, Dalzell, Conway, Longs, Loris and Little River (`TOWNS` in `report.js`), plus any other town that has scored houses.

## Report marks

Each report row has **KEEP** / **NO** buttons and a notes box. NO moves the house to a "Manually Excluded" section at the bottom.
Marks and notes are stored separately from scores (`marks` in `chrome.storage.local`), so they survive rescans and "Clear all results".

## Backups and moving between PCs

**Save backup** on the report writes `scores`, `marks`, `filterSets`, `activeFilter` and `filterTimes` to a JSON file (`HouseFilters.backupData`).
**Load backup** merges a file in (`HouseFilters.mergeBackup`): for each house the newer `scoredAt` wins, for marks the newer `updatedAt`,
for filters the newer save time (`filterTimes`). Nothing is deleted, and cleared marks are kept with a time so an older backup can't bring them back.

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
- `extension/results.html` / `results.js`: the report page, with KEEP / NO and notes
- `extension/filters.html` / `filters.js`: the filter editor
- `extension/filters-store.js`: saved filter presets

## Offline testing

`python3 tools/make_fixtures.py` writes made-up listings (several towns, the new features) into `samples/` along with the test certificate.
To test with real pages instead, save listing pages from Chrome as "Webpage, Single File" (`.mhtml`) into `samples/` (git-ignored), then:

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
