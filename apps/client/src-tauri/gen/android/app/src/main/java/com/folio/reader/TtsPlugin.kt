package com.folio.reader

import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.IBinder
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@TauriPlugin
class TtsPlugin(private val activity: Activity) : Plugin(activity) {

    private var ttsService: TtsMediaService? = null
    private var isBound = false

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            val binder = service as? TtsMediaService.LocalBinder
            ttsService = binder?.getService()
            ttsService?.eventListener = { event, payload ->
                trigger(event, JSObject(payload))
            }
            isBound = true
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            ttsService = null
            isBound = false
        }
    }

    override fun load(webView: android.webkit.WebView) {
        super.load(webView)
        val intent = Intent(activity, TtsMediaService::class.java)
        activity.bindService(intent, connection, Context.BIND_AUTO_CREATE)
    }

    @Command
    fun speak(invoke: Invoke) {
        val text = invoke.parseArgs(JSObject::class.java).getString("text") ?: ""
        val utteranceId = invoke.parseArgs(JSObject::class.java).getString("utteranceId") ?: "utt-0"
        val rate = invoke.parseArgs(JSObject::class.java).getDouble("rate", 1.0).toFloat()
        val pitch = invoke.parseArgs(JSObject::class.java).getDouble("pitch", 1.0).toFloat()
        val voice = invoke.parseArgs(JSObject::class.java).getString("voice")

        val success = ttsService?.speak(text, utteranceId, rate, pitch, voice) ?: false
        val ret = JSObject()
        ret.put("success", success)
        invoke.resolve(ret)
    }

    @Command
    fun stop(invoke: Invoke) {
        ttsService?.stop()
        invoke.resolve()
    }

    @Command
    fun pause(invoke: Invoke) {
        ttsService?.pause()
        invoke.resolve()
    }

    @Command
    fun resume(invoke: Invoke) {
        ttsService?.resume()
        invoke.resolve()
    }

    @Command
    fun listVoices(invoke: Invoke) {
        val list = ttsService?.listVoices() ?: emptyList()
        val ret = JSObject()
        ret.put("voices", list)
        invoke.resolve(ret)
    }

    @Command
    fun setMetadata(invoke: Invoke) {
        val title = invoke.parseArgs(JSObject::class.java).getString("title") ?: "Folio"
        val chapter = invoke.parseArgs(JSObject::class.java).getString("chapter") ?: "Reading"
        ttsService?.setMetadata(title, chapter)
        invoke.resolve()
    }

    @Command
    fun setKeepScreenOn(invoke: Invoke) {
        val enabled = invoke.parseArgs(JSObject::class.java).getBoolean("enabled", false)
        (activity as? MainActivity)?.setKeepScreenOn(enabled)
        invoke.resolve()
    }

    override fun onDestroy() {
        if (isBound) {
            activity.unbindService(connection)
            isBound = false
        }
        super.onDestroy()
    }
}
