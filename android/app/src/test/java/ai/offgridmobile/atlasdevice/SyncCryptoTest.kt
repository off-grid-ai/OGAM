package ai.offgridmobile.atlasdevice

import javax.crypto.AEADBadTagException
import javax.crypto.spec.SecretKeySpec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncCryptoTest {
    private val key = SecretKeySpec(ByteArray(32) { it.toByte() }, "AES")

    @Test fun opensWhatItSealed() {
        val text = "paired device {\"host\":\"192.168.1.5\",\"port\":4000}"
        assertEquals(text, SyncCrypto.open(key, SyncCrypto.seal(key, text)))
    }

    @Test fun usesAFreshNonceEachTime() {
        val a = SyncCrypto.seal(key, "same")
        val b = SyncCrypto.seal(key, "same")
        assertFalse(a.contentEquals(b))
        assertTrue(a.size >= SyncCrypto.MIN_PACKET_BYTES)
    }

    @Test fun refusesTamperedAndShortPackets() {
        val packet = SyncCrypto.seal(key, "secret")
        packet[packet.size - 1] = (packet[packet.size - 1].toInt() xor 1).toByte()
        assertThrows(AEADBadTagException::class.java) { SyncCrypto.open(key, packet) }
        assertThrows(IllegalArgumentException::class.java) { SyncCrypto.open(key, ByteArray(10)) }
    }

    @Test fun anotherKeyCannotOpenIt() {
        val other = SecretKeySpec(ByteArray(32) { (it + 1).toByte() }, "AES")
        assertThrows(AEADBadTagException::class.java) { SyncCrypto.open(other, SyncCrypto.seal(key, "x")) }
    }
}
