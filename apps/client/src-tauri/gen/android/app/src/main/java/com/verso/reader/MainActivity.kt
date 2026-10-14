package com.verso.reader

import android.os.Bundle

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // No enableEdgeToEdge(): with it the WebView drew underneath the status bar
    // and the system navigation buttons, so the app's top bar overlapped the clock
    // and its bottom tab bar sat under the navigation bar. Letting the system
    // inset the WebView keeps every screen inside the visible area.
    super.onCreate(savedInstanceState)
  }
}
