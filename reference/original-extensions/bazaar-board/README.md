# Bazaar Board — India Analyst Call Tracker (Chrome Extension)

## What this actually does
Pulls live headlines from **public RSS news feeds** (Moneycontrol, Business
Standard, Hindustan Times Business, Livemint Markets) and flags any headline
that mentions one of the brokerage/analyst names you're tracking (Nomura,
Goldman Sachs, Morgan Stanley, JP Morgan, HSBC, UBS, Credit Suisse, Macquarie,
ICICI Securities, Motilal Oswal, Sharekhan, Ventura Securities, Prabhudas
Lilladher, and a few more — editable in Settings).

## What this does NOT do (on purpose)
- It does **not** claim any "target hit %" or accuracy score for any firm.
  Those numbers aren't published anywhere verifiable, so the extension never
  invents them.
- It does **not** scrape Nomura/Goldman/Morgan Stanley/JP Morgan's own
  websites. Their actual research calls, target prices, and track records
  sit behind private, client-only research portals (Nomura Now, GS Marquee,
  Morgan Stanley Matrix, etc.) — there's no public page or API for that data,
  so the extension only surfaces what's already been reported in open
  financial news.
- It is not financial advice. Every card links back to the original article
  so you can read the full context before acting on anything.

## Install (unpacked, for testing)
1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this folder
5. Click the extension icon to open the board; click "Sources & firms" to
   add/remove RSS feeds or tracked firm names.

## Files
- `manifest.json` — MV3 manifest, host permissions for the news domains only
- `shared.js` — feed list, firm list, RSS fetch/parse (regex-based so it
  works in both the popup and the background service worker)
- `background.js` — refreshes every 30 min and updates the toolbar badge count
- `popup.html/js/css` — the board UI
- `options.html/js/css` — settings page to edit feeds/firms

## Extending it
If you get access to a paid data vendor (e.g. Bloomberg, Refinitiv, or a
brokerage's official client API) that legitimately licenses analyst
target-price data with accuracy stats, that's the correct source for the
"hit rate" leaderboard you originally wanted — swap it in via a new fetch
function in `shared.js`. I can't fabricate that data or scrape it from
sites that don't expose it publicly.
