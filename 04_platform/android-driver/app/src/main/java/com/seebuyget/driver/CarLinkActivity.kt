package com.seebuyget.driver

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationManagerCompat
import com.seebuyget.driver.car.CarLink
import com.seebuyget.driver.car.CarLinks
import com.seebuyget.driver.car.Refusal

/**
 * 2026-11-02 — TURNING MESSAGES IN THE CAR ON OR OFF FOR THIS PHONE. The web page's Settings makes a car key on the
 * server and hands it here through `sbgdriver://car-link?key=…`; this keeps it encrypted (CarKeyStore), asks for
 * notifications on Android 13 and up — the moment the driver has just asked for them — gets the phone's Firebase token
 * and tells the server where to wake it. Then it says "On for this phone" and goes back to the Driver app by itself.
 * `sbgdriver://car-unlink` forgets it all here.
 *
 * A short dialog and nothing more: everything else about the setting is the web page's.
 */
class CarLinkActivity : Activity() {
    private lateinit var status: TextView
    private var closing = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(layout())
        when (val link = CarLinks.parse(intent?.dataString)) {
            is CarLink.TurnOn -> turnOn(link.key)
            is CarLink.TurnOff -> turnOff()
            is CarLink.NotOurs -> say(getString(R.string.link_not_ours))
        }
    }

    private fun turnOn(key: String) {
        if (!CarMessages.carPossible()) return say(getString(R.string.link_old_android))
        if (!Push.isConfigured()) return say(getString(R.string.link_not_ready))
        if (!CarKeyStore(this).keep(key)) return say(getString(R.string.link_not_kept))
        say(getString(R.string.link_turning_on))
        if (needsNotificationPermission()) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), ASK_NOTIFICATIONS)
        } else {
            register()
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        // Allowed or not, the phone is registered: the driver can allow notifications later in the phone's settings.
        if (requestCode == ASK_NOTIFICATIONS) register()
    }

    private fun register() {
        val app = applicationContext
        Push.token(app) { token ->
            if (token == null) {
                say(getString(R.string.link_no_token))
            } else {
                CarMessages.inBackground {
                    val refusal = CarMessages.registerToken(app, token)
                    runOnUiThread { registered(refusal) }
                }
            }
        }
    }

    private fun registered(refusal: Refusal?) {
        when (refusal) {
            null -> {
                val canShow = NotificationManagerCompat.from(this).areNotificationsEnabled()
                if (canShow) {
                    say(getString(R.string.link_on), closeSoon = true)
                } else {
                    say(getString(R.string.link_notifications_off))
                }
            }
            Refusal.KeyOff -> say(getString(R.string.link_key_refused))
            Refusal.NoSignal -> say(getString(R.string.link_no_signal))
            is Refusal.Said -> say(getString(R.string.link_refused, refusal.detail))
            else -> say(getString(R.string.link_server))
        }
    }

    private fun turnOff() {
        CarMessages.forget(applicationContext)
        say(getString(R.string.link_off), closeSoon = true)
    }

    private fun needsNotificationPermission(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED

    private fun say(text: String, closeSoon: Boolean = false) {
        if (isFinishing || isDestroyed) return
        status.text = text
        if (closeSoon && !closing) {
            closing = true
            status.postDelayed({ if (!isFinishing) finish() }, CLOSE_AFTER_MS)
        }
    }

    /** Built in code: one title, one sentence, one button — no layout file for a dialog this small. */
    private fun layout(): View {
        val pad = (24 * resources.displayMetrics.density).toInt()
        val root = LinearLayout(this)
        root.orientation = LinearLayout.VERTICAL
        root.setPadding(pad, pad, pad, pad / 2)

        val title = TextView(this)
        title.text = getString(R.string.link_title)
        title.textSize = 20f
        title.typeface = Typeface.DEFAULT_BOLD
        title.setTextColor(getColor(R.color.sbg_navy))

        status = TextView(this)
        status.textSize = 16f
        status.setTextColor(getColor(R.color.sbg_ink))
        status.setPadding(0, pad / 2, 0, pad / 2)

        val back = Button(this)
        back.text = getString(R.string.link_back)
        back.setOnClickListener { finish() }

        root.addView(title)
        root.addView(status)
        root.addView(back)
        return root
    }

    private companion object {
        const val ASK_NOTIFICATIONS = 1
        const val CLOSE_AFTER_MS = 2_500L
    }
}
