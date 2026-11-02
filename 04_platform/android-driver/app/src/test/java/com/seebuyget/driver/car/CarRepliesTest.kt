package com.seebuyget.driver.car

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 2026-11-02 — A spoken reply, after the server answered: sent, or not sent and why — in the server's own words where
 * it gave them (RFC 9457 problem+json, problem.filter.ts), plainly where the car can do nothing about it.
 */
class CarRepliesTest {
    private fun problem(status: Int, detail: String, code: String = "CONFLICT") =
        HttpOutcome.Answer(status, """{"type":"https://glos.dev/problems/$code","title":"t","status":$status,"code":"$code","detail":${Json.quote(detail)},"message":${Json.quote(detail)},"retryable":false}""")

    @Test
    fun `taken is sent`() {
        assertEquals(ReplyOutcome.Sent("On my way"), CarReplies.outcome("On my way", HttpOutcome.Answer(201, """{"sent":true,"seq":15,"at":"2026-11-02T09:40:00Z","via":"car"}""")))
        assertEquals(ReplyOutcome.Sent("Sawa"), CarReplies.outcome("Sawa", HttpOutcome.Answer(200, null)))
    }

    @Test
    fun `a refusal is said in the server's words`() {
        val closed = CarReplies.outcome("Hello", problem(409, "This conversation is closed."))
        assertEquals(ReplyOutcome.NotSent(Refusal.Said("This conversation is closed.")), closed)
        val tooLong = CarReplies.outcome("x", problem(400, "A message is at most 2000 characters.", "VALIDATION_FAILED"))
        assertEquals(ReplyOutcome.NotSent(Refusal.Said("A message is at most 2000 characters.")), tooLong)
        val onlyMessage = HttpOutcome.Answer(403, """{"message":"You blocked this conversation."}""")
        assertEquals(Refusal.Said("You blocked this conversation."), CarReplies.refusal(onlyMessage))
    }

    @Test
    fun `a key that opens nothing any more is off`() {
        assertEquals(ReplyOutcome.NotSent(Refusal.KeyOff), CarReplies.outcome("Hi", problem(401, "That is not a car key.", "UNAUTHORIZED")))
        assertEquals(Refusal.KeyOff, CarReplies.refusal(HttpOutcome.Answer(401, null)))
    }

    @Test
    fun `what the car cannot fix is said plainly`() {
        assertEquals(Refusal.NoSignal, CarReplies.refusal(HttpOutcome.NoAnswer))
        assertEquals(Refusal.TooMany, CarReplies.refusal(problem(429, "Too many requests", "RATE_LIMITED")))
        assertEquals(Refusal.ServerTrouble, CarReplies.refusal(problem(500, "Something went wrong", "INTERNAL")))
        assertEquals(Refusal.ServerTrouble, CarReplies.refusal(HttpOutcome.Answer(502, "<html>Bad gateway</html>")))
        assertEquals(Refusal.ServerTrouble, CarReplies.refusal(HttpOutcome.Answer(302, null)))
        assertEquals(Refusal.Refused, CarReplies.refusal(HttpOutcome.Answer(400, null)))
        assertEquals(Refusal.Refused, CarReplies.refusal(HttpOutcome.Answer(404, "Not found")))
        assertEquals(Refusal.Refused, CarReplies.refusal(HttpOutcome.Answer(422, """{"detail":"   "}""")))
        assertNull(CarReplies.refusal(HttpOutcome.Answer(204, null)))
    }

    @Test
    fun `the server's words are cleaned before the car reads them`() {
        assertEquals("Closed for now. Try later.", CarReplies.detail("""{"detail":"Closed\n\tfor   now.\r\nTry later."}"""))
        val long = CarReplies.detail("""{"detail":"${"word ".repeat(100)}"}""")!!
        assertTrue(long.length <= 200)
        assertTrue(long.endsWith("…"))
        assertNull(CarReplies.detail("""{"detail":null}"""))
        assertNull(CarReplies.detail("""{"detail":42}"""))
    }

    @Test
    fun `what the car heard is trimmed, and nothing heard is nothing sent`() {
        assertEquals("On my way", CarReplies.prepare("  On my way \n"))
        assertNull(CarReplies.prepare("   "))
        assertNull(CarReplies.prepare(""))
        assertNull(CarReplies.prepare(null))
    }
}
