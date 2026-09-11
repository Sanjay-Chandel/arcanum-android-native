# Features carried into Arcanum

## Bazaar Board
- Results
- Corporate actions
- Filings
- News
- Search/filter
- Watchlist
- Live price lookup
- NSE-first data strategy
- Google News RSS fallback
- Market ticker concept

## Indian Stock Updates
- NSE corporate results
- NSE corporate actions
- NSE announcements/filings
- Dividend / bonus / split / buyback / record-date classification
- Google News RSS feeds
- Yahoo Finance quote fallback
- NSE request headers/session warm-up strategy

## Native Android adaptation
Chrome APIs such as `chrome.storage`, service workers and popup windows are replaced with:
- Android local storage via WebView localStorage
- Native Android HTTPS bridge
- Native external URL intents
- GitHub Actions + Gradle for APK builds
