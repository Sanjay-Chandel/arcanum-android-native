package com.arcanum;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.CookieManager;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.CookieHandler;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private WebView webView;
    private final ExecutorService executor = Executors.newFixedThreadPool(4);

    @SuppressLint("SetJavaScriptEnabled")
    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        webView.setBackgroundColor(android.graphics.Color.rgb(10,15,26));
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setAllowFileAccess(true);
        webView.getSettings().setAllowContentAccess(true);
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient());
        CookieManager.getInstance().setAcceptCookie(true);
        CookieHandler.setDefault(new CookieManager(null, CookiePolicy.ACCEPT_ALL));
        webView.addJavascriptInterface(new NativeBridge(), "Android");
        setContentView(webView);
        webView.loadUrl("file:///android_asset/index.html");
    }

    private boolean allowed(String u) {
        try {
            URL url = new URL(u);
            String h = url.getHost();
            return u.startsWith("https://") &&
              (h.endsWith("nseindia.com") || h.endsWith("yahoo.com") ||
               h.endsWith("google.com") || h.endsWith("googleusercontent.com") ||
               h.endsWith("moneycontrol.com") || h.endsWith("livemint.com") ||
               h.endsWith("bseindia.com"));
        } catch(Exception e) { return false; }
    }

    private String get(String u) throws Exception {
        if (!allowed(u)) throw new Exception("Blocked URL");
        HttpURLConnection c=(HttpURLConnection)new URL(u).openConnection();
        c.setRequestMethod("GET");
        c.setConnectTimeout(12000); c.setReadTimeout(15000);
        c.setUseCaches(false);
        c.setRequestProperty("Accept","application/json, text/plain, */*");
        c.setRequestProperty("Accept-Language","en-IN,en;q=0.9");
        c.setRequestProperty("User-Agent","Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128 Mobile Safari/537.36");
        if (u.contains("nseindia.com")) {
            c.setRequestProperty("Referer","https://www.nseindia.com/");
            c.setRequestProperty("X-Requested-With","XMLHttpRequest");
        }
        int code=c.getResponseCode();
        BufferedReader br=new BufferedReader(new InputStreamReader(
            code>=200 && code<400 ? c.getInputStream() : c.getErrorStream()));
        StringBuilder sb=new StringBuilder(); String line;
        while((line=br.readLine())!=null) sb.append(line).append('\n');
        br.close(); c.disconnect();
        if(code<200 || code>=400) throw new Exception("HTTP "+code);
        return sb.toString();
    }

    private void callback(final String id, final String payload, final boolean ok) {
        final String js = "window.nativeResult("+jsq(id)+","+jsq(payload)+","+ok+");";
        runOnUiThread(() -> webView.evaluateJavascript(js,null));
    }
    private String jsq(String s) { return org.json.JSONObject.quote(s==null?"":s); }

    public class NativeBridge {
        @JavascriptInterface public void fetch(String url, String id) {
            executor.submit(() -> {
                try { callback(id,get(url),true); }
                catch(Exception e){ callback(id,e.getMessage()==null?"Request failed":e.getMessage(),false); }
            });
        }
        @JavascriptInterface public void openExternal(String url) {
            try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch(Exception ignored){}
        }
    }
    @Override protected void onDestroy(){ executor.shutdownNow(); super.onDestroy(); }
}
