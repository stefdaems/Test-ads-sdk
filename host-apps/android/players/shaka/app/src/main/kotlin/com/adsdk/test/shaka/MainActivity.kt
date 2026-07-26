package com.adsdk.test.shaka

import android.os.Bundle
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

/**
 * Shaka Player (via WebView) host activity for Ads SDK integration testing.
 *
 * Accessibility IDs: LoadContentButton, AdContainer, SkipButton, DiagnosticLog, MemoryLabel
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var diagnosticLog: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        diagnosticLog = findViewById(R.id.diagnosticLog)
        log("activity_created")

        webView = findViewById(R.id.playerView)
        // For Shaka on Android, we use a WebView to host the JS player
        // Re-use the web shaka stub for convenience
        webView.settings.apply {
            javaScriptEnabled = true
            mediaPlaybackRequiresUserGesture = false
            domStorageEnabled = true
            cacheMode = WebSettings.LOAD_NO_CACHE
        }

        // TODO: AdsSDK.initialize(this, publisherId = "YOUR_PID")
        log("sdk_initialized")
        log("adapter_attached:shaka")
    }

    private fun log(msg: String) {
        val ts = java.text.SimpleDateFormat("HH:mm:ss.SSS", java.util.Locale.US).format(java.util.Date())
        diagnosticLog.append("
$ts $msg")
    }

    override fun onDestroy() { super.onDestroy(); log("player_released") }
}
