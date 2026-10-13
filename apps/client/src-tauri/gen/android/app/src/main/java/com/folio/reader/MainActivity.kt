package com.folio.reader

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.ActionMode
import android.view.View
import android.view.WindowManager
import androidx.activity.OnBackPressedCallback
import androidx.core.view.WindowCompat
import app.tauri.WryActivity
import java.io.File
import java.io.FileOutputStream

class MainActivity : WryActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Edge-to-edge layout per P11.1
        WindowCompat.setDecorFitsSystemWindows(window, false)

        // Register back press handler per P11.1 & P11.3
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // Emit custom event to WebView so back-stack layers close first
                trigger("folio://back-pressed", "{}")
            }
        })

        // Handle initial intent
        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    /**
     * Suppress native Android ActionMode text selection menu (Cut/Copy/Share)
     * so only Folio's custom in-app reader popover displays (P11.3).
     */
    override fun onActionModeStarted(mode: ActionMode?) {
        mode?.finish()
        super.onActionModeStarted(mode)
    }

    override fun onWindowStartingActionMode(callback: ActionMode.Callback?): ActionMode? {
        // Return null to suppress default Android floating action mode
        return null
    }

    override fun onWindowStartingActionMode(callback: ActionMode.Callback?, type: Int): ActionMode? {
        return null
    }

    /**
     * Toggles screen wake lock / keep screen on during reading.
     */
    fun setKeepScreenOn(enabled: Boolean) {
        runOnUiThread {
            if (enabled) {
                window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            } else {
                window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
        }
    }

    /**
     * Processes ACTION_VIEW and ACTION_SEND file intents (P11.4).
     */
    private fun handleIntent(intent: Intent?) {
        if (intent == null) return

        val action = intent.action
        val uri: Uri? = when (action) {
            Intent.ACTION_VIEW -> intent.data
            Intent.ACTION_SEND -> {
                @Suppress("DEPRECATION")
                intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM) ?: intent.data
            }
            else -> null
        }

        if (uri != null) {
            resolveAndEmitFile(uri)
        }
    }

    private fun resolveAndEmitFile(uri: Uri) {
        try {
            val contentResolver = applicationContext.contentResolver
            val fileName = resolveFileName(uri) ?: "imported_book.epub"
            val tempFile = File(cacheDir, fileName)

            contentResolver.openInputStream(uri)?.use { input ->
                FileOutputStream(tempFile).use { output ->
                    input.copyTo(output)
                }
            }

            if (tempFile.exists() && tempFile.length() > 0) {
                // Emit event to Tauri webview
                trigger("folio://file-open", tempFile.absolutePath)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun resolveFileName(uri: Uri): String? {
        var result: String? = null
        if (uri.scheme == "content") {
            val cursor = contentResolver.query(uri, null, null, null, null)
            cursor?.use {
                if (it.moveToFirst()) {
                    val nameIndex = it.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                    if (nameIndex >= 0) {
                        result = it.getString(nameIndex)
                    }
                }
            }
        }
        if (result == null) {
            result = uri.path?.let { path ->
                val cut = path.lastIndexOf('/')
                if (cut != -1) path.substring(cut + 1) else path
            }
        }
        return result
    }
}
