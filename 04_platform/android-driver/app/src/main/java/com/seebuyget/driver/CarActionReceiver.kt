package com.seebuyget.driver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput
import com.seebuyget.driver.car.CarContract
import com.seebuyget.driver.car.CarReplies

/**
 * 2026-11-02 — REPLY AND MARK AS READ, from the car or the phone's notification, in the background: no screen opens,
 * because the driver is driving. The receiver is kept alive (goAsync) while the one background thread sends it.
 */
class CarActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val conversationId = intent.getStringExtra(ChatNotifier.EXTRA_CONVERSATION)
        if (conversationId == null || !CarContract.isConversationId(conversationId)) return
        val app = context.applicationContext
        val readUpTo = intent.getLongExtra(ChatNotifier.EXTRA_READ_UP_TO, -1L).takeIf { it >= 0 }

        when (intent.action) {
            ChatNotifier.ACTION_REPLY -> {
                val heard = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(ChatNotifier.REPLY_KEY)
                val text = CarReplies.prepare(heard)
                val title = intent.getStringExtra(ChatNotifier.EXTRA_TITLE)
                val done = goAsync()
                CarMessages.inBackground {
                    try {
                        CarMessages.reply(app, conversationId, title, readUpTo, text)
                    } finally {
                        done.finish()
                    }
                }
            }
            ChatNotifier.ACTION_READ -> {
                // Taken away at once: the car moves on to the next message, and the server is told behind it.
                ChatNotifier.cancel(app, conversationId)
                val done = goAsync()
                CarMessages.inBackground {
                    try {
                        CarMessages.markRead(app, conversationId, readUpTo)
                    } finally {
                        done.finish()
                    }
                }
            }
        }
    }
}
