package com.adsdk.test.exoplayer

import android.os.Bundle
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView

/**
 * ExoPlayer (Media3) host activity for Ads SDK integration testing.
 *
 * Accessibility IDs expected by the test harness:
 *   LoadContentButton, AdContainer, SkipButton, DiagnosticLog, MemoryLabel
 */
class MainActivity : AppCompatActivity() {

    private var player: ExoPlayer? = null
    private lateinit var diagnosticLog: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        diagnosticLog = findViewById(R.id.diagnosticLog)
        log("activity_created")

        // TODO: Replace with AdsSDK.initialize(this, publisherId = "YOUR_PID")
        initPlayer()
        log("player_ready:exoplayer")
        log("sdk_initialized")
        log("adapter_attached:exoplayer")
    }

    private fun initPlayer() {
        player = ExoPlayer.Builder(this).build()
        val playerView = findViewById<PlayerView>(R.id.playerView)
        playerView.player = player
    }

    private fun log(msg: String) {
        val ts = java.text.SimpleDateFormat("HH:mm:ss.SSS", java.util.Locale.US).format(java.util.Date())
        diagnosticLog.append("
$ts $msg")
    }

    override fun onPause()  { super.onPause();  player?.pause() }
    override fun onResume() { super.onResume(); player?.play()  }

    override fun onDestroy() {
        super.onDestroy()
        player?.release()
        player = null
        log("player_released")
    }
}
