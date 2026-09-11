# Arcanum — GitHub Native Android Build

This version converts the stock-update functionality of the two supplied Chrome extensions into a **standalone native Android app**.

## What is included

Features combined from both extensions:

- Results / quarterly results feed
- Corporate actions: dividends, bonus, splits, buybacks, record/ex-date
- NSE filings / announcements
- Indian stock news
- Search by symbol, company or headline
- Watchlist with add/remove
- Live/near-live market prices
- NIFTY 50, BANK NIFTY and SENSEX market cards
- Stock prices on result/action/news cards when a symbol is available
- Yahoo Finance fallback for prices
- NSE public feeds attempted first for filings/actions/results
- Google News RSS used for broad news coverage
- Direct external opening of source pages
- Local watchlist saved on the phone
- No Expo
- No Expo Go
- No EAS
- No server required for the app UI

## Important data note

The app retrieves data over the internet. NSE endpoints can throttle or block automated requests. The app therefore treats NSE as the preferred source for corporate data and uses Google News/Yahoo Finance fallbacks where appropriate.

This is **not a licensed real-time exchange-data terminal**. Prices may be delayed depending on the source.

---

# Easiest way to build the APK with GitHub

You do NOT need Android Studio.

## Step 1 — Create a GitHub account

Open GitHub:

https://github.com/

Create an account or sign in.

## Step 2 — Create a new repository

After signing in:

1. Click the `+` button at the top-right.
2. Choose **New repository**.
3. Repository name:

`arcanum-android`

4. Choose **Private** if you don't want the source public.
5. Do NOT add README, .gitignore or license (this project already contains them).
6. Click **Create repository**.

## Step 3 — Upload this project

Extract the downloaded ZIP on your computer.

Open the extracted folder:

`Arcanum-GitHub-Native`

Select everything inside it.

On your new GitHub repository:

1. Click **uploading an existing file**.
2. Drag all files/folders into the page.
3. Make sure `.github/workflows/build-apk.yml` is included.
4. Scroll down.
5. Click **Commit changes**.

The repository root should look approximately like:

    Arcanum-GitHub-Native
    ├── .github
    │   └── workflows
    │       └── build-apk.yml
    ├── app
    │   ├── build.gradle
    │   └── src
    ├── build.gradle
    ├── gradle.properties
    ├── settings.gradle
    └── README.md

GitHub itself should show `app`, `.github`, `build.gradle`, etc. at the repository root — do not put the whole project inside another extra folder.

## Step 4 — Start the build

Open your repository.

Click:

**Actions**

You should see:

**Build Arcanum APK**

If the workflow did not automatically run after the upload:

1. Click **Build Arcanum APK**.
2. Click **Run workflow**.
3. Select `main`.
4. Click **Run workflow**.

## Step 5 — Wait for GitHub to finish

Click the running workflow.

You will see:

- Checkout
- Set up Java
- Set up Gradle
- Build debug APK
- Upload APK

Wait until every step has a green check.

Usually the build takes a few minutes.

## Step 6 — Download the APK

When the workflow is complete:

1. Open the completed workflow run.
2. Scroll to the bottom.
3. Find **Artifacts**.
4. Click:

`Arcanum-debug-apk`

GitHub downloads a ZIP.

Extract that ZIP.

Inside it you will find:

`app-debug.apk`

## Step 7 — Put APK on your Android phone

The easiest method is Google Drive, WhatsApp to yourself, USB cable, or email.

For example:

1. Upload `app-debug.apk` to Google Drive.
2. Open Google Drive on your phone.
3. Download `app-debug.apk`.
4. Tap the file.

## Step 8 — Allow installation

Android may say that installation from this source is not allowed.

Tap **Settings** and enable **Allow from this source** for the app you used to download the APK (for example Chrome or Files).

Go back and tap the APK again.

Tap:

**Install**

Then:

**Open**

You now have Arcanum installed as a normal Android app.

---

# Important: you do not need Expo

After installation, the phone does NOT need:

- Expo
- Expo Go
- EAS
- Node.js
- GitHub
- your computer

The installed APK is a standalone Android application.

The only thing it needs is **internet access** when it retrieves fresh market/news data.

---

# Updating the app later

When the source code changes:

1. Upload/commit the updated project to GitHub.
2. Open **Actions**.
3. Run **Build Arcanum APK**.
4. Download the new APK.
5. Install it.

### Signing note

This workflow intentionally produces a debug APK for easy personal installation. Debug signing is convenient for testing, but a production release should use a persistent private Android signing key so future APKs install as updates instead of requiring a clean reinstall.

For a personal production build, the next improvement should be a GitHub Secrets-based release-signing workflow.

---

# If GitHub Actions is disabled

For a newly created repository:

1. Open **Settings → Actions → General**.
2. Make sure GitHub Actions is allowed.
3. Save.
4. Return to **Actions** and run the workflow.

---

# If you see a red build error

Do not change random files.

Open the failed workflow, expand the red step, and send a screenshot of the error. The exact error text is enough to diagnose the build.

---

## Architecture

The app is a native Android WebView shell around a bundled local interface. Network requests are performed by the Android layer and returned to the local UI, avoiding browser CORS restrictions.

    Android APK
       |
       +-- Local Arcanum UI
       |
       +-- Native HTTPS bridge
               |
               +-- NSE
               +-- Yahoo Finance
               +-- Google News RSS
               +-- Moneycontrol / LiveMint sources as future fallbacks

No Expo runtime is involved.
