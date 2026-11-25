package dev.dashling.panel;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

/**
 * Kiosk wrapper for the Dashling panel: landscape only, screen always on, fullscreen, no address bar.
 * The panel address is entered once on the device and kept in SharedPreferences. Nothing is hard-coded.
 *
 * Change the address: press and hold the top-left corner for 1.5 s, or tap the screen with three fingers.
 */
public class MainActivity extends Activity {
    private static final String PREFS = "dashling";
    private static final String KEY_URL = "url";
    private static final int DEFAULT_PORT = 8787;
    private static final long RETRY_MS = 5000, HOLD_MS = 1500;
    private static final int BG = 0xFF0B0D12;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private FrameLayout root;
    private WebView web;
    private View errorView;
    private TextView errorAddr;
    private AlertDialog dialog;
    private String baseUrl;                       // normalized, always ends with "/"
    private float downX, downY;
    private boolean holdArmed;

    private final Runnable retry = new Runnable() {
        @Override public void run() { if (baseUrl != null) web.loadUrl(baseUrl); }
    };
    private final Runnable hold = new Runnable() {
        @Override public void run() { holdArmed = false; showAddressDialog(); }
    };

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }

        root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        web = buildWebView();
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        errorView = buildErrorView();
        errorView.setVisibility(View.GONE);
        root.addView(errorView, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        hideSystemUi();

        String saved = getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_URL, null);
        baseUrl = saved != null ? normalize(saved) : normalize(getString(R.string.default_url));
        if (baseUrl == null) {
            showAddressDialog();                  // first launch: ask for the address
        } else {
            web.loadUrl(baseUrl);
        }
    }

    // ------------------------------------------------------------------ web view
    private WebView buildWebView() {
        WebView w = new WebView(this);
        w.setBackgroundColor(BG);
        w.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);             // localStorage keeps the device pairing
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setSupportMultipleWindows(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setTextZoom(100);                       // ignore the system font scale: keep the layout predictable
        w.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                return !sameOrigin(r.getUrl());   // links to any other host are ignored
            }
            @Override public void onPageStarted(WebView v, String url, android.graphics.Bitmap f) {
                ui.removeCallbacks(retry);
            }
            @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame()) showError();
            }
            @Override public void onReceivedHttpError(WebView v, WebResourceRequest r, WebResourceResponse e) {
                if (r.isForMainFrame() && e.getStatusCode() >= 500) showError();
            }
            @Override public void onReceivedSslError(WebView v, SslErrorHandler h, SslError e) {
                h.cancel(); showError();
            }
            @Override public void onPageFinished(WebView v, String url) {
                if (errorView.getVisibility() == View.VISIBLE && !ui.hasCallbacks(retry)) {
                    errorView.setVisibility(View.GONE);
                }
            }
            @Override public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail d) {
                recreate(); return true;
            }
        });
        return w;
    }

    private void showError() {
        errorAddr.setText(baseUrl == null ? "" : baseUrl.replaceAll("/$", ""));
        errorView.setVisibility(View.VISIBLE);
        ui.removeCallbacks(retry);
        ui.postDelayed(retry, RETRY_MS);
    }

    private View buildErrorView() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(BG);
        box.setClickable(true);
        int p = dp(24);
        box.setPadding(p, p, p, p);
        TextView t = new TextView(this);
        t.setText("Can't reach the panel, retrying…");
        t.setTextColor(Color.WHITE);
        t.setTextSize(22);
        t.setGravity(Gravity.CENTER);
        errorAddr = new TextView(this);
        errorAddr.setTextColor(0xFF9AA3B2);
        errorAddr.setTextSize(15);
        errorAddr.setGravity(Gravity.CENTER);
        errorAddr.setPadding(0, dp(8), 0, dp(20));
        Button change = new Button(this);
        change.setText("Change address");
        change.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { showAddressDialog(); }
        });
        box.addView(t);
        box.addView(errorAddr);
        box.addView(change);
        return box;
    }

    // ------------------------------------------------------------------ address
    private void showAddressDialog() {
        if (dialog != null && dialog.isShowing()) return;
        final EditText in = new EditText(this);
        in.setSingleLine();
        in.setHint("192.168.1.20:8787");
        in.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        if (baseUrl != null) in.setText(baseUrl.replaceAll("/$", ""));
        FrameLayout wrap = new FrameLayout(this);
        int p = dp(20);
        wrap.setPadding(p, dp(8), p, 0);
        wrap.addView(in);
        final boolean cancelable = baseUrl != null;
        AlertDialog.Builder b = new AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert)
            .setTitle("Panel address")
            .setMessage("Where is Dashling running? Example: 192.168.1.20:8787 (port 8787 if left out)")
            .setView(wrap)
            .setCancelable(cancelable)
            .setPositiveButton("Save", null);
        if (cancelable) b.setNegativeButton("Cancel", null);
        dialog = b.create();
        dialog.setOnShowListener(new android.content.DialogInterface.OnShowListener() {
            @Override public void onShow(android.content.DialogInterface d) {
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(new View.OnClickListener() {
                    @Override public void onClick(View v) {
                        String n = normalize(in.getText().toString());
                        if (n == null) { in.setError("Enter an address like 192.168.1.20:8787"); return; }
                        saveAndLoad(n);
                        dialog.dismiss();
                    }
                });
            }
        });
        dialog.setOnDismissListener(new android.content.DialogInterface.OnDismissListener() {
            @Override public void onDismiss(android.content.DialogInterface d) { hideSystemUi(); }
        });
        dialog.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE);
        dialog.show();
    }

    private void saveAndLoad(String n) {
        baseUrl = n;
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_URL, n).apply();
        errorView.setVisibility(View.GONE);
        ui.removeCallbacks(retry);
        web.loadUrl(n);
    }

    /** "ip:port", "host", or a full http(s) URL -> "scheme://host[:port]/", or null when invalid. */
    static String normalize(String s) {
        if (s == null) return null;
        s = s.trim();
        if (s.isEmpty()) return null;
        if (s.contains("://") && !s.matches("(?i)^https?://.*")) return null;
        if (!s.matches("(?i)^https?://.*")) s = "http://" + s;
        try {
            URI u = new URI(s);
            String host = u.getHost();
            if (host == null || host.isEmpty()) return null;
            String scheme = u.getScheme().toLowerCase(Locale.ROOT);
            int port = u.getPort();
            if (port == -1 && scheme.equals("http")) port = DEFAULT_PORT;
            return scheme + "://" + host + (port == -1 ? "" : ":" + port) + "/";
        } catch (URISyntaxException e) {
            return null;
        }
    }

    private boolean sameOrigin(Uri t) {
        if (baseUrl == null || t == null) return false;
        Uri b = Uri.parse(baseUrl);
        return eq(b.getScheme(), t.getScheme()) && eq(b.getHost(), t.getHost()) && port(b) == port(t);
    }
    private static boolean eq(String a, String b) { return a != null && b != null && a.equalsIgnoreCase(b); }
    private static int port(Uri u) {
        if (u.getPort() != -1) return u.getPort();
        return "https".equalsIgnoreCase(u.getScheme()) ? 443 : 80;
    }

    // ------------------------------------------------------------------ kiosk behaviour
    @Override
    public boolean dispatchTouchEvent(MotionEvent e) {
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                downX = e.getX(); downY = e.getY();
                if (downX < dp(110) && downY < dp(110)) { holdArmed = true; ui.postDelayed(hold, HOLD_MS); }
                break;
            case MotionEvent.ACTION_MOVE:
                if (holdArmed) {
                    float slop = ViewConfiguration.get(this).getScaledTouchSlop() * 2;
                    if (Math.abs(e.getX() - downX) > slop || Math.abs(e.getY() - downY) > slop) cancelHold();
                }
                break;
            case MotionEvent.ACTION_POINTER_DOWN:
                cancelHold();
                if (e.getPointerCount() == 3) showAddressDialog();
                break;
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                cancelHold();
                break;
        }
        return super.dispatchTouchEvent(e);
    }

    private void cancelHold() { holdArmed = false; ui.removeCallbacks(hold); }

    @Override public void onBackPressed() { /* kiosk: back does nothing (the dialog handles its own back) */ }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUi();
    }

    private void hideSystemUi() {
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        }
    }

    @Override protected void onResume() {
        super.onResume();
        web.onResume();
        hideSystemUi();
        if (baseUrl != null && errorView.getVisibility() == View.VISIBLE) ui.post(retry);
    }
    @Override protected void onPause() { web.onPause(); super.onPause(); }

    @Override protected void onDestroy() {
        ui.removeCallbacksAndMessages(null);
        if (dialog != null && dialog.isShowing()) dialog.dismiss();
        root.removeView(web);
        web.destroy();
        super.onDestroy();
    }

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }
}
