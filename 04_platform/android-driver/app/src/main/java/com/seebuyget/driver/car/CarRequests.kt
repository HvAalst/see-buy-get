package com.seebuyget.driver.car

/** One request to the server, as data: built here and tested on the JVM, sent by HttpTransport on the phone. */
data class CarRequest(
    val method: String,
    val url: String,
    val headers: Map<String, String>,
    val body: String?,
) {
    /** Never the key: a request may be printed in a test's failure, and a key printed is a key given away. */
    override fun toString(): String = "CarRequest($method $url, headers=${headers.keys}, body=${body?.length ?: 0} chars)"
}

/**
 * 2026-11-02 — THE FOUR THINGS A CAR KEY MAY ASK (car.controller.ts): where Firebase reaches this phone; one chat's
 * unread messages; a spoken reply, as text; mark a chat read up to the message the car showed. Always over https, the
 * key in the `Authorization` header and nowhere else.
 */
class CarRequests(host: String, private val userAgent: String) {
    private val base: String

    init {
        require(CarContract.isHost(host)) { "not a host name" }
        base = CarContract.apiBase(host)
    }

    fun registerToken(key: String, token: String): CarRequest =
        post(key, CarContract.ROUTE_TOKEN, Json.obj(CarContract.Fields.TOKEN to token))

    fun chat(key: String, conversationId: String): CarRequest =
        CarRequest("GET", base + CarContract.routeChat(conversationId), headers(key, json = false), null)

    fun reply(key: String, conversationId: String, text: String): CarRequest =
        post(key, CarContract.routeReply(conversationId), Json.obj(CarContract.Fields.TEXT to text))

    fun markRead(key: String, conversationId: String, seq: Long): CarRequest =
        post(key, CarContract.routeRead(conversationId), Json.obj(CarContract.Fields.SEQ to seq))

    private fun post(key: String, route: String, body: String): CarRequest =
        CarRequest("POST", base + route, headers(key, json = true), body)

    private fun headers(key: String, json: Boolean): Map<String, String> {
        val headers = LinkedHashMap<String, String>()
        headers["Authorization"] = CarContract.AUTH_SCHEME + " " + key
        headers["Accept"] = "application/json"
        headers["User-Agent"] = userAgent
        if (json) headers["Content-Type"] = "application/json; charset=utf-8"
        return headers
    }
}
