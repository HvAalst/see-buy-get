package com.seebuyget.driver.car

/** What a car link asks for (2026-11-02). */
sealed interface CarLink {
    /** Turn Messages in the car on for this phone, with this car key. */
    data class TurnOn(val key: String) : CarLink

    /** Turn it off: forget the key here. The server's side is turned off in the web app's Settings. */
    data object TurnOff : CarLink

    /** Not a link of ours, or not one we can trust: nothing is kept. Why, for a test to read — never shown as is. */
    data class NotOurs(val why: String) : CarLink
}

/**
 * 2026-11-02 — READING THE CAR LINK. Any app or page can open an `sbgdriver://` link, so this is strict: our scheme, one
 * of our two hosts, no path, and for turning on exactly one `key` that has a car key's exact shape. Chrome turns the
 * page's `intent://car-link?key=…#Intent;scheme=sbgdriver;…;end` into `sbgdriver://car-link?key=…` before this app sees
 * it, so that is the one form read here.
 */
object CarLinks {
    fun parse(link: String?): CarLink {
        if (link.isNullOrBlank()) return CarLink.NotOurs("empty")
        val schemeEnd = link.indexOf("://")
        if (schemeEnd <= 0) return CarLink.NotOurs("no scheme")
        if (!link.substring(0, schemeEnd).equals(CarContract.LINK_SCHEME, ignoreCase = true)) {
            return CarLink.NotOurs("another scheme")
        }

        val rest = link.substring(schemeEnd + 3)
        val hostEnd = rest.indexOfFirst { it == '/' || it == '?' || it == '#' }.let { if (it < 0) rest.length else it }
        val host = rest.substring(0, hostEnd).lowercase()
        val afterHost = rest.substring(hostEnd)
        val path = afterHost.substringBefore('#').substringBefore('?')
        if (path.isNotEmpty() && path != "/") return CarLink.NotOurs("a path")
        val query = afterHost.substringBefore('#').let { if ('?' in it) it.substringAfter('?') else "" }

        return when (host) {
            CarContract.LINK_HOST_OFF -> CarLink.TurnOff
            CarContract.LINK_HOST_ON -> turnOn(query)
            else -> CarLink.NotOurs("another host")
        }
    }

    private fun turnOn(query: String): CarLink {
        val keys = ArrayList<String>()
        for (pair in query.split('&')) {
            if (pair.isEmpty()) continue
            val name = Paths.decode(pair.substringBefore('=')) ?: return CarLink.NotOurs("unreadable")
            if (name != CarContract.LINK_KEY) continue
            val value = if ('=' in pair) Paths.decode(pair.substringAfter('=')) else ""
            keys.add(value ?: return CarLink.NotOurs("unreadable"))
        }
        if (keys.size != 1) return CarLink.NotOurs(if (keys.isEmpty()) "no key" else "two keys")
        val key = keys[0]
        if (!CarContract.isCarKey(key)) return CarLink.NotOurs("not a car key")
        return CarLink.TurnOn(key)
    }
}
