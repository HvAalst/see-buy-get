package com.seebuyget.driver

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import androidx.core.content.ContextCompat
import com.seebuyget.driver.car.AfterReply
import com.seebuyget.driver.car.CarContract
import com.seebuyget.driver.car.ChatLine
import com.seebuyget.driver.car.ChatNotification
import com.seebuyget.driver.car.ChatNotifications
import com.seebuyget.driver.car.From
import com.seebuyget.driver.car.Refusal

/**
 * 2026-11-02 — THE NOTIFICATION THE CAR READS ALOUD. Android Auto reads a messaging notification when it is built the
 * way Google's messaging category asks (developer.android.com/training/cars/communication/notification-messaging):
 *
 *   - a MessagingStyle, one per conversation, the sender a Person by the name the chat shows, the conversation titled
 *     by the load ("FRT-7781 · Roses"), not a group conversation, CATEGORY_MESSAGE;
 *   - Reply: one RemoteInput, SEMANTIC_ACTION_REPLY, showing no screen — the car takes the words by voice and reads
 *     them back before they go; handled in the background by CarActionReceiver;
 *   - Mark as read: SEMANTIC_ACTION_MARK_AS_READ, showing no screen, invisible on the phone.
 *
 * The car adds its own Play and Mute and draws nothing else of ours: conversations only, never "Accept the load".
 */
object ChatNotifier {
    const val CHANNEL = "car_messages"
    const val ACTION_REPLY = "com.seebuyget.driver.action.CAR_REPLY"
    const val ACTION_READ = "com.seebuyget.driver.action.CAR_READ"
    const val EXTRA_CONVERSATION = "conversationId"
    const val EXTRA_READ_UP_TO = "readUpTo"
    const val EXTRA_TITLE = "title"
    const val REPLY_KEY = "car_reply"

    /** One notification per conversation: the same id, the conversation in the tag. */
    private const val ID = 7781
    private const val TAG_PREFIX = "chat:"
    private const val KEY_ME = "me"
    private const val KEY_APP = "seebuyget"
    private const val KEY_THEM = "them:"
    private const val REQUEST_OPEN = 1
    private const val REQUEST_REPLY = 2
    private const val REQUEST_READ = 3

    /** "Messages in the car", high importance: a message the driver should hear when it comes. */
    fun createChannel(context: Context) {
        val channel = NotificationChannelCompat.Builder(CHANNEL, NotificationManagerCompat.IMPORTANCE_HIGH)
            .setName(context.getString(R.string.channel_messages))
            .setDescription(context.getString(R.string.channel_messages_description))
            .build()
        NotificationManagerCompat.from(context).createNotificationChannel(channel)
    }

    fun words(context: Context): ChatNotifications.Words = ChatNotifications.Words(
        me = context.getString(R.string.chat_me),
        someone = context.getString(R.string.chat_someone),
        untitled = context.getString(R.string.chat_untitled),
        closed = context.getString(R.string.chat_closed),
        app = context.getString(R.string.chat_system),
    )

    /** "Not sent: …", as the car reads it. */
    fun notSent(context: Context, refusal: Refusal): String {
        val why = when (refusal) {
            Refusal.KeyOff -> context.getString(R.string.refused_key_off)
            Refusal.NoSignal -> context.getString(R.string.refused_no_signal)
            Refusal.TooMany -> context.getString(R.string.refused_too_many)
            Refusal.NothingHeard -> context.getString(R.string.refused_nothing_heard)
            Refusal.ServerTrouble -> context.getString(R.string.refused_server)
            Refusal.Refused -> context.getString(R.string.refused_plain)
            is Refusal.Said -> refusal.detail
        }
        return context.getString(R.string.not_sent, why)
    }

    /** A chat's unread messages: posted, alerting, so the car announces them. */
    fun show(context: Context, n: ChatNotification) {
        val style = NotificationCompat.MessagingStyle(person(n.selfName, KEY_ME))
            .setConversationTitle(n.title)
            .setGroupConversation(false)
        val people = HashMap<String, Person>()
        for (line in n.lines) style.addMessage(message(line, people))
        post(context, n.conversationId, style, n.title, n.readUpTo, n.canReply, alert = true)
    }

    /**
     * After a spoken reply: the line joins the notification showing (and the phone's spinner on it stops). Sent, and no
     * notification showing: nothing to do. Not sent, and none showing: a new one says so, so the car still reads it.
     */
    fun afterReply(context: Context, conversationId: String, title: String, readUpTo: Long?, canReply: Boolean, after: AfterReply) {
        val showing = active(context, conversationId)?.let {
            NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(it)
        }
        val style = when {
            showing != null -> showing
            after.alert -> NotificationCompat.MessagingStyle(person(words(context).me, KEY_ME))
                .setConversationTitle(title)
                .setGroupConversation(false)
            else -> return
        }
        style.addMessage(message(after.line, HashMap()))
        post(context, conversationId, style, title, readUpTo, canReply, alert = after.alert)
    }

    fun cancel(context: Context, conversationId: String) {
        NotificationManagerCompat.from(context).cancel(TAG_PREFIX + conversationId, ID)
    }

    /** Every chat's notification taken away — the web app's own notices are left as they are. */
    fun cancelAll(context: Context) {
        val compat = NotificationManagerCompat.from(context)
        for (n in activeChats(context)) compat.cancel(n.tag, ID)
    }

    private fun person(name: String, key: String): Person = Person.Builder().setName(name).setKey(key).build()

    private fun message(line: ChatLine, people: MutableMap<String, Person>): NotificationCompat.MessagingStyle.Message {
        // A message by the driver has no Person: MessagingStyle shows it as the user's own.
        val sender: Person? = when (line.from) {
            From.ME -> null
            From.THEM -> people.getOrPut(KEY_THEM + line.name) { person(line.name, KEY_THEM + line.name) }
            From.APP -> people.getOrPut(KEY_APP) { person(line.name, KEY_APP) }
        }
        return NotificationCompat.MessagingStyle.Message(line.text, line.atMillis, sender)
    }

    private fun post(
        context: Context,
        conversationId: String,
        style: NotificationCompat.MessagingStyle,
        title: String,
        readUpTo: Long?,
        canReply: Boolean,
        alert: Boolean,
    ) {
        if (!allowed(context)) return
        val builder = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_message)
            .setColor(ContextCompat.getColor(context, R.color.sbg_orange))
            .setStyle(style)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            // A reply that went is added quietly; anything new, or a reply that did not go, is spoken.
            .setOnlyAlertOnce(!alert)
            .setAutoCancel(true)
            .setContentIntent(openChat(context, conversationId))
        if (canReply) builder.addAction(replyAction(context, conversationId, title, readUpTo))
        if (readUpTo != null) builder.addInvisibleAction(readAction(context, conversationId, readUpTo))
        try {
            NotificationManagerCompat.from(context).notify(TAG_PREFIX + conversationId, ID, builder.build())
        } catch (e: SecurityException) {
            // Notifications were refused between the check and the post: nothing to show it with.
        }
    }

    /** Android 13 and up asks the driver first (CarLinkActivity does, when it is turned on). */
    private fun allowed(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    /** Tapped on the phone: the Driver app, at that chat. */
    private fun openChat(context: Context, conversationId: String): PendingIntent {
        val intent = Intent(context, DriverLauncherActivity::class.java)
            .setAction(Intent.ACTION_VIEW)
            .setData(Uri.parse(CarContract.chatUrl(BuildConfig.SBG_HOST, conversationId)))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return PendingIntent.getActivity(context, REQUEST_OPEN, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    /**
     * The intent of an action, told apart per conversation by its data (a PendingIntent is the same one when only its
     * extras differ). Explicit, to this app's receiver only.
     */
    private fun actionIntent(context: Context, action: String, conversationId: String): Intent =
        Intent(context, CarActionReceiver::class.java)
            .setAction(action)
            .setData(Uri.Builder().scheme(CarContract.LINK_SCHEME).authority("chat").appendPath(conversationId).build())
            .putExtra(EXTRA_CONVERSATION, conversationId)

    private fun replyAction(context: Context, conversationId: String, title: String, readUpTo: Long?): NotificationCompat.Action {
        val intent = actionIntent(context, ACTION_REPLY, conversationId).putExtra(EXTRA_TITLE, title)
        if (readUpTo != null) intent.putExtra(EXTRA_READ_UP_TO, readUpTo)
        // The words are written into the intent by the system: it must be mutable (Android 12 and up ask to be told).
        val mutable = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
        val pending = PendingIntent.getBroadcast(context, REQUEST_REPLY, intent, PendingIntent.FLAG_UPDATE_CURRENT or mutable)
        val input = RemoteInput.Builder(REPLY_KEY)
            .setLabel(context.getString(R.string.reply_label))
            .build()
        return NotificationCompat.Action.Builder(R.drawable.ic_reply, context.getString(R.string.action_reply), pending)
            .addRemoteInput(input)
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
            .setShowsUserInterface(false)
            .build()
    }

    private fun readAction(context: Context, conversationId: String, readUpTo: Long): NotificationCompat.Action {
        val intent = actionIntent(context, ACTION_READ, conversationId).putExtra(EXTRA_READ_UP_TO, readUpTo)
        val pending = PendingIntent.getBroadcast(context, REQUEST_READ, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Action.Builder(R.drawable.ic_done, context.getString(R.string.action_mark_read), pending)
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
            .setShowsUserInterface(false)
            .build()
    }

    private fun active(context: Context, conversationId: String): Notification? =
        activeChats(context).firstOrNull { it.tag == TAG_PREFIX + conversationId }?.notification

    private fun activeChats(context: Context): List<android.service.notification.StatusBarNotification> = try {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.activeNotifications.filter { it.id == ID && (it.tag ?: "").startsWith(TAG_PREFIX) }
    } catch (e: RuntimeException) {
        emptyList()
    }
}
