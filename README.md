# Zillow House Scorer

A Chrome extension that scores Zillow listings against a downsizing checklist and shows a ranked report.
It runs in your own logged-in Chrome browser, because Zillow blocks automated access from servers.

## Criteria

**Must-haves.** A house that clearly fails one is listed under "Ruled out". If the listing doesn't say, the house is marked "Check".

- Price $250,000–$360,000
- Exactly 3 bedrooms, at least 2 full bathrooms (3/2.5 is OK, 4/2 is not)
- 1,600–2,000 sq ft, or up to 2,350 sq ft if there is an upstairs room
- Garage for at least 2 cars
- Land not leased: a listing that mentions a land lease, ground lease, lot rent or leasehold is ruled out

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
| HOA | 0 (fee shown next to it, e.g. $85/month) | – | 0 | 0 (no HOA) |
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

## Printing KEEP houses

The report's **Print KEEP houses** button opens `print.html` for the town picked in the Town menu. It lists that town's KEEP houses with tick boxes and an optional starting address. **Make my driving list** finds each address (Zillow's own coordinates when the page has them, otherwise the US Census geocoder, then OpenStreetMap, then the town as an approximate spot), caches the result in `geo[zpid]`, and orders the stops with nearest-neighbor plus 2-opt on straight-line distance (`route.js`). The printable sheet has one card per stop, Google Maps direction links (10 points per link), and can be printed, saved as PDF from the print dialog, or saved as a standalone HTML file.

## Google Drive copy

The report keeps today's KEEP driving list in Google Drive as a PDF named `KEEP houses - All towns - YYYY-MM-DD.pdf` (the date in Eastern time), so a program can read it each morning.

- It has the same content as the printed "All towns" list: every KEEP house still for sale, in driving order from 2911 Waverly Rd, Sumter, SC, with price, beds/baths, sq ft, year built, score, what it has and is missing, and your saved note. The text is real, selectable text.
- About 60 seconds after the last change to the report's data (a KEEP / NO mark, a scored house, a saved note, Clear all results, a filter change) the background worker uploads it once. Unsaved note drafts are never uploaded.
- If today's file is already in Drive it is updated, never copied. A new day gets a new file.
- **Save to Drive now** on the report saves right away (and signs you in to Google the first time). The line next to it says when it last saved, "Saving…", "Not saved yet", or why the last try failed. A failed save stays queued and runs again after your next change and when Chrome starts. Scoring and notes keep working offline.
- **Disconnect Drive** signs the extension out of Google Drive and stops automatic saves until you click **Save to Drive now** again. Files already in Drive stay there.
- The extension uses the `drive.file` permission only: it can see and change only the files it made, nothing else in your Drive. The files go in the top level of My Drive.

## SETUP: connect Google Drive (one time)

Google needs to know about the extension before it can save to your Drive. Do this once, in Chrome on your PC, signed in to the Google account whose Drive should get the file.

1. Open `chrome://extensions`, find House Scorer and copy its **ID** (32 letters, e.g. `abcdefghijklmnopabcdefghijklmnop`). Keep the extension loaded from the same folder: Chrome bases the ID on the folder, and a different ID would need a new client ID.
2. Go to https://console.cloud.google.com/ and sign in. At the top, click the project picker, then **New project**. Name it `House Scorer` and click **Create**. Make sure it is selected in the project picker.
3. Go to https://console.cloud.google.com/apis/library/drive.googleapis.com and click **Enable**.
4. Go to https://console.cloud.google.com/auth/overview (Google Auth Platform) and click **Get started**. App name `House Scorer`, support email = your email, **Next**. Audience: **External**, **Next**. Contact email = your email, **Next**. Agree, **Continue**, **Create**.
5. In the left menu click **Audience**. Under **Test users** click **Add users**, add your own Gmail address, and **Save**. (Optional: click **Publish app** there instead. Then Google doesn't ask you to sign in again every 7 days. If Google shows an "unverified app" warning when you sign in, click **Advanced**, then **Go to House Scorer**.)
6. In the left menu click **Data Access**, **Add or remove scopes**, tick `.../auth/drive.file` (Google Drive API, "See, edit, create, and delete only the specific Google Drive files you use with this app"), **Update**, **Save**.
7. In the left menu click **Clients**, then **Create client**. Application type: **Chrome extension**. Name: `House Scorer`. Item ID: paste the extension ID from step 1. Click **Create**.
8. Copy the **Client ID** shown (it ends in `.apps.googleusercontent.com`). You don't need the client secret, if one is shown.
9. Open `manifest.json` in the extension folder Chrome loads from (the "Loaded from" folder) with Notepad. Find this line:
   `"client_id": "PASTE_YOUR_CLIENT_ID_HERE.apps.googleusercontent.com",`
   Replace everything between the quotes with your Client ID, so it reads like `"client_id": "1234567890-abc123.apps.googleusercontent.com",`. Keep the quotes and the comma. Save.
10. In `chrome://extensions` click **Reload** on House Scorer (not Remove: that deletes your saved houses).
11. Open the report and click **Save to Drive now**. Pick your Google account and click **Allow**. The status line should say "Saved … as KEEP houses - All towns - YYYY-MM-DD.pdf", and the file appears in My Drive.

When you install a later update, copy your Client ID into the new `manifest.json` again (step 9) before clicking Reload.

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
- `extension/content.js`: the on-page ZillowMonster Score box (house facts header, then score; unstated or 0-point wants are hidden), plus the search scan (one background tab per listing)
- `extension/background.js`: opens and closes the scan tabs, opens the report, and runs the Google Drive copy
- `extension/keeplist.js`: the KEEP driving list (map lookups, stop order, text), shared by the print page and the Drive copy
- `extension/pdf.js`: writes the Drive copy as a text PDF
- `extension/drive.js`: Google sign-in, the 60-second wait, and creating or updating today's Drive file
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

The Google Drive copy is tested with Chrome and the Drive API faked (the wait, create vs update, failures and retries, and the PDF text):

```
cd tools && npm run drive-test
```
