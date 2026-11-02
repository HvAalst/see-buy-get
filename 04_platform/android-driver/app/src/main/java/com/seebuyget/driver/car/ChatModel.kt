package com.seebuyget.driver.car

/** One unread message, as the server gives it for the car (car.types.ts, CarChatLine). */
data class CarChatLine(
    val seq: Long,
    /** Who it is from, as the chat names them to the driver. */
    val from: String?,
    /** What the car reads aloud: the words, a quick reply in the driver's language, or what to open the app for. */
    val text: String?,
    val kind: String?,
    val atMillis: Long?,
)

/** One chat's unread messages (car.types.ts, CarChatView), as far as the notification needs them. */
data class CarChat(
    val conversationId: String,
    /** The load's code and what it is: "FRT-7781 · Roses · Nakuru → Nairobi". */
    val title: String?,
    /** The other side, as the chat names them. */
    val from: String?,
    val canReply: Boolean,
    /** Why a reply cannot go, in the driver's language: what the car says instead of offering Reply. */
    val closed: String?,
    val messages: List<CarChatLine>,
)

/** Who a line of the notification is from. */
enum class From {
    /** The other side of the chat. */
    THEM,

    /** The driver: a reply sent from the car. */
    ME,

    /** This app, saying something the car must read: "Not sent: …", "This conversation is closed." */
    APP,
}

data class ChatLine(val from: From, val name: String, val text: String, val atMillis: Long)

/** The notification for one chat, decided before any Android class is touched (ChatNotifier draws it). */
data class ChatNotification(
    val conversationId: String,
    val title: String,
    val selfName: String,
    val lines: List<ChatLine>,
    /** The newest message shown: what "Mark as read" sends back — never past what the car read. Null: nothing to mark. */
    val readUpTo: Long?,
    val canReply: Boolean,
)

/** What the line after a spoken reply says, and whether the car should speak up for it. */
data class AfterReply(val line: ChatLine, val alert: Boolean)

/** 2026-11-02 — The chat's answer, read leniently: a field missing is a field missing, never a crash. */
object CarChats {
    /** The chat, or null when the answer is unreadable or is about another chat than the one asked for. */
    fun parse(askedFor: String, body: String?): CarChat? {
        val obj = Json.read(body) ?: return null
        val id = Json.text(obj, CarContract.Fields.CONVERSATION_ID) ?: askedFor
        if (id != askedFor) return null
        val list = obj.optJSONArray(CarContract.Fields.MESSAGES)
        val messages = ArrayList<CarChatLine>()
        if (list != null) {
            for (i in 0 until list.length()) {
                val m = list.optJSONObject(i) ?: continue
                val seq = Json.long(m, CarContract.Fields.SEQ) ?: continue
                messages.add(
                    CarChatLine(
                        seq = seq,
                        from = Json.text(m, CarContract.Fields.FROM),
                        text = Json.text(m, CarContract.Fields.TEXT),
                        kind = Json.text(m, CarContract.Fields.KIND),
                        atMillis = IsoTime.millis(Json.text(m, CarContract.Fields.AT)),
                    ),
                )
            }
        }
        return CarChat(
            conversationId = id,
            title = Json.text(obj, CarContract.Fields.TITLE),
            from = Json.text(obj, CarContract.Fields.FROM),
            // Absent, a reply is offered: the server refuses it if it must, and the car says why.
            canReply = Json.bool(obj, CarContract.Fields.CAN_REPLY) ?: true,
            closed = Json.text(obj, CarContract.Fields.CLOSED),
            messages = messages,
        )
    }
}

/**
 * 2026-11-02 — FROM THE CHAT TO WHAT THE CAR READS. The newest messages in the order they were written, each from the
 * person the chat names; nothing blank; a message too long for a notification cut short with "…" (the app has it whole).
 * A chat that cannot be answered says so as its last line, because the car offers no Reply for it. Nothing unread:
 * no notification (null), and the one showing is taken away.
 */
object ChatNotifications {
    /** MessagingStyle keeps 25 messages; one place is kept for the line that says the chat is closed. */
    const val MAX_LINES = 24
    const val MAX_TEXT = 1000

    /** The few words of the app's own the notification needs, in the phone's language (strings.xml). */
    data class Words(
        val me: String,
        val someone: String,
        val untitled: String,
        val closed: String,
        val app: String,
    )

    fun from(chat: CarChat, words: Words, nowMillis: Long): ChatNotification? {
        val shown = chat.messages
            .filter { !it.text.isNullOrBlank() }
            .distinctBy { it.seq }
            .sortedBy { it.seq }
            .takeLast(MAX_LINES)
        if (shown.isEmpty()) return null

        val lines = ArrayList<ChatLine>(shown.size + 1)
        for (m in shown) {
            val name = m.from ?: chat.from ?: words.someone
            lines.add(ChatLine(From.THEM, name, cut(m.text.orEmpty().trim()), m.atMillis ?: nowMillis))
        }
        if (!chat.canReply) {
            lines.add(ChatLine(From.APP, words.app, chat.closed ?: words.closed, lines.last().atMillis))
        }
        return ChatNotification(
            conversationId = chat.conversationId,
            title = chat.title ?: words.untitled,
            selfName = words.me,
            lines = lines,
            readUpTo = shown.last().seq,
            canReply = chat.canReply,
        )
    }

    private fun cut(text: String): String =
        if (text.length <= MAX_TEXT) text else text.substring(0, MAX_TEXT - 1).trimEnd() + "…"
}

/**
 * 2026-11-02 — AFTER A SPOKEN REPLY, the notification is updated, or the phone keeps a spinner on it. Sent: the reply
 * joins the conversation as the driver's own, quietly. Not sent: a line from the app the car reads aloud — "Not sent:
 * this conversation is closed." — so a driver who cannot look still learns it did not go.
 */
object ReplyLines {
    fun after(outcome: ReplyOutcome, me: String, app: String, notSent: (Refusal) -> String, nowMillis: Long): AfterReply =
        when (outcome) {
            is ReplyOutcome.Sent -> AfterReply(ChatLine(From.ME, me, outcome.text, nowMillis), alert = false)
            is ReplyOutcome.NotSent -> AfterReply(ChatLine(From.APP, app, notSent(outcome.refusal), nowMillis), alert = true)
        }
}
