package com.local.offlinegames

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream

class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // إبقاء الشاشة مضاءة أثناء اللعب وتفعيل ملء الشاشة الغامر
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        enableImmersiveFullscreen()

        // خادم أصول محلي من داخل الـ APK بدون أي اتصال بالشبكة
        val assetLoader = WebViewAssetLoader.Builder()
            .setDomain("appassets.androidplatform.net")
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#0F172A"))
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false
            overScrollMode = WebView.OVER_SCROLL_NEVER

            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                mediaPlaybackRequiresUserGesture = false
                allowFileAccess = false
                allowContentAccess = false
                cacheMode = WebSettings.LOAD_NO_CACHE
                setSupportZoom(false)
                builtInZoomControls = false
                displayZoomControls = false
            }

            addJavascriptInterface(AndroidHostBridge(this@MainActivity), "AndroidHost")

            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest
                ): WebResourceResponse {
                    // السماح فقط بالملفات المحلية داخل حزمة التطبيق وحظر أي طلب خارجي نهائياً
                    return assetLoader.shouldInterceptRequest(request.url)
                        ?: WebResourceResponse(
                            "text/plain",
                            "UTF-8",
                            404,
                            "Offline Blocked",
                            emptyMap(),
                            ByteArrayInputStream(ByteArray(0))
                        )
                }
            }
        }

        setContentView(webView)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView.evaluateJavascript("window.onAndroidBackPressed && window.onAndroidBackPressed()") { result ->
                    if (result != "true") {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                    }
                }
            }
        })

        webView.loadUrl("https://appassets.androidplatform.net/index.html")
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) enableImmersiveFullscreen()
    }

    private fun enableImmersiveFullscreen() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.hide(WindowInsetsCompat.Type.systemBars())
        controller.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }

    override fun onPause() {
        super.onPause()
        webView.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    class AndroidHostBridge(private val context: Context) {
        private val lan = LanNet()
        @JavascriptInterface fun lanStart(id: String, name: String) { lan.start(id.take(40), name.take(24)) }
        @JavascriptInterface fun lanStop() { lan.stop() }
        @JavascriptInterface fun lanSetState(state: String) { lan.setState(state.take(16)) }
        @JavascriptInterface fun lanPeers(): String = lan.peersJson()
        @JavascriptInterface fun lanSend(ip: String, json: String): Boolean = lan.send(ip, json)
        @JavascriptInterface fun lanBroadcast(json: String): Int = lan.broadcast(json)
        @JavascriptInterface fun lanPoll(): String = lan.poll()

        // Per-game orientation: Brawlbots is a landscape game, Pool and Match Monsters stay portrait.
        @JavascriptInterface
        fun setOrientation(mode: String) {
            val act = context as? Activity ?: return
            val target = if (mode == "landscape") ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                         else ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
            act.runOnUiThread { act.requestedOrientation = target }
        }

        @JavascriptInterface
        fun vibrate(durationMs: Long) {
            val ms = durationMs.coerceIn(5L, 300L)
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    val vm = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
                    vm?.defaultVibrator?.vibrate(
                        VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE)
                    )
                } else {
                    @Suppress("DEPRECATION")
                    val v = context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        v?.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE))
                    } else {
                        @Suppress("DEPRECATION")
                        v?.vibrate(ms)
                    }
                }
            } catch (_: Exception) {
            }
        }
    }
}
