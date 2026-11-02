package com.seebuyget.driver.car

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant
import java.time.OffsetDateTime

/** 2026-11-02 — The hand-made ISO reader agrees with java.time (which the JVM has, and Android 7 does not). */
class IsoTimeTest {
    @Test
    fun `times in UTC agree with java time`() {
        val times = listOf(
            "2026-11-02T09:30:00.000Z",
            "2026-11-02T09:30:00Z",
            "2026-11-02T09:30:00.123Z",
            "1970-01-01T00:00:00Z",
            "1969-12-31T23:59:59Z",
            "2024-02-29T23:59:59.999Z",
            "2000-03-01T00:00:00Z",
            "2100-12-31T12:00:00Z",
        )
        for (t in times) assertEquals(t, Instant.parse(t).toEpochMilli(), IsoTime.millis(t))
    }

    @Test
    fun `an offset is taken off`() {
        for (t in listOf("2026-11-02T12:30:00+03:00", "2026-11-02T04:30:00-05:00", "2026-11-02T09:30:00.5+00:00")) {
            assertEquals(t, OffsetDateTime.parse(t).toInstant().toEpochMilli(), IsoTime.millis(t))
        }
        assertEquals(IsoTime.millis("2026-11-02T09:30:00Z"), IsoTime.millis("2026-11-02T12:30:00+0300"))
    }

    @Test
    fun `what is not a time is null`() {
        for (t in listOf(null, "", "yesterday", "2026-02-30T00:00:00Z", "2026-13-01T00:00:00Z", "2026-11-02T24:00:00Z", "2026-11-02", "2026-11-02T09:30:00+25:00")) {
            assertNull(t, IsoTime.millis(t))
        }
    }
}
