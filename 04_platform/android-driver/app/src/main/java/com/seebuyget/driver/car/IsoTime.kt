package com.seebuyget.driver.car

/**
 * 2026-11-02 — "2026-11-02T09:30:00.000Z" to milliseconds, by hand. java.time is only on Android 8 and up, and this app
 * runs from Android 7; the server writes ISO 8601 in UTC (`toISOString()`), and an offset is read too.
 */
object IsoTime {
    private val SHAPE = Regex(
        """^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?(Z|z|[+-]\d{2}(?::?\d{2})?)?$""",
    )

    /** Milliseconds since 1970 in UTC, or null when it is not such a time. A time without a zone is taken as UTC. */
    fun millis(text: String?): Long? {
        val m = SHAPE.matchEntire(text?.trim() ?: return null) ?: return null
        val g = m.groupValues
        val year = g[1].toInt()
        val month = g[2].toInt()
        val day = g[3].toInt()
        val hour = g[4].toInt()
        val minute = g[5].toInt()
        val second = if (g[6].isEmpty()) 0 else g[6].toInt()
        val millis = if (g[7].isEmpty()) 0 else g[7].padEnd(3, '0').substring(0, 3).toInt()
        if (month !in 1..12 || day !in 1..daysIn(year, month)) return null
        if (hour > 23 || minute > 59 || second > 59) return null

        val offsetMinutes = zoneMinutes(g[8]) ?: return null
        val days = daysFromCivil(year, month, day)
        val seconds = ((days * 24 + hour) * 60 + minute) * 60 + second
        return seconds * 1000 + millis - offsetMinutes * 60_000L
    }

    private fun zoneMinutes(zone: String): Long? {
        if (zone.isEmpty() || zone == "Z" || zone == "z") return 0L
        val sign = if (zone[0] == '-') -1L else 1L
        val digits = zone.substring(1).replace(":", "")
        val hours = digits.substring(0, 2).toInt()
        val minutes = if (digits.length >= 4) digits.substring(2, 4).toInt() else 0
        if (hours > 18 || minutes > 59) return null
        return sign * (hours * 60L + minutes)
    }

    private fun leap(year: Int): Boolean = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0

    private fun daysIn(year: Int, month: Int): Int = when (month) {
        2 -> if (leap(year)) 29 else 28
        4, 6, 9, 11 -> 30
        else -> 31
    }

    /** Days since 1970-01-01 of a date in the proleptic Gregorian calendar (Howard Hinnant's days_from_civil). */
    private fun daysFromCivil(year: Int, month: Int, day: Int): Long {
        val y = (if (month <= 2) year - 1 else year).toLong()
        val era = (if (y >= 0) y else y - 399) / 400
        val yearOfEra = y - era * 400
        val shift = if (month > 2) -3 else 9
        val monthIndex = (month + shift).toLong()
        val dayOfYear = (153 * monthIndex + 2) / 5 + day - 1
        val dayOfEra = yearOfEra * 365 + yearOfEra / 4 - yearOfEra / 100 + dayOfYear
        return era * 146097 + dayOfEra - 719468
    }
}
