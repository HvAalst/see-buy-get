package com.seebuyget.driver

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.seebuyget.driver.car.CarContract
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * 2026-11-02 — THE CAR KEY, KEPT ON THIS PHONE ONLY, ENCRYPTED. An AES-256-GCM key made inside the Android Keystore
 * (it never leaves it, and is never in a backup) seals the car key; the sealed text is what SharedPreferences holds.
 * Not androidx.security-crypto: its encrypted preferences were deprecated and never left alpha.
 *
 * Whatever cannot be opened — a keystore wiped, a file from elsewhere — is forgotten, never guessed at: the driver
 * turns Messages in the car on again. Nothing here is ever logged.
 */
class CarKeyStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** The car key, or null when there is none (or none that can be opened). */
    fun key(): String? {
        val sealed = prefs.getString(ENTRY_KEY, null) ?: return null
        val key = try {
            String(open(sealed), Charsets.UTF_8)
        } catch (e: Exception) {
            null
        }
        if (!CarContract.isCarKey(key)) {
            clear()
            return null
        }
        return key
    }

    /** Keep a new car key. Its phone token is not yet with the server: registered() is false until it is. */
    fun keep(key: String): Boolean = try {
        prefs.edit()
            .putString(ENTRY_KEY, seal(key.toByteArray(Charsets.UTF_8)))
            .putBoolean(ENTRY_REGISTERED, false)
            .commit()
    } catch (e: Exception) {
        false
    }

    fun clear() {
        prefs.edit().remove(ENTRY_KEY).remove(ENTRY_REGISTERED).commit()
    }

    /** Has the server been told where Firebase reaches this phone, for the key kept now? */
    fun registered(): Boolean = prefs.getBoolean(ENTRY_REGISTERED, false)

    fun markRegistered() {
        prefs.edit().putBoolean(ENTRY_REGISTERED, true).apply()
    }

    private fun secretKey(): SecretKey {
        val store = KeyStore.getInstance(ANDROID_KEYSTORE)
        store.load(null)
        val existing = store.getKey(ALIAS, null) as? SecretKey
        if (existing != null) return existing
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    /** "1:" + the IV + ":" + the sealed bytes, each in base64. The keystore chooses the IV; it is never reused. */
    private fun seal(plain: ByteArray): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val iv = cipher.getIV()
        val sealed = cipher.doFinal(plain)
        return FORMAT + ":" + Base64.encodeToString(iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(sealed, Base64.NO_WRAP)
    }

    private fun open(text: String): ByteArray {
        val parts = text.split(':')
        require(parts.size == 3 && parts[0] == FORMAT) { "not a sealed key" }
        val iv = Base64.decode(parts[1], Base64.NO_WRAP)
        val sealed = Base64.decode(parts[2], Base64.NO_WRAP)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(TAG_BITS, iv))
        return cipher.doFinal(sealed)
    }

    private companion object {
        const val PREFS = "car"
        const val ENTRY_KEY = "car_key_sealed"
        const val ENTRY_REGISTERED = "token_registered"
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val ALIAS = "seebuyget_car_key"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val TAG_BITS = 128
        const val FORMAT = "1"
    }
}
