package com.folio.reader

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Binder
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import androidx.core.app.NotificationCompat
import java.util.Locale

class TtsMediaService : Service(), TextToSpeech.OnInitListener {

    private val binder = LocalBinder()
    private var tts: TextToSpeech? = null
    private var isInitialized = false
    private var isSpeaking = false
    private var currentUtteranceId: String? = null
    private var currentBookTitle = "Folio"
    private var currentChapter = "Reading"

    var eventListener: ((event: String, payload: String) -> Unit)? = null

    inner class LocalBinder : Binder() {
        fun getService(): TtsMediaService = this@TtsMediaService
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        tts = TextToSpeech(applicationContext, this)
    }

    override fun onInit(status: Int) {
        if (status == TextToSpeech.SUCCESS) {
            isInitialized = true
            tts?.language = Locale.getDefault()
            tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) {
                    isSpeaking = true
                    currentUtteranceId = utteranceId
                    updateNotification(true)
                    eventListener?.invoke("folio://tts-start", """{"utteranceId":"$utteranceId"}""")
                }

                override fun onDone(utteranceId: String?) {
                    isSpeaking = false
                    updateNotification(false)
                    eventListener?.invoke("folio://tts-done", """{"utteranceId":"$utteranceId"}""")
                }

                @Deprecated("Deprecated in Java")
                override fun onError(utteranceId: String?) {
                    isSpeaking = false
                    updateNotification(false)
                    eventListener?.invoke("folio://tts-error", """{"utteranceId":"$utteranceId"}""")
                }

                override fun onRangeStart(utteranceId: String?, start: Int, end: Int, frame: Int) {
                    // Critical for word highlighting sync (P11.2)
                    eventListener?.invoke(
                        "folio://tts-range-start",
                        """{"utteranceId":"$utteranceId","start":$start,"end":$end}"""
                    )
                }
            })
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_PLAY -> resume()
            ACTION_PAUSE -> pause()
            ACTION_STOP -> stop()
            ACTION_NEXT -> {
                eventListener?.invoke("folio://tts-next-chapter", "{}")
            }
        }
        return START_NOT_STICKY
    }

    fun speak(text: String, utteranceId: String, rate: Float = 1.0f, pitch: Float = 1.0f, voiceName: String? = null): Boolean {
        if (!isInitialized || tts == null) return false

        tts?.setSpeechRate(rate)
        tts?.setPitch(pitch)

        if (voiceName != null) {
            val matched = tts?.voices?.find { it.name == voiceName }
            if (matched != null) {
                tts?.voice = matched
            }
        }

        val params = Bundle()
        currentUtteranceId = utteranceId

        startForeground(NOTIFICATION_ID, buildNotification(true))
        val result = tts?.speak(text, TextToSpeech.QUEUE_FLUSH, params, utteranceId)
        return result == TextToSpeech.SUCCESS
    }

    fun stop() {
        tts?.stop()
        isSpeaking = false
        stopForeground(STOP_FOREGROUND_REMOVE)
    }

    fun pause() {
        tts?.stop()
        isSpeaking = false
        updateNotification(false)
    }

    fun resume() {
        eventListener?.invoke("folio://tts-resume-requested", "{}")
    }

    fun listVoices(): List<Map<String, String>> {
        val result = mutableListOf<Map<String, String>>()
        if (!isInitialized || tts == null) return result
        try {
            for (voice in tts?.voices ?: emptySet()) {
                result.add(
                    mapOf(
                        "name" to voice.name,
                        "locale" to voice.locale.toLanguageTag(),
                        "quality" to voice.quality.toString(),
                        "latency" to voice.latency.toString()
                    )
                )
            }
        } catch (_: Exception) {}
        return result
    }

    fun setMetadata(title: String, chapter: String) {
        currentBookTitle = title
        currentChapter = chapter
        if (isSpeaking) {
            updateNotification(true)
        }
    }

    private fun buildNotification(playing: Boolean): Notification {
        val mainIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val contentPendingIntent = PendingIntent.getActivity(
            this, 0, mainIntent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val playPauseIntent = Intent(this, TtsMediaService::class.java).apply {
            action = if (playing) ACTION_PAUSE else ACTION_PLAY
        }
        val playPausePendingIntent = PendingIntent.getService(
            this, 1, playPauseIntent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val stopIntent = Intent(this, TtsMediaService::class.java).apply {
            action = ACTION_STOP
        }
        val stopPendingIntent = PendingIntent.getService(
            this, 2, stopIntent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val nextIntent = Intent(this, TtsMediaService::class.java).apply {
            action = ACTION_NEXT
        }
        val nextPendingIntent = PendingIntent.getService(
            this, 3, nextIntent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(currentBookTitle)
            .setContentText(currentChapter)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(contentPendingIntent)
            .addAction(
                if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
                if (playing) "Pause" else "Play",
                playPausePendingIntent
            )
            .addAction(android.R.drawable.ic_media_next, "Next", nextPendingIntent)
            .addAction(android.R.drawable.ic_delete, "Stop", stopPendingIntent)
            .setOngoing(playing)
            .setSilent(true)
            .build()
    }

    private fun updateNotification(playing: Boolean) {
        val notification = buildNotification(playing)
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
        manager?.notify(NOTIFICATION_ID, notification)
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Folio Read Aloud",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Media playback notification for continuous reading aloud"
            }
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            manager?.createNotificationChannel(channel)
        }
    }

    override fun onDestroy() {
        tts?.shutdown()
        super.onDestroy()
    }

    companion object {
        const val CHANNEL_ID = "folio_tts_channel"
        const val NOTIFICATION_ID = 2001
        const val ACTION_PLAY = "com.folio.reader.ACTION_PLAY"
        const val ACTION_PAUSE = "com.folio.reader.ACTION_PAUSE"
        const val ACTION_STOP = "com.folio.reader.ACTION_STOP"
        const val ACTION_NEXT = "com.folio.reader.ACTION_NEXT"
    }
}
