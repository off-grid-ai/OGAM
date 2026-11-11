package ai.offgridmobile.atlasdevice

import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * AES-GCM for sync packets and the stored pairings. The cipher picks its own random 12-byte nonce:
 * a key held in the Android Keystore is created with "randomized encryption required" and refuses a nonce
 * supplied by the caller ("Caller-provided IV not permitted"), which stopped pairing from saving the other
 * device. The nonce is put in front of the ciphertext, so opening needs only the key.
 */
internal object SyncCrypto {
    private const val NONCE_BYTES = 12
    private const val TAG_BITS = 128
    /** nonce + ciphertext + 16-byte tag, so anything shorter than this cannot be a packet. */
    const val MIN_PACKET_BYTES = NONCE_BYTES + 1 + TAG_BITS / 8

    fun seal(key: SecretKey, plain: String): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key)
        val nonce = cipher.iv
        check(nonce.size == NONCE_BYTES) { "Unexpected nonce size" }
        return nonce + cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
    }

    fun open(key: SecretKey, packet: ByteArray): String {
        require(packet.size >= MIN_PACKET_BYTES) { "Invalid encrypted peer packet" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, packet.copyOfRange(0, NONCE_BYTES)))
        return String(cipher.doFinal(packet.copyOfRange(NONCE_BYTES, packet.size)), Charsets.UTF_8)
    }
}
