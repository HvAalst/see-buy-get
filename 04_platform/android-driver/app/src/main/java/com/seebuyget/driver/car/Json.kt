package com.seebuyget.driver.car

import org.json.JSONException
import org.json.JSONObject

/**
 * 2026-11-02 — JSON, written by hand (four small bodies, each a flat object) and read with org.json, which every phone
 * has. Reading goes through these helpers only, because Android's org.json and the one the JVM tests use part on the
 * edges — a JSON null read as a string is "null" on one and "" on the other — and here neither is ever asked.
 */
internal object Json {
    /** A flat object of strings, whole numbers, booleans and nulls. */
    fun obj(vararg fields: Pair<String, Any?>): String {
        val out = StringBuilder("{")
        fields.forEachIndexed { i, (name, value) ->
            if (i > 0) out.append(',')
            quote(out, name)
            out.append(':')
            when (value) {
                null -> out.append("null")
                is String -> quote(out, value)
                is Int, is Long, is Short, is Byte, is Boolean -> out.append(value.toString())
                else -> quote(out, value.toString())
            }
        }
        return out.append('}').toString()
    }

    fun quote(value: String): String = StringBuilder().also { quote(it, value) }.toString()

    private fun quote(out: StringBuilder, value: String) {
        out.append('"')
        for (c in value) {
            when (c) {
                '"' -> out.append("\\\"")
                '\\' -> out.append("\\\\")
                '\n' -> out.append("\\n")
                '\r' -> out.append("\\r")
                '\t' -> out.append("\\t")
                '\b' -> out.append("\\b")
                '\u000C' -> out.append("\\f")
                // Line and paragraph separators are legal JSON but break JavaScript that reads it: escaped.
                ' ', ' ' -> out.append(unicodeEscape(c))
                else -> if (c.code < 0x20) out.append(unicodeEscape(c)) else out.append(c)
            }
        }
        out.append('"')
    }

    /** A JSON unicode escape (backslash, u, four hex digits), by hand: a formatter may use the phone's own digits. */
    private fun unicodeEscape(c: Char): String = "\\u" + c.code.toString(16).padStart(4, '0')

    /** The body as an object; null when there is none or it is not an object. */
    fun read(body: String?): JSONObject? {
        if (body.isNullOrBlank()) return null
        return try {
            JSONObject(body)
        } catch (e: JSONException) {
            null
        }
    }

    /** A string field, trimmed; null when absent, JSON null, not a string, or blank. */
    fun text(obj: JSONObject, name: String): String? {
        if (!obj.has(name) || obj.isNull(name)) return null
        val value = obj.opt(name) as? String ?: return null
        return value.trim().takeIf { it.isNotEmpty() }
    }

    /** A whole-number field; null when absent or not a whole number. */
    fun long(obj: JSONObject, name: String): Long? {
        if (!obj.has(name) || obj.isNull(name)) return null
        return when (val value = obj.opt(name)) {
            is Int -> value.toLong()
            is Long -> value
            is Number -> value.toDouble().let { d -> if (d == Math.floor(d) && !d.isInfinite()) d.toLong() else null }
            is String -> value.trim().toLongOrNull()
            else -> null
        }
    }

    /** A boolean field; null when absent or not a boolean. */
    fun bool(obj: JSONObject, name: String): Boolean? {
        if (!obj.has(name) || obj.isNull(name)) return null
        return obj.opt(name) as? Boolean
    }
}
