package com.verso.reader

import android.graphics.Color
import android.os.Bundle
import android.view.View
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    // Android 15+ forces edge-to-edge for apps targeting API 35+, so the WebView
    // was drawn under the status bar (top bars overlapped the clock) and under
    // the navigation buttons (bottom tab bar / reader progress hidden). Pad the
    // content by the system bars, display cutout and keyboard so every screen
    // fits between them.
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
      )
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
      WindowInsetsCompat.CONSUMED
    }

    // The padded areas show the window background: match the app's dark base and
    // use light status/navigation bar icons on it.
    window.decorView.setBackgroundColor(Color.parseColor("#0E0F11"))
    WindowCompat.getInsetsController(window, window.decorView).apply {
      isAppearanceLightStatusBars = false
      isAppearanceLightNavigationBars = false
    }
  }
}
