package com.seebuyget.driver

import android.net.Uri
import android.os.Bundle
import com.google.androidbrowserhelper.trusted.LauncherActivity
import com.seebuyget.driver.car.LaunchUrls

/**
 * 2026-11-02 — THE DRIVER WEB APP, FULL SCREEN: Google's Trusted Web Activity launcher, with two things of ours. Every
 * address it opens carries `app=android` (LaunchUrls), so the page knows it is inside the Play app — from the icon, a
 * link or a notification alike. And a car key whose phone token never reached the server is told again when the app is
 * opened.
 */
class DriverLauncherActivity : LauncherActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        CarMessages.registerIfWaiting(applicationContext)
    }

    override fun getLaunchingUrl(): Uri = Uri.parse(LaunchUrls.withAppFlag(super.getLaunchingUrl().toString()))
}
