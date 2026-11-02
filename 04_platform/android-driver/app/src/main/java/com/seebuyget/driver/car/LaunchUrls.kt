package com.seebuyget.driver.car

/**
 * 2026-11-02 — EVERY PAGE THIS APP OPENS SAYS IT IS THE PLAY APP. The icon opens `/driver/?app=android`, but a tapped
 * link to the Driver app, or a notification's `?chat=…`, arrives without it — and the web page offers Settings ›
 * "Messages in the car" only inside this app (the plan, section 3). So `app=android` is put on whatever is opened, and
 * any other `app=` value is replaced: this IS the Android app. The rest of the address is left exactly as it came.
 */
object LaunchUrls {
    fun withAppFlag(url: String): String {
        val hashAt = url.indexOf('#')
        val beforeHash = if (hashAt < 0) url else url.substring(0, hashAt)
        val fragment = if (hashAt < 0) "" else url.substring(hashAt)
        val queryAt = beforeHash.indexOf('?')
        val base = if (queryAt < 0) beforeHash else beforeHash.substring(0, queryAt)
        val query = if (queryAt < 0) "" else beforeHash.substring(queryAt + 1)

        val flag = CarContract.APP_PARAM + "=" + CarContract.APP_VALUE
        val pairs = query.split('&').filter { it.isNotEmpty() }
        var placed = false
        val kept = ArrayList<String>(pairs.size + 1)
        for (pair in pairs) {
            if (pair.substringBefore('=') == CarContract.APP_PARAM) {
                if (!placed) kept.add(flag)
                placed = true
            } else {
                kept.add(pair)
            }
        }
        if (!placed) kept.add(flag)
        return base + "?" + kept.joinToString("&") + fragment
    }
}
