package com.adsdk.test.theoplayer

import android.os.Bundle
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

/**
 * THEOplayer host activity for Ads SDK integration testing.
 *
 * Accessibility IDs: LoadContentButton, AdContainer, SkipButton, DiagnosticLog, MemoryLabel
 */
class MainActivity : AppCompatActivity() {

    private lateinit var diagnosticLog: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        diagnosticLog = findViewById(R.id.diagnosticLog)
        log("activity_created")

        // TODO: Add THEOplayer SDK dependency and initialise here
        // TODO: AdsSDK.initialize(this, publisherId = "YOUR_PID")
        log("sdk_initialized")
        log("adapter_attached:theoplayer")
    }

    private fun log(msg: String) {
        val ts = java.text.SimpleDateFormat("HH:mm:ss.SSS", java.util.Locale.US).format(java.util.Date())
        diagnosticLog.append("
$ts $msg")
    }

    override fun onPause()  { super.onPause()  }
    override fun onResume() { super.onResume() }
    override fun onDestroy() { super.onDestroy(); log("player_released") }
}
