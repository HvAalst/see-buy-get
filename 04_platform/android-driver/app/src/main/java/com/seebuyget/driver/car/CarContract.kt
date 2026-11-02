package com.seebuyget.driver.car

/**
 * 2026-11-02 — THE CONTRACT, IN ONE PLACE: what the web page hands this app, where the app knocks on the server, and the
 * names of the fields it reads and writes (05_engineering/android-auto-messages.md, section 3; the server's side is
 * backend/src/modules/pudo/car.controller.ts, car.types.ts, car.dto.ts, car-keys.ts and fcm.ts).
 *
 * Nothing in this package touches Android: it is the part the JVM tests run, so what the app asks and how it reads the
 * answers is checked without a phone. When the server changes a name, it changes here and nowhere else in the code —
 * except the manifest's intent filter, which CarLinkTest holds to these constants.
 */
object CarContract {
    // ---- The link the web page opens: Settings › "Messages in the car" -------------------------------------------------

    /** The app's package: the `intent://` form of the link names it, so no other app answers. */
    const val PACKAGE = "com.seebuyget.driver"

    /** `sbgdriver://car-link?key=<car key>` turns it on for this phone; `sbgdriver://car-unlink` turns it off. */
    const val LINK_SCHEME = "sbgdriver"
    const val LINK_HOST_ON = "car-link"
    const val LINK_HOST_OFF = "car-unlink"
    const val LINK_KEY = "key"

    /** Exactly what a car key looks like (car-keys.ts, CAR_KEY_SHAPE): anything else in a link is not one. */
    private val CAR_KEY_SHAPE = Regex("^car_[0-9a-f]{64}$")

    /** A conversation's id as the server makes them (`cv_` and hex), with room to change: never more than this. */
    private val CONVERSATION_SHAPE = Regex("^[A-Za-z0-9_.:-]{1,128}$")

    /** A host name, with a port at most: what the build is given as the site. */
    private val HOST_SHAPE = Regex("^[a-z0-9.-]+(:[0-9]{1,5})?$")

    fun isCarKey(value: String?): Boolean = value != null && CAR_KEY_SHAPE.matches(value)
    fun isConversationId(value: String?): Boolean = value != null && CONVERSATION_SHAPE.matches(value)
    fun isHost(value: String?): Boolean = value != null && HOST_SHAPE.matches(value)

    /** The link as the web page may write it, for Chrome to hand to this app only. */
    fun intentLink(key: String): String =
        "intent://$LINK_HOST_ON?$LINK_KEY=${Paths.encode(key)}#Intent;scheme=$LINK_SCHEME;package=$PACKAGE;end"

    // ---- The site ---------------------------------------------------------------------------------------------------

    const val DRIVER_PATH = "/driver/"
    /** `?app=android`: the page is inside the Play app, so Settings may offer Messages in the car. */
    const val APP_PARAM = "app"
    const val APP_VALUE = "android"
    /** `?chat=<conversation>`: the Driver app opens that chat (frontend/src/shared/launch.ts). */
    const val CHAT_PARAM = "chat"
    const val API_PREFIX = "/v1/sbg"

    fun origin(host: String): String = "https://$host"
    fun apiBase(host: String): String = origin(host) + API_PREFIX
    fun launchUrl(host: String): String = origin(host) + DRIVER_PATH + "?" + APP_PARAM + "=" + APP_VALUE
    fun chatUrl(host: String, conversationId: String): String =
        launchUrl(host) + "&" + CHAT_PARAM + "=" + Paths.encode(conversationId)

    // ---- The car's doors (car.controller.ts) -----------------------------------------------------------------------

    /** `Authorization: Car car_…`. Never a query parameter: those end up in access logs. */
    const val AUTH_SCHEME = "Car"

    /** POST `{ token }` → `{ registered }`: where Firebase reaches this phone. */
    const val ROUTE_TOKEN = "/car/token"
    /** GET → the chat's unread messages (CarChatView). */
    fun routeChat(conversationId: String): String = "/car/chats/" + Paths.encode(conversationId)
    /** POST `{ text }` → `{ sent, seq, at, via }`. */
    fun routeReply(conversationId: String): String = routeChat(conversationId) + "/reply"
    /** POST `{ seq }` → `{ read, unread }`: up to the newest message the car showed, never past it. */
    fun routeRead(conversationId: String): String = routeChat(conversationId) + "/read"

    // ---- The wake-up (fcm.ts, wakeData): a data message, `{ kind: 'chat', conversationId }`, and nothing else --------

    const val WAKE_KIND = "kind"
    const val WAKE_CHAT = "chat"
    const val WAKE_CONVERSATION = "conversationId"

    // ---- Field names, sent and read ----------------------------------------------------------------------------------

    object Fields {
        const val TOKEN = "token"
        const val TEXT = "text"
        const val SEQ = "seq"

        // CarChatView
        const val CONVERSATION_ID = "conversationId"
        const val TITLE = "title"
        const val FROM = "from"
        const val CAN_REPLY = "canReply"
        const val CLOSED = "closed"
        const val MESSAGES = "messages"

        // CarChatLine
        const val AT = "at"
        const val KIND = "kind"

        // A refusal (RFC 9457 problem+json, foundation/http/problem.filter.ts)
        const val DETAIL = "detail"
        const val MESSAGE = "message"
    }
}
