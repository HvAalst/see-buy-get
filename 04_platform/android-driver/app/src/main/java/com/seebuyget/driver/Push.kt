package com.seebuyget.driver

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging

/**
 * 2026-11-02 — FIREBASE CLOUD MESSAGING, FOR THE WAKE-UP ONLY. Started by hand from the build's BuildConfig (no
 * google-services plugin, no google-services.json): the project's public Android settings come from Gradle properties
 * (gradle.properties, or the repository's variables in the workflow). Without them this app simply never registers —
 * Messages in the car says "not ready in this version" — and nothing crashes.
 *
 * No token is made until the driver turns Messages in the car on (the manifest switches Firebase's auto-start off), and
 * the token is deleted again when it is turned off: a phone that never uses the car is never known to Firebase.
 *
 * The token calls are the ones Firebase marked deprecated in June 2026 (Cloud Messaging 25.1.0, registration by
 * installation id); they work, and the server sends to a registration token (fcm.ts). Moving both ends is one change.
 */
object Push {
    fun isConfigured(): Boolean =
        listOf(
            BuildConfig.FIREBASE_PROJECT_ID,
            BuildConfig.FIREBASE_APP_ID,
            BuildConfig.FIREBASE_API_KEY,
            BuildConfig.FIREBASE_SENDER_ID,
        ).all { it.isNotBlank() }

    /** Firebase started (once); false when the build carries no settings, or Firebase would not start. */
    fun start(context: Context): Boolean {
        if (!isConfigured()) return false
        return try {
            if (FirebaseApp.getApps(context).isEmpty()) {
                val options = FirebaseOptions.Builder()
                    .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
                    .setApplicationId(BuildConfig.FIREBASE_APP_ID)
                    .setApiKey(BuildConfig.FIREBASE_API_KEY)
                    .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
                    .build()
                FirebaseApp.initializeApp(context.applicationContext, options)
            }
            true
        } catch (e: RuntimeException) {
            false
        }
    }

    /** This phone's token, given to `then` on the main thread; null when Firebase is not set up or did not answer. */
    fun token(context: Context, then: (String?) -> Unit) {
        if (!start(context)) {
            then(null)
            return
        }
        try {
            val messaging = FirebaseMessaging.getInstance()
            messaging.isAutoInitEnabled = true
            messaging.token.addOnCompleteListener { task ->
                val token = if (task.isSuccessful) task.result else null
                then(token?.takeIf { it.isNotBlank() })
            }
        } catch (e: RuntimeException) {
            then(null)
        }
    }

    /** Turned off: Firebase forgets this phone's token and makes no new one. */
    fun stop(context: Context) {
        if (!isConfigured() || FirebaseApp.getApps(context).isEmpty()) return
        try {
            val messaging = FirebaseMessaging.getInstance()
            messaging.isAutoInitEnabled = false
            messaging.deleteToken()
        } catch (e: RuntimeException) {
            // Nothing to undo: the server's key is what lets a wake-up be read, and it is gone or going.
        }
    }
}
