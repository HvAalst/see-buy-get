package com.seebuyget.driver

import com.seebuyget.driver.car.CarRequest
import com.seebuyget.driver.car.HttpOutcome
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * 2026-11-02 — SENDING A CarRequest, with the platform's own HttpURLConnection. Four small JSON calls do not need a
 * library: nothing more to keep up with each year, nothing more for Google's review to read, and nothing that can log a
 * header. https only; a redirect is not followed (the key is for one address); short timeouts, because a wake-up has
 * about ten seconds and a car does not wait. Nothing here is ever logged: not the key, not the token, not the words.
 */
object HttpTransport {
    private const val CONNECT_MS = 6_000
    private const val READ_MS = 8_000
    private const val MAX_BODY = 256 * 1024

    fun send(request: CarRequest): HttpOutcome {
        val url = try {
            URL(request.url)
        } catch (e: IOException) {
            return HttpOutcome.NoAnswer
        }
        if (url.protocol != "https") return HttpOutcome.NoAnswer

        var connection: HttpURLConnection? = null
        return try {
            val c = url.openConnection() as HttpURLConnection
            connection = c
            c.requestMethod = request.method
            c.connectTimeout = CONNECT_MS
            c.readTimeout = READ_MS
            c.instanceFollowRedirects = false
            c.useCaches = false
            for ((name, value) in request.headers) c.setRequestProperty(name, value)
            val body = request.body
            if (body != null) {
                val bytes = body.toByteArray(Charsets.UTF_8)
                c.doOutput = true
                c.setFixedLengthStreamingMode(bytes.size)
                c.outputStream.use { it.write(bytes) }
            }
            val status = c.responseCode
            val stream: InputStream? = if (status >= 400) c.errorStream else c.inputStream
            HttpOutcome.Answer(status, stream?.use { read(it) })
        } catch (e: IOException) {
            HttpOutcome.NoAnswer
        } catch (e: RuntimeException) {
            // A connection refused by the platform (no network permission, a security policy): no answer either.
            HttpOutcome.NoAnswer
        } finally {
            connection?.disconnect()
        }
    }

    /** The body as text, at most MAX_BODY bytes of it: an answer longer than that is not one of ours. */
    private fun read(input: InputStream): String {
        val out = ByteArrayOutputStream()
        val buffer = ByteArray(8 * 1024)
        var total = 0
        while (true) {
            val n = input.read(buffer)
            if (n < 0) break
            val room = MAX_BODY - total
            if (room <= 0) break
            val take = if (n < room) n else room
            out.write(buffer, 0, take)
            total += take
        }
        return String(out.toByteArray(), Charsets.UTF_8)
    }
}
