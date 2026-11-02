package com.seebuyget.driver.car

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 2026-11-02 — The car link is strict: any app or page can open an `sbgdriver://` link, so only our own, with a car
 * key's exact shape, turns anything on.
 */
class CarLinkTest {
    private val key = "car_" + "0123456789abcdef".repeat(4)

    @Test
    fun `a car link turns it on with its key`() {
        assertEquals(CarLink.TurnOn(key), CarLinks.parse("sbgdriver://car-link?key=$key"))
    }

    @Test
    fun `the scheme and host are read in any case, and a slash or a fragment changes nothing`() {
        assertEquals(CarLink.TurnOn(key), CarLinks.parse("SBGDRIVER://Car-Link?key=$key"))
        assertEquals(CarLink.TurnOn(key), CarLinks.parse("sbgdriver://car-link/?key=$key"))
        assertEquals(CarLink.TurnOn(key), CarLinks.parse("sbgdriver://car-link?key=$key#anything"))
        assertEquals(CarLink.TurnOn(key), CarLinks.parse("sbgdriver://car-link?from=settings&key=$key"))
    }

    @Test
    fun `a percent-encoded key is read as the key`() {
        val encoded = "car%5F" + key.removePrefix("car_")
        assertEquals(CarLink.TurnOn(key), CarLinks.parse("sbgdriver://car-link?key=$encoded"))
    }

    @Test
    fun `the unlink link turns it off`() {
        assertEquals(CarLink.TurnOff, CarLinks.parse("sbgdriver://car-unlink"))
        assertEquals(CarLink.TurnOff, CarLinks.parse("sbgdriver://car-unlink?from=settings"))
    }

    @Test
    fun `anything else is not ours and turns nothing on`() {
        val refused = listOf(
            null,
            "",
            "   ",
            "car-link?key=$key",
            "https://seebuyget.com/driver/?key=$key",
            "sbgdriver://elsewhere?key=$key",
            "sbgdriver://car-link",
            "sbgdriver://car-link?key=",
            "sbgdriver://car-link?key=car_123",
            "sbgdriver://car-link?key=" + key.uppercase(),
            "sbgdriver://car-link?key=$key%0A",
            "sbgdriver://car-link?key=$key&key=$key",
            "sbgdriver://car-link/steal?key=$key",
            "sbgdriver://car-link?key=%G1$key",
            "sbgdriver://car-link?key=%E2%82",
            "sbgdriver://car-link?key=Bearer%20$key",
        )
        for (link in refused) {
            val read = CarLinks.parse(link)
            assertTrue("$link was read as $read", read is CarLink.NotOurs)
        }
    }

    @Test
    fun `the intent form the page writes reaches this app as the car link`() {
        val intent = CarContract.intentLink(key)
        assertTrue(intent.endsWith(";package=${CarContract.PACKAGE};end"))
        // Chrome turns intent://<rest>#Intent;scheme=<s>;...;end into <s>://<rest> for the app it names.
        val rest = intent.removePrefix("intent://").substringBefore("#Intent;")
        val scheme = intent.substringAfter("#Intent;").split(';').first { it.startsWith("scheme=") }.removePrefix("scheme=")
        assertEquals(CarLink.TurnOn(key), CarLinks.parse("$scheme://$rest"))
    }

    @Test
    fun `the manifest answers exactly the links of the contract`() {
        val manifest = listOf(File("src/main/AndroidManifest.xml"), File("app/src/main/AndroidManifest.xml")).firstOrNull { it.isFile }
        assertTrue("the manifest was not found from ${File(".").absolutePath}", manifest != null)
        val text = manifest!!.readText()
        assertTrue("the manifest read is too short to be it", text.length > 2000)

        val linkActivity = text.substringAfter("android:name=\".CarLinkActivity\"").substringBefore("</activity>")
        assertTrue(linkActivity.contains("android:scheme=\"${CarContract.LINK_SCHEME}\""))
        assertTrue(linkActivity.contains("android:host=\"${CarContract.LINK_HOST_ON}\""))
        assertTrue(linkActivity.contains("android:host=\"${CarContract.LINK_HOST_OFF}\""))
        assertTrue(linkActivity.contains("android.intent.category.BROWSABLE"))

        // The launcher opens the Driver app as the contract names it.
        val defaultUrl = CarContract.DRIVER_PATH + "?" + CarContract.APP_PARAM + "=" + CarContract.APP_VALUE
        assertTrue(text.contains("android:value=\"https://\${sbgHost}$defaultUrl\""))

        // The car's parts are all declared: the wake-up, the actions, Android Auto's description.
        assertTrue(text.contains("android:name=\".DriverMessagingService\""))
        assertTrue(text.contains("android:name=\".CarActionReceiver\""))
        assertTrue(text.contains("com.google.android.gms.car.application"))
    }
}
