package com.seebuyget.driver

import android.content.Context
import android.os.Build
import com.seebuyget.driver.car.CarChats
import com.seebuyget.driver.car.CarContract
import com.seebuyget.driver.car.CarReplies
import com.seebuyget.driver.car.CarRequests
import com.seebuyget.driver.car.ChatNotifications
import com.seebuyget.driver.car.HttpOutcome
import com.seebuyget.driver.car.Refusal
import com.seebuyget.driver.car.ReplyLines
import com.seebuyget.driver.car.ReplyOutcome
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * 2026-11-02 — MESSAGES IN THE CAR, THE WORK ITSELF: a wake-up turned into a notification, a spoken reply sent, a chat
 * marked read, the phone's token told to the server. Every call here goes to the network and waits for it, so none is
 * ever made on the main thread: Firebase calls its service on a thread of its own, and the rest goes through
 * inBackground — one thread, so a reply and the mark-as-read after it go in the order they were made.
 *
 * A car key the server no longer accepts (401) is forgotten here at once, with its token and its notifications: the
 * driver turned it off elsewhere, or the phone was forgotten, and the car must not keep reading.
 */
object CarMessages {
    private val worker: ExecutorService = Executors.newSingleThreadExecutor()

    fun inBackground(work: () -> Unit) {
        worker.execute(work)
    }

    /** Android Auto needs Android 9 or newer on the phone; the web app does not. */
    fun carPossible(): Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P

    fun requests(): CarRequests =
        CarRequests(BuildConfig.SBG_HOST, "SeeBuyGetDriver/${BuildConfig.VERSION_NAME} (Android ${Build.VERSION.RELEASE})")

    /** A wake-up for this chat: its unread messages shown, or — nothing unread any more — its notification taken away. */
    fun refresh(context: Context, conversationId: String) {
        if (!CarContract.isConversationId(conversationId)) return
        val key = CarKeyStore(context).key() ?: return
        val answer = HttpTransport.send(requests().chat(key, conversationId))
        if (answer is HttpOutcome.Answer && answer.status == 404) {
            // Not this driver's chat, or not one any more: nothing of it is shown.
            ChatNotifier.cancel(context, conversationId)
            return
        }
        when (CarReplies.refusal(answer)) {
            null -> {
                val chat = CarChats.parse(conversationId, (answer as? HttpOutcome.Answer)?.body) ?: return
                val shown = ChatNotifications.from(chat, ChatNotifier.words(context), System.currentTimeMillis())
                if (shown == null) ChatNotifier.cancel(context, conversationId) else ChatNotifier.show(context, shown)
            }
            Refusal.KeyOff -> forget(context)
            // No signal, or a fault: what is on the screen stays, and the next wake-up tries again.
            else -> Unit
        }
    }

    /** A spoken reply, sent as text; the notification then says it went, or why it did not. */
    fun reply(context: Context, conversationId: String, title: String?, readUpTo: Long?, text: String?) {
        val key = CarKeyStore(context).key()
        val outcome = when {
            text == null -> ReplyOutcome.NotSent(Refusal.NothingHeard)
            key == null -> ReplyOutcome.NotSent(Refusal.KeyOff)
            else -> CarReplies.outcome(text, HttpTransport.send(requests().reply(key, conversationId, text)))
        }
        // Answering a chat is having heard it: marked read up to what the car showed, as opening it would.
        if (outcome is ReplyOutcome.Sent && key != null && readUpTo != null) {
            HttpTransport.send(requests().markRead(key, conversationId, readUpTo))
        }
        val keyOff = outcome is ReplyOutcome.NotSent && outcome.refusal == Refusal.KeyOff
        if (keyOff) forget(context)

        val words = ChatNotifier.words(context)
        val after = ReplyLines.after(outcome, words.me, words.app, { ChatNotifier.notSent(context, it) }, System.currentTimeMillis())
        ChatNotifier.afterReply(context, conversationId, title ?: words.untitled, readUpTo, canReply = !keyOff, after = after)
    }

    /** "Mark as read": the notification is already gone; the server is told. */
    fun markRead(context: Context, conversationId: String, readUpTo: Long?) {
        if (readUpTo == null) return
        val key = CarKeyStore(context).key() ?: return
        val answer = HttpTransport.send(requests().markRead(key, conversationId, readUpTo))
        if (CarReplies.refusal(answer) == Refusal.KeyOff) forget(context)
    }

    /** Tell the server where Firebase reaches this phone. Null when it took it; otherwise why not. */
    fun registerToken(context: Context, token: String): Refusal? {
        val store = CarKeyStore(context)
        val key = store.key() ?: return Refusal.KeyOff
        val refusal = CarReplies.refusal(HttpTransport.send(requests().registerToken(key, token)))
        when (refusal) {
            null -> store.markRegistered()
            Refusal.KeyOff -> forget(context)
            else -> Unit
        }
        return refusal
    }

    /**
     * A key kept whose token never reached the server (no signal when it was turned on): told again when the app is
     * opened, quietly. Signal comes and goes on the road; the driver should not have to turn it on twice.
     */
    fun registerIfWaiting(context: Context) {
        if (!carPossible() || !Push.isConfigured()) return
        val store = CarKeyStore(context)
        if (store.registered()) return
        val app = context.applicationContext
        inBackground {
            if (store.key() == null) return@inBackground
            Push.token(app) { token ->
                if (token != null) inBackground { registerToken(app, token) }
            }
        }
    }

    /** Off on this phone: the key, the token and every chat's notification gone. */
    fun forget(context: Context) {
        CarKeyStore(context).clear()
        Push.stop(context)
        ChatNotifier.cancelAll(context)
    }
}
