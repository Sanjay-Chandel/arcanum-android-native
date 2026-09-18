package com.arcanum;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {

    private WebView webView;

    private final ExecutorService executor =
            Executors.newCachedThreadPool();

    private static final String DESKTOP_UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

    private volatile String nseCookie = null;
    private volatile long nseCookieAt = 0;

    private volatile String yahooCookie = null;
    private volatile String yahooCrumb = null;
    private volatile long yahooAuthAt = 0;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);

        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setAllowFileAccess(true);
        webView.getSettings().setAllowContentAccess(true);

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient());

        CookieManager.getInstance().setAcceptCookie(true);

        webView.addJavascriptInterface(new NativeBridge(), "Android");

        setContentView(webView);

        webView.loadUrl("file:///android_asset/index.html");
    }

    private boolean allowed(String u) {
        try {
            URL url = new URL(u);
            String host = url.getHost().toLowerCase();

            return host.equals("nseindia.com")
                    || host.endsWith(".nseindia.com")
                    || host.equals("yahoo.com")
                    || host.endsWith(".yahoo.com")
                    || host.equals("google.com")
                    || host.endsWith(".google.com")
                    || host.equals("googleusercontent.com")
                    || host.endsWith(".googleusercontent.com")
                    /* Supplementary market-news sources for the merged
                       feeds and the Firms (analyst-call) tab. */
                    || host.equals("moneycontrol.com")
                    || host.endsWith(".moneycontrol.com")
                    || host.equals("livemint.com")
                    || host.endsWith(".livemint.com")
                    || host.equals("business-standard.com")
                    || host.endsWith(".business-standard.com")
                    || host.equals("hindustantimes.com")
                    || host.endsWith(".hindustantimes.com");
        } catch (Exception e) {
            return false;
        }
    }

    private void sendResult(String id, String payload, boolean ok) {
        runOnUiThread(() -> {
            if (webView == null) return;
            String js = "window.nativeResult("
                    + JSONObject.quote(id) + ","
                    + JSONObject.quote(payload == null ? "" : payload) + ","
                    + ok + ")";
            webView.evaluateJavascript(js, null);
        });
    }

    private String collectCookies(HttpURLConnection connection) {
        StringBuilder sb = new StringBuilder();
        Map<String, List<String>> headers = connection.getHeaderFields();
        for (Map.Entry<String, List<String>> e : headers.entrySet()) {
            if (e.getKey() != null && e.getKey().equalsIgnoreCase("Set-Cookie")) {
                for (String raw : e.getValue()) {
                    String pair = raw.split(";", 2)[0].trim();
                    if (!pair.isEmpty()) {
                        if (sb.length() > 0) sb.append("; ");
                        sb.append(pair);
                    }
                }
            }
        }
        return sb.toString();
    }

    private synchronized void ensureNseSession() throws Exception {
        if (nseCookie != null && (System.currentTimeMillis() - nseCookieAt) < 4 * 60 * 1000) {
            return;
        }
        HttpURLConnection c = (HttpURLConnection)
                new URL("https://www.nseindia.com/").openConnection();
        c.setRequestMethod("GET");
        c.setConnectTimeout(10000);
        c.setReadTimeout(10000);
        c.setInstanceFollowRedirects(true);
        c.setRequestProperty("User-Agent", DESKTOP_UA);
        c.setRequestProperty("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
        c.setRequestProperty("Accept-Language", "en-IN,en;q=0.9");
        c.getResponseCode();
        String cookie = collectCookies(c);
        c.disconnect();
        if (cookie.isEmpty()) throw new Exception("NSE warm-up gave no cookie");
        nseCookie = cookie;
        nseCookieAt = System.currentTimeMillis();
    }

    private synchronized void ensureYahooAuth() throws Exception {
        if (yahooCrumb != null && (System.currentTimeMillis() - yahooAuthAt) < 25 * 60 * 1000) {
            return;
        }
        HttpURLConnection c1 = (HttpURLConnection)
                new URL("https://fc.yahoo.com").openConnection();
        c1.setInstanceFollowRedirects(false);
        c1.setRequestProperty("User-Agent", DESKTOP_UA);
        c1.getResponseCode();
        String cookie = collectCookies(c1);
        c1.disconnect();

        if (cookie.isEmpty()) {
            HttpURLConnection c1b = (HttpURLConnection)
                    new URL("https://finance.yahoo.com").openConnection();
            c1b.setRequestProperty("User-Agent", DESKTOP_UA);
            c1b.getResponseCode();
            cookie = collectCookies(c1b);
            c1b.disconnect();
        }
        if (cookie.isEmpty()) throw new Exception("Yahoo warm-up gave no cookie");

        HttpURLConnection c2 = (HttpURLConnection)
                new URL("https://query1.finance.yahoo.com/v1/test/getcrumb").openConnection();
        c2.setRequestProperty("User-Agent", DESKTOP_UA);
        c2.setRequestProperty("Cookie", cookie);
        BufferedReader r = new BufferedReader(new InputStreamReader(c2.getInputStream(), "UTF-8"));
        String crumb = r.readLine();
        r.close();
        c2.disconnect();
        if (crumb == null || crumb.isEmpty() || crumb.contains("<")) {
            throw new Exception("Yahoo gave no crumb");
        }
        yahooCookie = cookie;
        yahooCrumb = crumb;
        yahooAuthAt = System.currentTimeMillis();
    }

    private String plainGet(String urlStr, String cookieHeader, String refererHeader) throws Exception {
        HttpURLConnection connection = null;
        try {
            URL u = new URL(urlStr);
            connection = (HttpURLConnection) u.openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(12000);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestProperty("User-Agent", DESKTOP_UA);
            connection.setRequestProperty("Accept",
                    "application/json,text/xml,application/xml,text/plain,*/*");
            connection.setRequestProperty("Accept-Language", "en-IN,en;q=0.9");
            if (cookieHeader != null && !cookieHeader.isEmpty()) {
                connection.setRequestProperty("Cookie", cookieHeader);
            }
            if (refererHeader != null) {
                connection.setRequestProperty("Referer", refererHeader);
            }

            int code = connection.getResponseCode();
            InputStream stream = (code >= 200 && code < 400)
                    ? connection.getInputStream()
                    : connection.getErrorStream();

            if (stream == null) throw new Exception("HTTP " + code + ": empty body");

            BufferedReader reader = new BufferedReader(new InputStreamReader(stream, "UTF-8"));
            StringBuilder body = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) body.append(line);
            reader.close();

            if (code >= 200 && code < 400) {
                return body.toString();
            }

            String snippet = body.length() > 120 ? body.substring(0, 120) : body.toString();
            throw new Exception("HTTP " + code + ": " + snippet);

        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    public class NativeBridge {

        @JavascriptInterface
        public void fetch(String url, String id) {
            executor.execute(() -> {
                try {
                    if (!allowed(url)) {
                        throw new Exception("Blocked URL: " + url);
                    }

                    URL probe = new URL(url);
                    String host = probe.getHost().toLowerCase();

                    try {
                        String body = plainGet(url, null, null);
                        sendResult(id, body, true);
                        return;
                    } catch (Exception firstTry) {

                        if (host.endsWith("nseindia.com")) {
                            try {
                                ensureNseSession();
                                String body = plainGet(url, nseCookie, "https://www.nseindia.com/");
                                sendResult(id, body, true);
                            } catch (Exception secondTry) {
                                nseCookie = null;
                                sendResult(id, "NSE: " + secondTry.getMessage(), false);
                            }
                            return;
                        }

                        if (host.endsWith("finance.yahoo.com")) {
                            try {
                                ensureYahooAuth();
                                String withCrumb = url + (url.contains("?") ? "&" : "?")
                                        + "crumb=" + URLEncoder.encode(yahooCrumb, "UTF-8");
                                String body = plainGet(withCrumb, yahooCookie, "https://finance.yahoo.com/");
                                sendResult(id, body, true);
                            } catch (Exception secondTry) {
                                yahooCrumb = null;
                                sendResult(id, "Yahoo: " + secondTry.getMessage(), false);
                            }
                            return;
                        }

                        sendResult(id, firstTry.getMessage(), false);
                    }

                } catch (Exception e) {
                    sendResult(id, e.getClass().getSimpleName() + ": " + e.getMessage(), false);
                }
            });
        }

        @JavascriptInterface
        public void openExternal(String url) {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                startActivity(intent);
            } catch (Exception ignored) {
            }
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        executor.shutdownNow();
        super.onDestroy();
    }
}
