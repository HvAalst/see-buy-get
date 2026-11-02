package com.seebuyget.driver

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.seebuyget.driver.car.CarContract

/**
 * 2026-11-02 — THE WAKE-UP. The server sends a content-free data message, `{ kind: 'chat', conversationId }` (fcm.ts):
 * "this chat has news", never a name or a word through Google's push service. The words are fetched from our server
 * with the car key, and the notification the car reads is posted from them.
 *
 * Firebase calls both methods on a thread of its own and gives a high-priority message about ten seconds: the fetch is
 * one short request (HttpTransport's timeouts).
 */
class DriverMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        // A new token for this phone: the server is told, if Messages in the car is on here.
        if (CarKeyStore(this).key() != null) CarMessages.registerToken(applicationContext, token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        if (data[CarContract.WAKE_KIND] != CarContract.WAKE_CHAT) return
        val conversationId = data[CarContract.WAKE_CONVERSATION] ?: return
        CarMessages.refresh(applicationContext, conversationId)
    }
}
