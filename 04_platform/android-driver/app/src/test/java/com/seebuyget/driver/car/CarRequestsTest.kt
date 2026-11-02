package com.seebuyget.driver.car

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 2026-11-02 — What the app asks the server, exactly (car.controller.ts and car.dto.ts): the method, the address, the
 * key in the Authorization header only, and bodies a JSON parser reads back to what was meant.
 */
class CarRequestsTest {
    private val key = "car_" + "fedcba9876543210".repeat(4)
    private val requests = CarRequests("seebuyget.com", "SeeBuyGetDriver/0.1.0 (Android 15)")

    @Test
    fun `a chat is read with a GET and the car key`() {
        val r = requests.chat(key, "cv_0011223344556677")
        assertEquals("GET", r.method)
        assertEquals("https://seebuyget.com/v1/sbg/car/chats/cv_0011223344556677", r.url)
        assertEquals("Car $key", r.headers["Authorization"])
        assertEquals("application/json", r.headers["Accept"])
        assertEquals("SeeBuyGetDriver/0.1.0 (Android 15)", r.headers["User-Agent"])
        assertFalse(r.headers.containsKey("Content-Type"))
        assertNull(r.body)
    }

    @Test
    fun `a conversation id cannot step out of its place in the address`() {
        val r = requests.chat(key, "cv_1/../../token")
        assertEquals("https://seebuyget.com/v1/sbg/car/chats/cv_1%2F..%2F..%2Ftoken", r.url)
    }

    @Test
    fun `a reply is the words as text`() {
        val words = "Gate 3, \"not\" gate 1\nOn my way \\ 10 min — sawa"
        val r = requests.reply(key, "cv_1", words)
        assertEquals("POST", r.method)
        assertEquals("https://seebuyget.com/v1/sbg/car/chats/cv_1/reply", r.url)
        assertEquals("application/json; charset=utf-8", r.headers["Content-Type"])
        assertEquals("""{"text":"Gate 3, \"not\" gate 1\nOn my way \\ 10 min — sawa"}""", r.body)
        assertEquals(words, JSONObject(r.body).getString("text"))
        // Only `text`: the server's validation refuses a field it does not know.
        assertEquals(1, JSONObject(r.body).length())
    }

    @Test
    fun `mark as read sends the newest message shown`() {
        val r = requests.markRead(key, "cv_1", 12L)
        assertEquals("POST", r.method)
        assertEquals("https://seebuyget.com/v1/sbg/car/chats/cv_1/read", r.url)
        assertEquals("""{"seq":12}""", r.body)
    }

    @Test
    fun `the phone's token is registered with the car key`() {
        val r = requests.registerToken(key, "dGVzdA:APA91b-token_value.1")
        assertEquals("POST", r.method)
        assertEquals("https://seebuyget.com/v1/sbg/car/token", r.url)
        assertEquals("""{"token":"dGVzdA:APA91b-token_value.1"}""", r.body)
        assertEquals("Car $key", r.headers["Authorization"])
    }

    @Test
    fun `a request printed never shows the key`() {
        val printed = requests.chat(key, "cv_1").toString()
        assertFalse(printed.contains(key))
        assertTrue(printed.contains("GET"))
    }

    @Test
    fun `the site must be a bare host name`() {
        for (bad in listOf("https://seebuyget.com", "seebuyget.com/driver", "", "SeeBuyGet.com", "seebuyget.com?x=1")) {
            assertThrows(bad, IllegalArgumentException::class.java) { CarRequests(bad, "ua") }
        }
        assertEquals("https://localhost:8443/v1/sbg/car/token", CarRequests("localhost:8443", "ua").registerToken(key, "t").url)
    }

    @Test
    fun `json strings escape whatever would break them`() {
        val nasty = "a\"b\\c\nd\re\tf\u0001g h i"
        val written = Json.obj("text" to nasty, "n" to 3L, "ok" to true, "none" to null)
        assertFalse(written.contains("\n"))
        assertFalse(written.contains(" "))
        val read = JSONObject(written)
        assertEquals(nasty, read.getString("text"))
        assertEquals(3L, read.getLong("n"))
        assertTrue(read.getBoolean("ok"))
        assertTrue(read.isNull("none"))
    }

    @Test
    fun `every page opened says it is the Android app`() {
        assertEquals("https://seebuyget.com/driver/?app=android", LaunchUrls.withAppFlag("https://seebuyget.com/driver/"))
        assertEquals("https://seebuyget.com/driver/?app=android", LaunchUrls.withAppFlag("https://seebuyget.com/driver/?app=android"))
        assertEquals("https://seebuyget.com/driver/?chat=cv_1&app=android", LaunchUrls.withAppFlag("https://seebuyget.com/driver/?chat=cv_1"))
        assertEquals("https://seebuyget.com/driver/?app=android&chat=cv_1", LaunchUrls.withAppFlag("https://seebuyget.com/driver/?app=web&chat=cv_1"))
        assertEquals("https://seebuyget.com/driver/?go=jobs&app=android#top", LaunchUrls.withAppFlag("https://seebuyget.com/driver/?go=jobs#top"))
        assertEquals("https://seebuyget.com/driver/?app=android", LaunchUrls.withAppFlag("https://seebuyget.com/driver/?"))
        assertEquals("https://seebuyget.com/driver/?app=android&x=1", LaunchUrls.withAppFlag("https://seebuyget.com/driver/?app=android&x=1&app=web"))
    }

    @Test
    fun `the addresses of the contract`() {
        assertEquals("https://seebuyget.com/driver/?app=android", CarContract.launchUrl("seebuyget.com"))
        assertEquals("https://seebuyget.com/driver/?app=android&chat=cv_1", CarContract.chatUrl("seebuyget.com", "cv_1"))
        assertEquals("https://seebuyget.com/v1/sbg", CarContract.apiBase("seebuyget.com"))
        assertTrue(CarContract.isConversationId("cv_0011223344556677"))
        assertFalse(CarContract.isConversationId("cv 1"))
        assertFalse(CarContract.isConversationId(""))
        assertFalse(CarContract.isConversationId(null))
    }
}
