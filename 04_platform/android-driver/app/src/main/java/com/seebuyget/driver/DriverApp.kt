package com.seebuyget.driver

import android.app.Application

/**
 * 2026-11-02 — The app starting: Firebase started by hand (when the build carries its settings), and the "Messages in
 * the car" notification channel made, before any wake-up or link can need them.
 */
class DriverApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Push.start(this)
        ChatNotifier.createChannel(this)
    }
}
