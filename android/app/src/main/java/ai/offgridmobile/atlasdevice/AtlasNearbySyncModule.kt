package ai.offgridmobile.atlasdevice

import android.net.Uri
import android.os.Build
import android.util.Base64
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.security.KeyStore
import java.security.SecureRandom
import java.util.UUID
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.SecretKeySpec
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.json.JSONObject

/**
 * Encrypted, mutually-authenticated local socket transport. Not a cloud service.
 * QR invitations are short-lived; bonded peers are stored under an Android Keystore key.
 * Device ID and network address are not authorization: possession of the random pairing
 * secret is required to read or send any data.
 */
class AtlasNearbySyncModule(private val ctx: ReactApplicationContext) :
    ReactContextBaseJavaModule(ctx) {
    override fun getName() = "AtlasNearbySync"
    private val workers = Executors.newCachedThreadPool()
    private val random = SecureRandom()
    private val prefs = ctx.getSharedPreferences("atlas-nearby-sync", 0)
    private val awaiting = ConcurrentHashMap<String, ArrayBlockingQueue<String>>()
    private val observed = ConcurrentHashMap<String, Long>()
    private val keyAlias = "atlas_sync_peer_key_v1"
    private val maxPacketBytes = 48 * 1024 * 1024
    private val ioTimeoutMs = 120000
    @Volatile private var server: ServerSocket? = null
    @Volatile private var pairingSecret: ByteArray? = null
    @Volatile private var pairingUntil: Long = 0

    private val ownId: String by lazy {
        val old = prefs.getString("device_id", null)
        if (old != null) old else UUID.randomUUID().toString().replace("-", "").also {
            prefs.edit().putString("device_id", it).apply()
        }
    }
    private fun encode(bytes: ByteArray): String =
        Base64.encodeToString(bytes, Base64.NO_WRAP or Base64.URL_SAFE or Base64.NO_PADDING)
    private fun decode(text: String): ByteArray =
        Base64.decode(text, Base64.NO_WRAP or Base64.URL_SAFE)
    private fun freshBytes(n: Int) = ByteArray(n).also(random::nextBytes)
    private fun masterKey(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(keyAlias, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(keyAlias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true).build())
        return generator.generateKey()
    }
    private fun encrypt(key: SecretKey, plain: String): String = encode(SyncCrypto.seal(key, plain))
    private fun decrypt(key: SecretKey, value: String): String = SyncCrypto.open(key, decode(value))
    private fun peerKey(secret: ByteArray): SecretKey {
        require(secret.size == 32) { "Invalid pairing key" }
        return SecretKeySpec(secret, "AES")
    }
    private fun peerStore(peerId: String, host: String, port: Int, secret: ByteArray) {
        val item = JSONObject().put("id", peerId).put("host", host)
            .put("port", port).put("secret", encode(secret))
        prefs.edit().putString("peer_" + peerId, encrypt(masterKey(), item.toString())).apply()
    }
    private fun peerRecord(peerId: String): JSONObject {
        require(peerId.matches(Regex("[a-zA-Z0-9_-]{8,128}"))) { "Invalid peer ID" }
        val ciphertext = prefs.getString("peer_" + peerId, null)
            ?: throw IllegalArgumentException("Device has not been paired")
        return JSONObject(decrypt(masterKey(), ciphertext))
    }
    private fun allIpv4(): List<String> {
        val names = NetworkInterface.getNetworkInterfaces() ?: return emptyList()
        val addresses = mutableListOf<String>()
        while (names.hasMoreElements()) {
            val iface = names.nextElement()
            if (!iface.isUp || iface.isLoopback) continue
            val ips = iface.inetAddresses
            while (ips.hasMoreElements()) {
                val ip = ips.nextElement()
                if (ip is Inet4Address && ip.isSiteLocalAddress) addresses.add(ip.hostAddress ?: "")
            }
        }
        return addresses.distinct().filter { it.isNotBlank() }
    }
    private fun privateAddress(value: String): Boolean {
        val parts = value.split(".").mapNotNull { it.toIntOrNull() }
        if (parts.size != 4 || parts.any { it !in 0..255 }) return false
        return parts[0] == 10 || (parts[0] == 172 && parts[1] in 16..31) ||
            (parts[0] == 192 && parts[1] == 168) || (parts[0] == 169 && parts[1] == 254)
    }
    private fun makeEnvelope(data: String, secret: ByteArray): ByteArray {
        val request = JSONObject().put("version", 1).put("source", ownId)
            .put("port", server?.localPort ?: 0)
            .put("issued", System.currentTimeMillis())
            .put("nonce", UUID.randomUUID().toString())
            .put("payload", encrypt(peerKey(secret), data))
        return request.toString().toByteArray(Charsets.UTF_8)
    }
    private fun readFrame(socket: Socket): JSONObject {
        val input = java.io.DataInputStream(socket.getInputStream())
        val count = input.readInt()
        require(count in 1..maxPacketBytes) { "Invalid sync transfer size" }
        val bytes = ByteArray(count)
        input.readFully(bytes)
        return JSONObject(String(bytes, Charsets.UTF_8))
    }
    private fun writeFrame(socket: Socket, data: ByteArray) {
        require(data.size in 1..maxPacketBytes) { "Sync transfer exceeds the 48 MB safety limit" }
        val output = java.io.DataOutputStream(socket.getOutputStream())
        output.writeInt(data.size)
        output.write(data)
        output.flush()
    }
    private fun checkFrame(frame: JSONObject) {
        require(frame.optInt("version") == 1) { "Unsupported sync protocol" }
        val issued = frame.getLong("issued")
        require(kotlin.math.abs(System.currentTimeMillis() - issued) < 5 * 60 * 1000L) {
            "Sync message has expired; check device clocks"
        }
        val nonce = frame.getString("nonce")
        require(nonce.length in 10..100) { "Invalid sync message ID" }
        val id = frame.getString("source")
        require(id.matches(Regex("[a-zA-Z0-9_-]{8,128}"))) { "Invalid sender" }
        val old = observed.putIfAbsent(id + ":" + nonce, issued)
        require(old == null) { "Repeated sync request refused" }
        if (observed.size > 2048) observed.entries.removeAll { it.value < System.currentTimeMillis() - 300000L }
    }
    private fun handle(socket: Socket) {
        socket.use {
            it.soTimeout = ioTimeoutMs
            val frame = readFrame(it)
            checkFrame(frame)
            val source = frame.getString("source")
            val old = prefs.getString("peer_" + source, null)
            val inviting = old == null
            val secret = if (inviting) {
                require(System.currentTimeMillis() < pairingUntil) { "Pairing invitation expired" }
                pairingSecret ?: throw IllegalStateException("Pairing is not enabled")
            } else decode(peerRecord(source).getString("secret"))
            val body = decrypt(peerKey(secret), frame.getString("payload"))
            val id = UUID.randomUUID().toString()
            val queue = ArrayBlockingQueue<String>(1)
            awaiting[id] = queue
            val event = Arguments.createMap().apply {
                putString("requestId", id)
                putString("peerId", source)
                putString("payload", body)
                putBoolean("newPair", inviting)
            }
            ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("AtlasNearbyMessage", event)
            val response = try {
                queue.poll(105, TimeUnit.SECONDS) ?: throw IllegalStateException("Atlas did not respond to sync")
            } finally { awaiting.remove(id) }
            writeFrame(it, makeEnvelope(response, secret))
            if (inviting) {
                val peerPort = frame.optInt("port")
                require(peerPort in 1..65535) { "Invalid peer listening port" }
                peerStore(source, it.inetAddress.hostAddress ?: "", peerPort, secret)
                pairingSecret = null
            } else {
                val peerPort = frame.optInt("port")
                if (peerPort in 1..65535) peerStore(source, it.inetAddress.hostAddress ?: "",
                    peerPort, secret)
            }
        }
    }
    @Synchronized private fun ensureServer(): Int {
        server?.let { if (!it.isClosed) return it.localPort }
        // Stable port: paired devices reconnect after app restarts without a new QR.
        val open = ServerSocket(47839)
        open.reuseAddress = true
        server = open
        workers.execute {
            while (!open.isClosed) {
                try {
                    val socket = open.accept()
                    workers.execute { try { handle(socket) } catch (_: Exception) {
                        try { socket.close() } catch (_: Exception) {}
                    } }
                } catch (_: Exception) { if (open.isClosed) return@execute }
            }
        }
        return open.localPort
    }
    @ReactMethod fun start(promise: Promise) {
        try {
            val port = ensureServer()
            val info = Arguments.createMap().apply {
                putString("deviceId", ownId)
                putInt("port", port)
                putString("address", allIpv4().firstOrNull() ?: "")
            }
            promise.resolve(info)
        } catch (error: Exception) { promise.reject("NEARBY_START", error) }
    }
    @ReactMethod fun stop(promise: Promise) {
        server?.close()
        server = null
        pairingSecret = null
        promise.resolve(true)
    }
    @ReactMethod fun invitation(promise: Promise) {
        try {
            val port = ensureServer()
            val address = allIpv4().firstOrNull()
                ?: throw IllegalStateException("Connect the devices to the same local Wi-Fi or hotspot")
            val key = freshBytes(32)
            pairingSecret = key
            pairingUntil = System.currentTimeMillis() + 10 * 60 * 1000L
            val uri = Uri.Builder().scheme("atlas").authority("sync")
                .appendQueryParameter("id", ownId)
                .appendQueryParameter("ip", address)
                .appendQueryParameter("port", port.toString())
                .appendQueryParameter("key", encode(key)).build().toString()
            promise.resolve(uri)
        } catch (error: Exception) { promise.reject("NEARBY_INVITE", error) }
    }
    private fun exchange(host: String, port: Int, secret: ByteArray, body: String, expected: String): String {
        require(privateAddress(host) && port in 1..65535) { "Peer must be on a local network" }
        Socket().use { socket ->
            socket.connect(java.net.InetSocketAddress(host, port), 8000)
            socket.soTimeout = ioTimeoutMs
            writeFrame(socket, makeEnvelope(body, secret))
            val response = readFrame(socket)
            checkFrame(response)
            require(response.getString("source") == expected) { "Wrong sync device replied" }
            return decrypt(peerKey(secret), response.getString("payload"))
        }
    }
    @ReactMethod fun pair(uriText: String, payload: String, promise: Promise) {
        workers.execute {
            try {
                val uri = Uri.parse(uriText)
                require(uri.scheme == "atlas" && uri.host == "sync") { "Not an Atlas pairing invitation" }
                val id = uri.getQueryParameter("id") ?: throw IllegalArgumentException("Missing paired device")
                val ip = uri.getQueryParameter("ip") ?: ""
                val port = uri.getQueryParameter("port")?.toIntOrNull() ?: 0
                val secret = decode(uri.getQueryParameter("key") ?: "")
                require(id != ownId && id.matches(Regex("[a-zA-Z0-9_-]{8,128}")))
                val result = exchange(ip, port, secret, payload, id)
                peerStore(id, ip, port, secret)
                val value = Arguments.createMap().apply {
                    putString("peerId", id); putString("payload", result); putString("transport", "wifi")
                }
                promise.resolve(value)
            } catch (error: Exception) { promise.reject("NEARBY_PAIR", error) }
        }
    }
    @ReactMethod fun sync(peerId: String, payload: String, promise: Promise) {
        workers.execute {
            try {
                val peer = peerRecord(peerId)
                val text = exchange(peer.getString("host"), peer.getInt("port"),
                    decode(peer.getString("secret")), payload, peerId)
                val value = Arguments.createMap().apply {
                    putString("peerId", peerId); putString("payload", text); putString("transport", "wifi")
                }
                promise.resolve(value)
            } catch (error: Exception) { promise.reject("NEARBY_SYNC", error) }
        }
    }
    @ReactMethod fun respond(requestId: String, payload: String, promise: Promise) {
        val queue = awaiting[requestId]
        if (queue == null) { promise.reject("NEARBY_EXPIRED", "Sync request expired"); return }
        if (queue.offer(payload)) promise.resolve(true) else promise.reject("NEARBY_BUSY", "Already answered")
    }
    @ReactMethod fun peers(promise: Promise) {
        try {
            val list = Arguments.createArray()
            prefs.all.keys.filter { it.startsWith("peer_") }.forEach { name ->
                try {
                    val peer = peerRecord(name.removePrefix("peer_"))
                    list.pushMap(Arguments.createMap().apply {
                        putString("id", peer.getString("id"))
                        putString("address", peer.getString("host"))
                    })
                } catch (_: Exception) { /* Ignore corrupted or previously revoked peers. */ }
            }
            promise.resolve(list)
        } catch (error: Exception) { promise.reject("NEARBY_PEERS", error) }
    }
    @ReactMethod fun unpair(id: String, promise: Promise) {
        prefs.edit().remove("peer_" + id).apply()
        promise.resolve(true)
    }
    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}
    override fun invalidate() {
        server?.close()
        server = null
        workers.shutdownNow()
        super.invalidate()
    }
}