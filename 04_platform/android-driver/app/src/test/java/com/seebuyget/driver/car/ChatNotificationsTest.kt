package com.seebuyget.driver.car

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 2026-11-02 — From the server's CarChatView (car.types.ts) to the notification the car reads: the order, the names,
 * the title, what "Mark as read" sends back, and the closed chat's last line.
 */
class ChatNotificationsTest {
    private val words = ChatNotifications.Words(
        me = "You",
        someone = "Someone in the chat",
        untitled = "A chat about a load",
        closed = "This conversation is closed.",
        app = "SeeBuyGet",
    )
    private val now = 1_800_000_000_000L

    /** An answer as car-messages.service.ts writes it. */
    private val answer = """
        {
          "conversationId": "cv_0011223344556677",
          "title": "FRT-7781 · Roses · Nakuru → Nairobi",
          "code": "FRT-7781",
          "label": "Roses · Nakuru → Nairobi",
          "from": "Mama Njeri Stores",
          "lang": "en",
          "unread": 3,
          "lastSeq": 14,
          "canReply": true,
          "messages": [
            { "seq": 12, "from": "Mama Njeri Stores", "text": "Gate 3, not gate 1", "kind": "text", "at": "2026-11-02T09:30:00.000Z" },
            { "seq": 11, "from": "Mama Njeri Stores", "text": "Where are you?", "kind": "text", "at": "2026-11-02T09:20:00.000Z" },
            { "seq": 13, "from": "Mama Njeri Stores", "text": "   ", "kind": "text", "at": "2026-11-02T09:31:00.000Z" }
          ]
        }
    """.trimIndent()

    @Test
    fun `the server's answer is read whole`() {
        val chat = CarChats.parse("cv_0011223344556677", answer)!!
        assertEquals("FRT-7781 · Roses · Nakuru → Nairobi", chat.title)
        assertEquals("Mama Njeri Stores", chat.from)
        assertTrue(chat.canReply)
        assertNull(chat.closed)
        assertEquals(3, chat.messages.size)
        assertEquals(IsoTime.millis("2026-11-02T09:30:00.000Z"), chat.messages[0].atMillis)
    }

    @Test
    fun `the messages are shown oldest first, blank ones left out, titled by the load`() {
        val n = ChatNotifications.from(CarChats.parse("cv_0011223344556677", answer)!!, words, now)!!
        assertEquals("cv_0011223344556677", n.conversationId)
        assertEquals("FRT-7781 · Roses · Nakuru → Nairobi", n.title)
        assertEquals("You", n.selfName)
        assertEquals(listOf("Where are you?", "Gate 3, not gate 1"), n.lines.map { it.text })
        assertTrue(n.lines.all { it.from == From.THEM && it.name == "Mama Njeri Stores" })
        assertTrue(n.canReply)
    }

    @Test
    fun `mark as read goes up to the newest message shown, never past it`() {
        val n = ChatNotifications.from(CarChats.parse("cv_0011223344556677", answer)!!, words, now)!!
        // seq 13 was blank and not shown; the chat's lastSeq is 14. The car showed 12.
        assertEquals(12L, n.readUpTo)
    }

    @Test
    fun `nothing unread is no notification`() {
        val empty = """{ "conversationId": "cv_1", "title": "FRT-1", "canReply": true, "messages": [] }"""
        assertNull(ChatNotifications.from(CarChats.parse("cv_1", empty)!!, words, now))
        val onlyBlank = """{ "conversationId": "cv_1", "messages": [ { "seq": 1, "text": "" } ] }"""
        assertNull(ChatNotifications.from(CarChats.parse("cv_1", onlyBlank)!!, words, now))
    }

    @Test
    fun `a closed chat says why as its last line, and offers no reply`() {
        val closed = """
            { "conversationId": "cv_1", "title": "FRT-1", "from": "The poster", "canReply": false,
              "closed": "You blocked this conversation.",
              "messages": [ { "seq": 4, "from": "The poster", "text": "Hello", "kind": "text", "at": "2026-11-02T09:00:00Z" } ] }
        """.trimIndent()
        val n = ChatNotifications.from(CarChats.parse("cv_1", closed)!!, words, now)!!
        assertFalse(n.canReply)
        assertEquals(2, n.lines.size)
        assertEquals(ChatLine(From.APP, "SeeBuyGet", "You blocked this conversation.", n.lines[0].atMillis), n.lines[1])
        assertEquals(4L, n.readUpTo)

        val noReason = closed.replace("\"closed\": \"You blocked this conversation.\",", "")
        assertEquals("This conversation is closed.", ChatNotifications.from(CarChats.parse("cv_1", noReason)!!, words, now)!!.lines.last().text)
    }

    @Test
    fun `missing names and titles fall back to the app's own words`() {
        val bare = """{ "messages": [ { "seq": 1, "text": "On my way", "at": "not a time" } ] }"""
        val n = ChatNotifications.from(CarChats.parse("cv_9", bare)!!, words, now)!!
        assertEquals("A chat about a load", n.title)
        assertEquals("Someone in the chat", n.lines[0].name)
        assertEquals(now, n.lines[0].atMillis)
        assertTrue("no canReply said is a reply offered", n.canReply)
    }

    @Test
    fun `only the newest messages are kept, each cut short when too long`() {
        val many = (1..40).joinToString(",") { """{ "seq": $it, "from": "P", "text": "message $it" }""" }
        val n = ChatNotifications.from(CarChats.parse("cv_1", """{ "messages": [ $many ] }""")!!, words, now)!!
        assertEquals(ChatNotifications.MAX_LINES, n.lines.size)
        assertEquals("message 40", n.lines.last().text)
        assertEquals("message 17", n.lines.first().text)

        val long = "x".repeat(5000)
        val cut = ChatNotifications.from(CarChats.parse("cv_1", """{ "messages": [ { "seq": 1, "text": "$long" } ] }""")!!, words, now)!!
        assertEquals(ChatNotifications.MAX_TEXT, cut.lines[0].text.length)
        assertTrue(cut.lines[0].text.endsWith("…"))
    }

    @Test
    fun `an answer about another chat, or none at all, is not read`() {
        assertNull(CarChats.parse("cv_other", answer))
        assertNull(CarChats.parse("cv_1", null))
        assertNull(CarChats.parse("cv_1", ""))
        assertNull(CarChats.parse("cv_1", "<html>Bad gateway</html>"))
        assertNull(CarChats.parse("cv_1", "[1, 2]"))
    }

    @Test
    fun `a message without its place in the chat is left out`() {
        val chat = CarChats.parse("cv_1", """{ "messages": [ { "text": "no seq" }, { "seq": "7", "text": "seq as text" }, "not an object" ] }""")!!
        assertEquals(listOf(7L), chat.messages.map { it.seq })
    }

    @Test
    fun `after a reply that went, it joins quietly as the driver's own`() {
        val after = ReplyLines.after(ReplyOutcome.Sent("On my way"), "You", "SeeBuyGet", { "Not sent: $it" }, now)
        assertEquals(AfterReply(ChatLine(From.ME, "You", "On my way", now), alert = false), after)
    }

    @Test
    fun `after a reply that did not go, the app says why and the car speaks up`() {
        val after = ReplyLines.after(
            ReplyOutcome.NotSent(Refusal.Said("This conversation is closed.")),
            "You",
            "SeeBuyGet",
            { r -> if (r is Refusal.Said) "Not sent: " + r.detail else "Not sent" },
            now,
        )
        assertEquals(From.APP, after.line.from)
        assertEquals("Not sent: This conversation is closed.", after.line.text)
        assertTrue(after.alert)
    }
}
