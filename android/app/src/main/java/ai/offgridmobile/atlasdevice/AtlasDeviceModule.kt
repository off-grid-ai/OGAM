package ai.offgridmobile.atlasdevice

import android.content.ContentUris
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.provider.CalendarContract
import android.provider.Settings
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import com.facebook.react.modules.core.DeviceEventManagerModule
import kotlin.math.sqrt

/** Atlas assistant access to the phone: all-files permission, opening files, calendar. */
class AtlasDeviceModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx), SensorEventListener {
    override fun getName(): String = "AtlasDevice"

    /** Keep the display awake only while Atlas is actively doing foreground AI work. */
    @ReactMethod
    fun setKeepScreenOn(enabled: Boolean, promise: Promise) {
        val activity = ctx.currentActivity
        if (activity == null) { promise.resolve(false); return }
        activity.runOnUiThread {
            try {
                if (enabled) activity.window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                else activity.window.clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("KEEP_SCREEN_ON", e.message ?: "Could not change screen-awake state", e)
            }
        }
    }

    /** Magnetic declination (degrees, east positive) from Android's built-in world magnetic model. */
    @ReactMethod
    fun magneticDeclination(lat: Double, lon: Double, altitudeM: Double, promise: Promise) {
        try {
            val field = android.hardware.GeomagneticField(lat.toFloat(), lon.toFloat(), altitudeM.toFloat(), System.currentTimeMillis())
            promise.resolve(field.declination.toDouble())
        } catch (e: Exception) { promise.reject("DECLINATION", e.message ?: "Declination unavailable", e) }
    }

    /** Flashlight for SOS / Morse signalling. setTorchMode needs no camera permission. */
    @ReactMethod
    fun setTorch(enabled: Boolean, promise: Promise) {
        try {
            val cm = ctx.getSystemService(android.content.Context.CAMERA_SERVICE) as android.hardware.camera2.CameraManager
            val id = cm.cameraIdList.firstOrNull { cid ->
                cm.getCameraCharacteristics(cid).get(android.hardware.camera2.CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
            }
            if (id == null) { promise.resolve(false); return }
            cm.setTorchMode(id, enabled)
            promise.resolve(true)
        } catch (e: Exception) { promise.resolve(false) }
    }

    // ---------------- compass ----------------
    private val sensors by lazy { ctx.getSystemService(Context.SENSOR_SERVICE) as SensorManager }
    private val rot = FloatArray(9)
    private val orient = FloatArray(3)
    private var grav: FloatArray? = null
    private var mag: FloatArray? = null
    private var lastEmit = 0L
    private var listening = false
    private var pressureListener: SensorEventListener? = null

    /** True only if the phone has a magnetometer (a real compass). */
    @ReactMethod
    fun setAiWorkActive(enabled: Boolean, label: String?, promise: Promise) {
        try {
            val intent = Intent(ctx, AtlasAiWorkService::class.java).apply {
                action = AtlasAiWorkService.ACTION_START
                if (enabled && !label.isNullOrBlank()) putExtra(AtlasAiWorkService.EXTRA_LABEL, label)
            }
            if (enabled) androidx.core.content.ContextCompat.startForegroundService(ctx, intent)
            else ctx.stopService(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("AI_WORK_SERVICE", e.message ?: "Could not change background AI service state", e)
        }
    }

    @ReactMethod
    fun hasCompass(promise: Promise) {
        promise.resolve(sensors.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD) != null)
    }

    @ReactMethod
    fun startCompass(promise: Promise) {
        if (listening) { promise.resolve(true); return }
        val rv = sensors.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
        val m = sensors.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD)
        if (m == null) { promise.resolve(false); return }
        if (rv != null) {
            sensors.registerListener(this, rv, SensorManager.SENSOR_DELAY_UI)
            sensors.registerListener(this, m, SensorManager.SENSOR_DELAY_NORMAL) // only for accuracy (calibration) updates
        }
        else {
            sensors.registerListener(this, m, SensorManager.SENSOR_DELAY_UI)
            sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)?.let { sensors.registerListener(this, it, SensorManager.SENSOR_DELAY_UI) }
        }
        listening = true
        promise.resolve(true)
    }

    @ReactMethod
    fun stopCompass(promise: Promise) {
        sensors.unregisterListener(this); listening = false; grav = null; mag = null
        promise.resolve(true)
    }

    override fun onSensorChanged(e: SensorEvent) {
        when (e.sensor.type) {
            Sensor.TYPE_ROTATION_VECTOR -> SensorManager.getRotationMatrixFromVector(rot, e.values)
            Sensor.TYPE_ACCELEROMETER -> {
                val ax = e.values[0].toDouble(); val ay = e.values[1].toDouble(); val az = e.values[2].toDouble()
                val g = sqrt(ax * ax + ay * ay + az * az) / 9.80665
                try {
                    val am = Arguments.createMap(); am.putDouble("x", ax); am.putDouble("y", ay); am.putDouble("z", az); am.putDouble("g", g)
                    ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("AtlasAccelerometer", am)
                } catch (_: Exception) {}
                grav = e.values.clone(); if (mag == null) return; if (!SensorManager.getRotationMatrix(rot, null, grav, mag)) return
            }
            Sensor.TYPE_MAGNETIC_FIELD -> { mag = e.values.clone(); if (grav == null) return; if (!SensorManager.getRotationMatrix(rot, null, grav, mag)) return }
            else -> return
        }
        val now = System.currentTimeMillis()
        if (now - lastEmit < 80) return
        lastEmit = now
        // Account for the screen being turned (tablets in landscape).
        val rotation = try {
            @Suppress("DEPRECATION")
            (if (android.os.Build.VERSION.SDK_INT >= 30) ctx.currentActivity?.display?.rotation
             else (ctx.getSystemService(Context.WINDOW_SERVICE) as android.view.WindowManager).defaultDisplay.rotation) ?: 0
        } catch (_: Exception) { 0 }
        val use = if (rotation == android.view.Surface.ROTATION_0) rot else FloatArray(9).also { out ->
            when (rotation) {
                android.view.Surface.ROTATION_90 -> SensorManager.remapCoordinateSystem(rot, SensorManager.AXIS_Y, SensorManager.AXIS_MINUS_X, out)
                android.view.Surface.ROTATION_180 -> SensorManager.remapCoordinateSystem(rot, SensorManager.AXIS_MINUS_X, SensorManager.AXIS_MINUS_Y, out)
                else -> SensorManager.remapCoordinateSystem(rot, SensorManager.AXIS_MINUS_Y, SensorManager.AXIS_X, out)
            }
        }
        SensorManager.getOrientation(use, orient)
        val deg = ((Math.toDegrees(orient[0].toDouble()) + 360.0) % 360.0)
        try {
            val map = Arguments.createMap(); map.putDouble("heading", deg)
            ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("AtlasCompass", map)
        } catch (_: Exception) {}
        try {
            val om = Arguments.createMap()
            om.putDouble("pitch", Math.toDegrees(orient[1].toDouble()))
            om.putDouble("roll", Math.toDegrees(orient[2].toDouble()))
            ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("AtlasOrientation", om)
        } catch (_: Exception) {}
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
        if (sensor?.type == Sensor.TYPE_MAGNETIC_FIELD || sensor?.type == Sensor.TYPE_ROTATION_VECTOR) {
            try {
                val map = Arguments.createMap(); map.putInt("accuracy", accuracy)
                ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("AtlasCompassAccuracy", map)
            } catch (_: Exception) {}
        }
    }

    // ---------------- GPS (works with no internet or SIM) ----------------
    private val locMgr by lazy { ctx.getSystemService(Context.LOCATION_SERVICE) as android.location.LocationManager }
    @Volatile private var locListener: android.location.LocationListener? = null

    private fun locMap(l: android.location.Location) = Arguments.createMap().apply {
        putDouble("lat", l.latitude); putDouble("lon", l.longitude); putDouble("accuracy", l.accuracy.toDouble())
        putDouble("altitude", if (l.hasAltitude()) l.altitude else -99999.0)
        putDouble("speed", if (l.hasSpeed()) l.speed.toDouble() else -1.0)
        putDouble("time", l.time.toDouble()); putString("provider", l.provider ?: "")
    }

    @ReactMethod
    fun startLocation(promise: Promise) {
        try {
            if (locListener != null) { promise.resolve(true); return }
            val l = object : android.location.LocationListener {
                override fun onLocationChanged(loc: android.location.Location) {
                    try { ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("AtlasLocation", locMap(loc)) } catch (_: Exception) {}
                }
                override fun onProviderEnabled(provider: String) {}
                override fun onProviderDisabled(provider: String) {}
                @Deprecated("Deprecated in Java")
                override fun onStatusChanged(provider: String?, status: Int, extras: android.os.Bundle?) {}
            }
            val providers = locMgr.getProviders(true).filter { it == android.location.LocationManager.GPS_PROVIDER || it == android.location.LocationManager.NETWORK_PROVIDER }
            if (providers.isEmpty()) { promise.reject("NO_GPS", "Location is turned off on this phone"); return }
            locListener = l
            android.os.Handler(android.os.Looper.getMainLooper()).post {
                if (locListener !== l) { promise.resolve(false); return@post } // stopped before it started
                var ok = 0
                for (p in providers) {
                    try { locMgr.requestLocationUpdates(p, 2000L, 2f, l, android.os.Looper.getMainLooper()); ok++ } catch (_: Exception) {}
                }
                if (ok > 0) promise.resolve(true)
                else { locListener = null; promise.reject("NO_PERMISSION", "Location permission not granted") }
            }
        } catch (e: SecurityException) { locListener = null; promise.reject("NO_PERMISSION", "Location permission not granted")
        } catch (e: Exception) { locListener = null; promise.reject("GPS_ERROR", e) }
    }

    @ReactMethod
    fun stopLocation(promise: Promise) {
        try { locListener?.let { locMgr.removeUpdates(it) } } catch (_: Exception) {}
        locListener = null
        promise.resolve(true)
    }

    @ReactMethod
    fun lastLocation(promise: Promise) {
        try {
            var best: android.location.Location? = null
            for (p in locMgr.getProviders(true)) {
                val l = try { locMgr.getLastKnownLocation(p) } catch (_: SecurityException) { null } ?: continue
                if (best == null || l.time > best.time) best = l
            }
            promise.resolve(best?.let { locMap(it) })
        } catch (e: Exception) { promise.resolve(null) }
    }

    @ReactMethod
    fun locationEnabled(promise: Promise) {
        try { promise.resolve(locMgr.getProviders(true).any { it == android.location.LocationManager.GPS_PROVIDER || it == android.location.LocationManager.NETWORK_PROVIDER }) } catch (_: Exception) { promise.resolve(false) }
    }

    @ReactMethod
    fun startPressure(promise: Promise) {
        if (pressureListener != null) { promise.resolve(true); return }
        val ps = sensors.getDefaultSensor(Sensor.TYPE_PRESSURE)
        if (ps == null) { promise.resolve(false); return }
        val l = object : SensorEventListener {
            override fun onSensorChanged(e: SensorEvent) {
                val hpa = e.values[0].toDouble()
                val altM = SensorManager.getAltitude(SensorManager.PRESSURE_STANDARD_ATMOSPHERE, hpa.toFloat()).toDouble()
                try {
                    val pm = Arguments.createMap(); pm.putDouble("hpa", hpa); pm.putDouble("altM", altM)
                    ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("AtlasPressure", pm)
                } catch (_: Exception) {}
            }
            override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
        }
        sensors.registerListener(l, ps, SensorManager.SENSOR_DELAY_NORMAL)
        pressureListener = l
        promise.resolve(true)
    }

    @ReactMethod
    fun stopPressure(promise: Promise) {
        pressureListener?.let { sensors.unregisterListener(it) }
        pressureListener = null
        promise.resolve(true)
    }

    @ReactMethod
    fun getBatteryTemperature(promise: Promise) {
        try {
            val filter = IntentFilter(Intent.ACTION_BATTERY_CHANGED)
            val intent = ctx.registerReceiver(null, filter)
            val temp = intent?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Int.MIN_VALUE) ?: Int.MIN_VALUE
            promise.resolve(if (temp == Int.MIN_VALUE) -999.0 else temp / 10.0)
        } catch (e: Exception) { promise.resolve(-999.0) }
    }

    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}

    override fun invalidate() {
        try { sensors.unregisterListener(this) } catch (_: Exception) {}
        try { pressureListener?.let { sensors.unregisterListener(it) }; pressureListener = null } catch (_: Exception) {}
        try { locListener?.let { locMgr.removeUpdates(it) } } catch (_: Exception) {}
        super.invalidate()
    }

    /** App storage places: the phone, and any SD card (app folders there need no permission). */
    @ReactMethod
    fun storageVolumes(promise: Promise) {
        try {
            val out = Arguments.createArray()
            val dirs = ctx.getExternalFilesDirs(null)
            for ((i, d) in dirs.withIndex()) {
                if (d == null) continue
                try { d.mkdirs() } catch (_: Exception) {}
                val removable = try { Environment.isExternalStorageRemovable(d) } catch (_: Exception) { i > 0 }
                val stat = try { android.os.StatFs(d.path) } catch (_: Exception) { null }
                out.pushMap(Arguments.createMap().apply {
                    putString("path", d.path)
                    putBoolean("removable", removable)
                    putString("state", try { Environment.getExternalStorageState(d) } catch (_: Exception) { "unknown" })
                    putDouble("free", stat?.availableBytes?.toDouble() ?: 0.0)
                    putDouble("total", stat?.totalBytes?.toDouble() ?: 0.0)
                })
            }
            promise.resolve(out)
        } catch (e: Exception) { promise.reject("STORAGE", e) }
    }

    @ReactMethod
    fun hasAllFilesAccess(promise: Promise) {
        promise.resolve(if (Build.VERSION.SDK_INT >= 30) Environment.isExternalStorageManager()
            else ctx.checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) == android.content.pm.PackageManager.PERMISSION_GRANTED)
    }

    @ReactMethod
    fun requestAllFilesAccess(promise: Promise) {
        try {
            val i = if (Build.VERSION.SDK_INT >= 30) {
                Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:${ctx.packageName}"))
            } else {
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${ctx.packageName}"))
            }
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ctx.startActivity(i)
            promise.resolve(true)
        } catch (e: Exception) { promise.reject("SETTINGS", e) }
    }

    @ReactMethod
    fun storageRoot(promise: Promise) { promise.resolve(Environment.getExternalStorageDirectory().absolutePath) }

    /** Open a file in another app (browser for .html, docs app for .docx, etc.). */
    @ReactMethod
    fun openFile(path: String, promise: Promise) {
        try {
            val f = File(path.removePrefix("file://"))
            val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.atlasfiles", f)
            val ext = f.extension.lowercase()
            val mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: when (ext) { "md" -> "text/markdown"; else -> "*/*" }
            val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            val chooser = Intent.createChooser(view, "Open with").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ctx.startActivity(chooser)
            promise.resolve(true)
        } catch (e: Exception) { promise.reject("OPEN", e.message ?: "Could not open the file", e) }
    }

    /**
     * Starts Android's installer for an APK the app downloaded (an update). Android asks the person to allow installs from
     * Atlas once; until then this opens that setting and resolves "needs-permission" so the app can say what to do.
     */
    @ReactMethod
    fun installApk(path: String, promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !ctx.packageManager.canRequestPackageInstalls()) {
                val allow = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${ctx.packageName}"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                ctx.startActivity(allow)
                promise.resolve("needs-permission")
                return
            }
            val f = File(path.removePrefix("file://"))
            val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.atlasfiles", f)
            val install = Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            ctx.startActivity(install)
            promise.resolve("started")
        } catch (e: Exception) { promise.reject("INSTALL", e.message ?: "Could not start the installer", e) }
    }

    /** Events between start and end (ms since 1970). Needs READ_CALENDAR. */
    @ReactMethod
    fun calendarEvents(startMs: Double, endMs: Double, promise: Promise) {
        try {
            val b = CalendarContract.Instances.CONTENT_URI.buildUpon()
            ContentUris.appendId(b, startMs.toLong())
            ContentUris.appendId(b, endMs.toLong())
            val cols = arrayOf(
                CalendarContract.Instances.TITLE, CalendarContract.Instances.BEGIN, CalendarContract.Instances.END,
                CalendarContract.Instances.EVENT_LOCATION, CalendarContract.Instances.ALL_DAY, CalendarContract.Instances.CALENDAR_DISPLAY_NAME,
                CalendarContract.Instances.DESCRIPTION,
            )
            val out = Arguments.createArray()
            ctx.contentResolver.query(b.build(), cols, null, null, "${CalendarContract.Instances.BEGIN} ASC")?.use { c ->
                var n = 0
                while (c.moveToNext() && n < 200) {
                    out.pushMap(Arguments.createMap().apply {
                        putString("title", c.getString(0) ?: "")
                        putDouble("begin", c.getLong(1).toDouble())
                        putDouble("end", c.getLong(2).toDouble())
                        putString("location", c.getString(3) ?: "")
                        putBoolean("allDay", c.getInt(4) == 1)
                        putString("calendar", c.getString(5) ?: "")
                        putString("description", (c.getString(6) ?: "").take(300))
                    })
                    n++
                }
            }
            promise.resolve(out)
        } catch (e: SecurityException) {
            promise.reject("CAL_PERMISSION", "Calendar permission not granted")
        } catch (e: Exception) { promise.reject("CAL", e.message ?: "Calendar error", e) }
    }

    // Device-bound AES-GCM for persisted chat state. No raw key material crosses the JS bridge.
    private fun chatCipher(mode: Int): javax.crypto.Cipher {
        val alias = "atlas.chat.storage.v1"
        val store = java.security.KeyStore.getInstance("AndroidKeyStore")
        store.load(null)
        if (!store.containsAlias(alias)) {
            val generator = javax.crypto.KeyGenerator.getInstance("AES", "AndroidKeyStore")
            generator.init(android.security.keystore.KeyGenParameterSpec.Builder(
                alias, android.security.keystore.KeyProperties.PURPOSE_ENCRYPT or
                    android.security.keystore.KeyProperties.PURPOSE_DECRYPT
            ).setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).build())
            generator.generateKey()
        }
        val key = store.getKey(alias, null) as javax.crypto.SecretKey
        return javax.crypto.Cipher.getInstance("AES/GCM/NoPadding").also {
            if (mode == javax.crypto.Cipher.ENCRYPT_MODE) it.init(mode, key)
        }
    }

    @ReactMethod
    fun encryptChatState(plain: String, promise: Promise) {
        try {
            val cipher = chatCipher(javax.crypto.Cipher.ENCRYPT_MODE)
            cipher.updateAAD("local-llm-chat-storage:v1".toByteArray(Charsets.UTF_8))
            val encrypted = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
            val encoded = android.util.Base64.encodeToString(cipher.iv + encrypted, android.util.Base64.NO_WRAP)
            promise.resolve("atlasenc:v1:" + encoded)
        } catch (e: Exception) { promise.reject("CHAT_ENCRYPT", "Could not protect chat storage", e) }
    }

    @ReactMethod
    fun decryptChatState(payload: String, promise: Promise) {
        try {
            require(payload.startsWith("atlasenc:v1:")) { "Unsupported encrypted chat format" }
            val bytes = android.util.Base64.decode(payload.removePrefix("atlasenc:v1:"), android.util.Base64.NO_WRAP)
            require(bytes.size >= 29) { "Invalid encrypted chat payload" }
            val iv = bytes.copyOfRange(0, 12)
            val cipher = chatCipher(javax.crypto.Cipher.DECRYPT_MODE)
            val store = java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            val key = store.getKey("atlas.chat.storage.v1", null) as javax.crypto.SecretKey
            cipher.init(javax.crypto.Cipher.DECRYPT_MODE, key, javax.crypto.spec.GCMParameterSpec(128, iv))
            cipher.updateAAD("local-llm-chat-storage:v1".toByteArray(Charsets.UTF_8))
            promise.resolve(String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8))
        } catch (e: Exception) { promise.reject("CHAT_DECRYPT", "Chat storage cannot be decrypted on this device", e) }
    }

    /** PIN verifier for individual UI locks; conversation data remains protected by the Keystore key. */
    @ReactMethod
    fun createChatPinVerifier(pin: String, promise: Promise) {
        try {
            require(pin.matches(Regex("[0-9]{4,12}"))) { "PIN must have 4 to 12 digits" }
            val salt = ByteArray(16).also { java.security.SecureRandom().nextBytes(it) }
            val spec = javax.crypto.spec.PBEKeySpec(pin.toCharArray(), salt, 310000, 256)
            val digest = try { javax.crypto.SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded } finally { spec.clearPassword() }
            promise.resolve("pin:v1:" + android.util.Base64.encodeToString(salt + digest, android.util.Base64.NO_WRAP))
        } catch (e: Exception) { promise.reject("PIN_CREATE", "Could not configure chat PIN", e) }
    }

    @ReactMethod
    fun verifyChatPin(pin: String, verifier: String, promise: Promise) {
        try {
            require(verifier.startsWith("pin:v1:")) { "Invalid PIN verifier" }
            val decoded = android.util.Base64.decode(verifier.removePrefix("pin:v1:"), android.util.Base64.NO_WRAP)
            require(decoded.size == 48) { "Invalid PIN verifier length" }
            val salt = decoded.copyOfRange(0, 16)
            val expected = decoded.copyOfRange(16, 48)
            val spec = javax.crypto.spec.PBEKeySpec(pin.toCharArray(), salt, 310000, 256)
            val actual = try { javax.crypto.SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded } finally { spec.clearPassword() }
            promise.resolve(java.security.MessageDigest.isEqual(expected, actual))
        } catch (e: Exception) { promise.reject("PIN_VERIFY", "Could not verify chat PIN", e) }
    }

    /** Protected items use an independent Android Keystore AES key per chat/project.
     * Never use the unrestricted whole-archive decrypt API for protected items.
     * The verifier is authenticated as AES-GCM associated data, preventing an
     * attacker from substituting a different PIN verifier for an existing blob. */
    private fun protectedAlias(kind: String, id: String): String {
        require(kind == "chat" || kind == "project") { "Unsupported protected item type" }
        require(id.matches(Regex("[A-Za-z0-9_-]{1,128}"))) { "Invalid protected item ID" }
        return "atlas.protected.v1.$kind.$id"
    }

    private fun pinMatches(pin: String, verifier: String): Boolean {
        require(verifier.startsWith("pin:v1:")) { "Unsupported PIN verifier" }
        val bytes = android.util.Base64.decode(verifier.removePrefix("pin:v1:"), android.util.Base64.NO_WRAP)
        require(bytes.size == 48) { "Invalid PIN verifier" }
        val spec = javax.crypto.spec.PBEKeySpec(pin.toCharArray(), bytes.copyOfRange(0, 16), 310000, 256)
        val actual = try { javax.crypto.SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded }
                     finally { spec.clearPassword() }
        return java.security.MessageDigest.isEqual(bytes.copyOfRange(16, 48), actual)
    }

    private fun protectedKey(kind: String, id: String, create: Boolean): javax.crypto.SecretKey {
        val alias = protectedAlias(kind, id)
        val store = java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (!store.containsAlias(alias)) {
            require(create) { "This item's encryption key is missing" }
            val generator = javax.crypto.KeyGenerator.getInstance("AES", "AndroidKeyStore")
            generator.init(android.security.keystore.KeyGenParameterSpec.Builder(alias,
                android.security.keystore.KeyProperties.PURPOSE_ENCRYPT or android.security.keystore.KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).build())
            generator.generateKey()
        }
        return store.getKey(alias, null) as javax.crypto.SecretKey
    }

    @ReactMethod
    fun encryptProtectedItem(kind: String, id: String, plain: String, pin: String, verifier: String, promise: Promise) {
        try {
            require(pin.matches(Regex("[0-9]{4,12}"))) { "PIN must have 4–12 digits" }
            require(pinMatches(pin, verifier)) { "Incorrect PIN" }
            val cipher = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(javax.crypto.Cipher.ENCRYPT_MODE, protectedKey(kind, id, true))
            cipher.updateAAD("$kind:$id:$verifier:v1".toByteArray(Charsets.UTF_8))
            val bytes = cipher.iv + cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
            promise.resolve("atlasitem:v1:" + android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP))
        } catch (e: Exception) { promise.reject("PROTECTED_ENCRYPT", "Could not encrypt protected item", e) }
    }

    @ReactMethod
    fun decryptProtectedItem(kind: String, id: String, blob: String, pin: String, verifier: String, promise: Promise) {
        try {
            require(pinMatches(pin, verifier)) { "Incorrect PIN" }
            require(blob.startsWith("atlasitem:v1:")) { "Unsupported encrypted item" }
            val bytes = android.util.Base64.decode(blob.removePrefix("atlasitem:v1:"), android.util.Base64.NO_WRAP)
            require(bytes.size >= 29) { "Damaged protected item" }
            val cipher = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(javax.crypto.Cipher.DECRYPT_MODE, protectedKey(kind, id, false),
                javax.crypto.spec.GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
            cipher.updateAAD("$kind:$id:$verifier:v1".toByteArray(Charsets.UTF_8))
            promise.resolve(String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8))
        } catch (e: Exception) { promise.reject("PROTECTED_DECRYPT", "Incorrect PIN or damaged protected item", e) }
    }

    @ReactMethod
    fun removeProtectedItemKey(kind: String, id: String, pin: String, verifier: String, promise: Promise) {
        try {
            require(pinMatches(pin, verifier)) { "Incorrect PIN" }
            val store = java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            store.deleteEntry(protectedAlias(kind, id))
            promise.resolve(true)
        } catch (e: Exception) { promise.reject("PROTECTED_KEY", "Could not revoke protected item key", e) }
    }

    /** Portable password-encrypted backup, independent of device-bound Keystore. */
    @ReactMethod
    fun encryptPortableBackup(plain: String, passphrase: String, promise: Promise) {
        try {
            require(passphrase.length >= 12) { "A backup password needs at least 12 characters" }
            val random = java.security.SecureRandom()
            val salt = ByteArray(16).also { random.nextBytes(it) }
            val keyFactory = javax.crypto.SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
            val spec = javax.crypto.spec.PBEKeySpec(passphrase.toCharArray(), salt, 310000, 256)
            val secret = try { keyFactory.generateSecret(spec).encoded } finally { spec.clearPassword() }
            val cipher = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(javax.crypto.Cipher.ENCRYPT_MODE, javax.crypto.spec.SecretKeySpec(secret, "AES"))
            cipher.updateAAD("atlas-portable-backup:v1".toByteArray(Charsets.UTF_8))
            val output = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
            val payload = salt + cipher.iv + output
            promise.resolve("atlasbackup:v1:" + android.util.Base64.encodeToString(payload, android.util.Base64.NO_WRAP))
        } catch (e: Exception) { promise.reject("BACKUP_ENCRYPT", "Backup encryption failed", e) }
    }

    @ReactMethod
    fun decryptPortableBackup(payload: String, passphrase: String, promise: Promise) {
        try {
            require(payload.startsWith("atlasbackup:v1:")) { "Unsupported encrypted backup" }
            val bytes = android.util.Base64.decode(payload.removePrefix("atlasbackup:v1:"), android.util.Base64.NO_WRAP)
            require(bytes.size >= 45) { "Damaged encrypted backup" }
            val salt = bytes.copyOfRange(0, 16)
            val iv = bytes.copyOfRange(16, 28)
            val keyFactory = javax.crypto.SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
            val spec = javax.crypto.spec.PBEKeySpec(passphrase.toCharArray(), salt, 310000, 256)
            val secret = try { keyFactory.generateSecret(spec).encoded } finally { spec.clearPassword() }
            val cipher = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(javax.crypto.Cipher.DECRYPT_MODE, javax.crypto.spec.SecretKeySpec(secret, "AES"), javax.crypto.spec.GCMParameterSpec(128, iv))
            cipher.updateAAD("atlas-portable-backup:v1".toByteArray(Charsets.UTF_8))
            promise.resolve(String(cipher.doFinal(bytes.copyOfRange(28, bytes.size)), Charsets.UTF_8))
        } catch (e: Exception) { promise.reject("BACKUP_DECRYPT", "Incorrect password or damaged backup", e) }
    }

    /** Opens the calendar app with a new event filled in - you confirm and save it there. */
    @ReactMethod
    fun addCalendarEvent(title: String, startMs: Double, endMs: Double, location: String, description: String, promise: Promise) {
        try {
            val i = Intent(Intent.ACTION_INSERT).setData(CalendarContract.Events.CONTENT_URI)
                .putExtra(CalendarContract.Events.TITLE, title)
                .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, startMs.toLong())
                .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, endMs.toLong())
                .putExtra(CalendarContract.Events.EVENT_LOCATION, location)
                .putExtra(CalendarContract.Events.DESCRIPTION, description)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ctx.startActivity(i)
            promise.resolve(true)
        } catch (e: Exception) { promise.reject("CAL_ADD", e.message ?: "Could not open the calendar", e) }
    }
}
