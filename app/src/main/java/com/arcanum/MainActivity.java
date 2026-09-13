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
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {

    private WebView webView;

    private final ExecutorService executor =
            Executors.newCachedThreadPool();

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);

        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setAllowFileAccess(true);
        webView.getSettings().setAllowContentAccess(true);

        webView.setWebChromeClient(
                new WebChromeClient()
        );

        webView.setWebViewClient(
                new WebViewClient()
        );

        CookieManager
                .getInstance()
                .setAcceptCookie(true);

        webView.addJavascriptInterface(
                new NativeBridge(),
                "Android"
        );

        setContentView(webView);

        webView.loadUrl(
                "file:///android_asset/index.html"
        );
    }

    private boolean allowed(String u) {
        try {
            URL url = new URL(u);

            String host =
                    url.getHost().toLowerCase();

            return host.equals("nseindia.com")
                    || host.endsWith(".nseindia.com")
                    || host.equals("yahoo.com")
                    || host.endsWith(".yahoo.com")
                    || host.equals("google.com")
                    || host.endsWith(".google.com")
                    || host.equals("googleusercontent.com")
                    || host.endsWith(".googleusercontent.com");

        } catch (Exception e) {
            return false;
        }
    }

    private void sendResult(
            String id,
            String payload,
            boolean ok
    ) {

        runOnUiThread(() -> {

            if (webView == null) return;

            String js =
                    "window.nativeResult("
                            + JSONObject.quote(id)
                            + ","
                            + JSONObject.quote(payload == null ? "" : payload)
                            + ","
                            + ok
                            + ")";

            webView.evaluateJavascript(
                    js,
                    null
            );
        });
    }

    public class NativeBridge {

        @JavascriptInterface
        public void fetch(
                String url,
                String id
        ) {

            executor.execute(() -> {

                HttpURLConnection connection = null;

                try {

                    if (!allowed(url)) {
                        throw new Exception(
                                "Blocked URL: " + url
                        );
                    }

                    URL u = new URL(url);

                    connection =
                            (HttpURLConnection) u.openConnection();

                    connection.setRequestMethod("GET");

                    connection.setConnectTimeout(10000);
                    connection.setReadTimeout(12000);

                    connection.setInstanceFollowRedirects(true);

                    connection.setRequestProperty(
                            "User-Agent",
                            "Mozilla/5.0 (Android) Arcanum/1.0"
                    );

                    connection.setRequestProperty(
                            "Accept",
                            "application/json,text/xml,application/xml,text/plain,*/*"
                    );

                    connection.setRequestProperty(
                            "Accept-Language",
                            "en-IN,en;q=0.9"
                    );

                    int code =
                            connection.getResponseCode();

                    InputStream stream;

                    if (code >= 200 && code < 400) {
                        stream =
                                connection.getInputStream();
                    } else {
                        stream =
                                connection.getErrorStream();
                    }

                    if (stream == null) {
                        throw new Exception(
                                "HTTP " + code
                        );
                    }

                    BufferedReader reader =
                            new BufferedReader(
                                    new InputStreamReader(
                                            stream,
                                            "UTF-8"
                                    )
                            );

                    StringBuilder body =
                            new StringBuilder();

                    String line;

                    while ((line = reader.readLine()) != null) {
                        body.append(line);
                    }

                    reader.close();

                    if (code >= 200 && code < 400) {

                        sendResult(
                                id,
                                body.toString(),
                                true
                        );

                    } else {

                        sendResult(
                                id,
                                "HTTP " + code,
                                false
                        );
                    }

                } catch (Exception e) {

                    sendResult(
                            id,
                            e.getClass().getSimpleName()
                                    + ": "
                                    + e.getMessage(),
                            false
                    );

                } finally {

                    if (connection != null) {
                        connection.disconnect();
                    }
                }
            });
        }

        @JavascriptInterface
        public void openExternal(String url) {

            try {

                Intent intent =
                        new Intent(
                                Intent.ACTION_VIEW,
                                Uri.parse(url)
                        );

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
