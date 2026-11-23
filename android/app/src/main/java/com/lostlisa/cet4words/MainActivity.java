package com.lostlisa.cet4words;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

/**
 * Android 15+ (and any edge-to-edge window) draws the WebView under the status bar,
 * display cutout, and navigation bar. Capacitor's built-in margin helper is off unless
 * configured, and it does not include the keyboard.
 *
 * This activity is the only inset source inside the app: the WebView is margined by the
 * insets the system reports (status bars, gesture or 3-button navigation, cutout, IME).
 * Those insets are consumed so the page's CSS safe-area stays 0 here. The website still
 * uses env(safe-area-inset-*), and html.native-safe-area turns that padding off so the
 * two mechanisms are not stacked.
 */
public class MainActivity extends BridgeActivity {
    private static final int PAPER = Color.parseColor("#F6F7F9");

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams attributes = window.getAttributes();
            attributes.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            window.setAttributes(attributes);
        }
        window.setStatusBarColor(PAPER);
        window.setNavigationBarColor(PAPER);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }

        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        if (controller != null) {
            controller.setAppearanceLightStatusBars(true);
            controller.setAppearanceLightNavigationBars(true);
        }

        View content = findViewById(android.R.id.content);
        if (content == null || getBridge() == null || getBridge().getWebView() == null) {
            return;
        }
        content.setBackgroundColor(PAPER);
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, windowInsets) -> {
            Insets bars = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            Insets ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime());
            int bottom = Math.max(bars.bottom, ime.bottom);
            view.setPadding(bars.left, bars.top, bars.right, bottom);
            markNativeSafeArea(getBridge().getWebView());
            return WindowInsetsCompat.CONSUMED;
        });
        ViewCompat.requestApplyInsets(content);

        getBridge().addWebViewListener(
            new WebViewListener() {
                @Override
                public void onPageLoaded(WebView loaded) {
                    markNativeSafeArea(loaded);
                }
            }
        );
    }

    private static void markNativeSafeArea(WebView webView) {
        webView.evaluateJavascript(
            "(function(){var root=document.documentElement;if(root){root.classList.add('native-safe-area');}})();",
            null
        );
    }
}
