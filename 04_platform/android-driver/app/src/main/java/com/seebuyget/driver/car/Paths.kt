package com.seebuyget.driver.car

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction

/**
 * 2026-11-02 — Percent-encoding, by hand and strictly. Android's own Uri is a stub in a JVM test, and URLEncoder writes a
 * space as `+` — right for a form, wrong in a path, and a `+` in a key would come back a space.
 */
internal object Paths {
    private const val HEX = "0123456789ABCDEF"

    private fun unreserved(c: Int): Boolean =
        (c in 'A'.code..'Z'.code) || (c in 'a'.code..'z'.code) || (c in '0'.code..'9'.code) ||
            c == '-'.code || c == '.'.code || c == '_'.code || c == '~'.code

    /** Everything but A–Z a–z 0–9 - . _ ~ as %XX of its UTF-8 bytes: safe in a path segment and in a query value. */
    fun encode(value: String): String {
        val out = StringBuilder(value.length + 8)
        for (b in value.toByteArray(Charsets.UTF_8)) {
            val c = b.toInt() and 0xFF
            if (unreserved(c)) {
                out.append(c.toChar())
            } else {
                out.append('%').append(HEX[c shr 4]).append(HEX[c and 0xF])
            }
        }
        return out.toString()
    }

    /** %XX back to text; null when it is not well-formed percent-encoding of UTF-8. A `+` stays a `+`. */
    fun decode(value: String): String? {
        val bytes = ByteArrayOutputStream(value.length)
        val plain = StringBuilder()
        fun flush() {
            if (plain.isNotEmpty()) {
                val b = plain.toString().toByteArray(Charsets.UTF_8)
                bytes.write(b, 0, b.size)
                plain.setLength(0)
            }
        }
        var i = 0
        while (i < value.length) {
            val c = value[i]
            if (c == '%') {
                if (i + 2 >= value.length) return null
                val hi = value[i + 1].digitToIntOrNull(16) ?: return null
                val lo = value[i + 2].digitToIntOrNull(16) ?: return null
                flush()
                bytes.write(hi * 16 + lo)
                i += 3
            } else {
                plain.append(c)
                i++
            }
        }
        flush()
        val decoder = Charsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
        return try {
            decoder.decode(ByteBuffer.wrap(bytes.toByteArray())).toString()
        } catch (e: CharacterCodingException) {
            null
        }
    }
}
