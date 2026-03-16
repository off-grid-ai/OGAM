# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# ============================================================================
# React Native
# ============================================================================

# Keep React Native bridge classes (native modules are accessed via reflection)
-keep,allowobfuscation @com.facebook.proguard.annotations.DoNotStrip class *
-keep,allowobfuscation @com.facebook.common.internal.DoNotStrip class *
-keepclassmembers class * {
    @com.facebook.proguard.annotations.DoNotStrip *;
    @com.facebook.common.internal.DoNotStrip *;
}

-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.** { *; }

# Keep native module classes so RN can find them by name
-keep class ai.offgridmobile.** { *; }

# Hermes bytecode engine
-keep class com.facebook.hermes.unicode.** { *; }

# ============================================================================
# OkHttp / Okio (used by RN networking)
# ============================================================================
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class okhttp3.** { *; }
-keep class okio.** { *; }

# ============================================================================
# PDFium (used by PDFExtractorModule)
# ============================================================================
-keep class io.legere.pdfiumandroid.** { *; }

# ============================================================================
# Coroutines
# ============================================================================
-dontwarn kotlinx.coroutines.**
-keep class kotlinx.coroutines.** { *; }

# ============================================================================
# General Android
# ============================================================================
-keepattributes Signature
-keepattributes *Annotation*
-keepattributes SourceFile,LineNumberTable
-keep public class * extends java.lang.Exception

# Keep JavaScript interface methods
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
