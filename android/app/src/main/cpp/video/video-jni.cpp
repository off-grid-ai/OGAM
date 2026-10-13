#include <jni.h>
#include <android/log.h>
#include <limits>
#include "VideoRuntime.hpp"

static offgrid::VideoRuntime runtime;

class AttachedEnv {
  JavaVM *vm;
  bool attached = false;
public:
  JNIEnv *env = nullptr;
  explicit AttachedEnv(JavaVM *value) : vm(value) {
    if (vm->GetEnv(reinterpret_cast<void **>(&env), JNI_VERSION_1_6) == JNI_EDETACHED) {
      attached = vm->AttachCurrentThread(&env, nullptr) == JNI_OK;
      if (!attached) env = nullptr;
    }
  }
  ~AttachedEnv() { if (attached) vm->DetachCurrentThread(); }
};

static std::string string(JNIEnv *env, jstring value) {
  if (!value) throw std::runtime_error("Missing video argument.");
  const char *bytes = env->GetStringUTFChars(value, nullptr);
  if (!bytes) throw std::runtime_error("Missing video argument.");
  std::string result(bytes);
  env->ReleaseStringUTFChars(value, bytes);
  return result;
}

extern "C" JNIEXPORT void JNICALL Java_ai_offgridmobile_video_VideoGenerationModule_nativePrepare(JNIEnv *, jobject) {
#ifndef NDEBUG
  sd_set_log_callback([](sd_log_level_t level, const char *text, void *) {
    const int priority = level == SD_LOG_ERROR ? ANDROID_LOG_ERROR :
      level == SD_LOG_WARN ? ANDROID_LOG_WARN : ANDROID_LOG_DEBUG;
    __android_log_write(priority, "OffgridVideo", text);
  }, nullptr);
#endif
  runtime.cancelled.store(false);
}
extern "C" JNIEXPORT void JNICALL Java_ai_offgridmobile_video_VideoGenerationModule_nativeCancel(JNIEnv *, jobject) { runtime.cancel(); }
extern "C" JNIEXPORT void JNICALL Java_ai_offgridmobile_video_VideoGenerationModule_nativeSetRuntimeDirectory(JNIEnv *env, jobject, jstring path) {
  try {
    auto directory = string(env, path);
    const char *existing = getenv("ADSP_LIBRARY_PATH");
    std::string search = directory + ";" + (existing ? existing : "/vendor/lib/rfsa/adsp;/vendor/dsp;/system/lib/rfsa/adsp;/dsp");
    if (setenv("ADSP_LIBRARY_PATH", search.c_str(), 1) != 0 ||
        setenv("OFFGRID_VIDEO_HTP_DIR", directory.c_str(), 1) != 0)
      throw std::runtime_error("Could not configure the NPU runtime.");
  } catch (const std::exception &error) {
    if (!env->ExceptionCheck()) {
      auto klass = env->FindClass("java/lang/IllegalStateException");
      if (klass) { env->ThrowNew(klass, error.what()); env->DeleteLocalRef(klass); }
    }
  }
}
extern "C" JNIEXPORT void JNICALL Java_ai_offgridmobile_video_VideoGenerationModule_nativeGenerate(
  JNIEnv *env, jobject self, jstring weight, jstring vae, jstring encoder, jstring prompt, jstring negative,
  jint width, jint height, jint frames, jint fps, jint steps, jdouble guidance, jdouble seed, jstring llm, jstring embeddings, jstring audioVae, jdouble flowShift, jstring diagnosticBackend) {
  jobject owner = nullptr;
  try {
    offgrid::VideoRequest request{string(env, weight), string(env, vae), string(env, encoder), string(env, prompt), string(env, negative), width, height, frames, fps, steps, (float)guidance, (int64_t)seed};
    request.llm = string(env, llm);
    request.embeddings = string(env, embeddings);
    request.audioVae = string(env, audioVae);
    request.flowShift = (float)flowShift;
    const auto backend = string(env, diagnosticBackend);
    request.cpuOnly = backend == "cpu";
    request.skipNpu = backend == "gpu";
    JavaVM *vm = nullptr;
    if (env->GetJavaVM(&vm) != JNI_OK) throw std::runtime_error("Could not access the video host.");
    owner = env->NewGlobalRef(self);
    if (!owner) throw std::runtime_error("Not enough memory to start video generation.");
    auto klass = env->GetObjectClass(self);
    auto progress = env->GetMethodID(klass, "progress", "(II)V");
    auto conditioning = env->GetMethodID(klass, "conditioning", "(Ljava/lang/String;)V");
    auto frame = env->GetMethodID(klass, "frame", "([BIII)V");
    auto decodeProgress = env->GetMethodID(klass, "decoding", "(II)V");
    auto preview = env->GetMethodID(klass, "preview", "([BII)V");
    env->DeleteLocalRef(klass);
    if (!progress || !frame || !conditioning || !decodeProgress || !preview) throw std::runtime_error("Missing video host callbacks.");
    std::atomic_bool callbackFailed{false};
    runtime.run(request, [&](int step, int total) {
      // The engine may report progress from a worker thread. JNI environments
      // are thread-local; never retain the caller's environment in this callback.
      AttachedEnv thread(vm);
      if (!thread.env) { callbackFailed.store(true); runtime.cancel(); return; }
      thread.env->CallVoidMethod(owner, progress, step, total);
      if (thread.env->ExceptionCheck()) {
        thread.env->ExceptionClear();
        callbackFailed.store(true);
        runtime.cancel();
      }
    }, [&](sd_image_t *images, int count, int) {
      if (callbackFailed.load()) throw std::runtime_error("Could not report video progress.");
      for (int i = 0; i < count; ++i) {
        if (runtime.cancelled.load()) throw std::runtime_error("Video generation stopped.");
        auto &image = images[i];
        const uint64_t size = uint64_t(image.width) * image.height * image.channel;
        if (!image.data || image.width != uint32_t(width) || image.height != uint32_t(height) ||
            image.channel != 3 || size > uint64_t(std::numeric_limits<jsize>::max()))
          throw std::runtime_error("The video engine returned an invalid frame.");
        auto bytes = env->NewByteArray(static_cast<jsize>(size));
        if (!bytes) throw std::runtime_error("Not enough memory to encode video.");
        env->SetByteArrayRegion(bytes, 0, static_cast<jsize>(size), reinterpret_cast<jbyte *>(image.data));
        if (!env->ExceptionCheck()) env->CallVoidMethod(owner, frame, bytes, image.width, image.height, image.channel);
        env->DeleteLocalRef(bytes);
        if (env->ExceptionCheck()) throw std::runtime_error("Video encoder failed.");
      }
    }, [&](const char *backend) {
      auto hardware = env->NewStringUTF(backend);
      env->CallVoidMethod(owner, conditioning, hardware);
      env->DeleteLocalRef(hardware);
      if (env->ExceptionCheck()) throw std::runtime_error("Could not report prompt processing.");
    }, [&](int completed, int total) {
      AttachedEnv thread(vm);
      if (!thread.env) return;
      thread.env->CallVoidMethod(owner, decodeProgress, completed, total);
      if (thread.env->ExceptionCheck()) thread.env->ExceptionClear();
    }, [&](const sd_image_t &image) {
      // A preview is optional. Its failure must not discard a completed decode.
      const uint64_t size = uint64_t(image.width) * image.height * image.channel;
      if (!image.data || image.channel != 3 || size > uint64_t(std::numeric_limits<jsize>::max())) return;
      AttachedEnv thread(vm);
      if (!thread.env || runtime.cancelled.load()) return;
      auto bytes = thread.env->NewByteArray(static_cast<jsize>(size));
      if (bytes) {
        thread.env->SetByteArrayRegion(bytes, 0, static_cast<jsize>(size), reinterpret_cast<jbyte *>(image.data));
        if (!thread.env->ExceptionCheck()) thread.env->CallVoidMethod(owner, preview, bytes, image.width, image.height);
        thread.env->DeleteLocalRef(bytes);
      }
      if (thread.env->ExceptionCheck()) thread.env->ExceptionClear();
    });
  } catch (const std::exception &error) {
    if (!env->ExceptionCheck()) {
      auto klass = env->FindClass("java/lang/IllegalStateException");
      if (klass) { env->ThrowNew(klass, error.what()); env->DeleteLocalRef(klass); }
    }
  }
  if (owner) env->DeleteGlobalRef(owner);
}

extern "C" JNIEXPORT void JNICALL Java_ai_offgridmobile_video_VideoGenerationModule_nativeLoadImage(
  JNIEnv *env, jobject, jstring path, jstring weight, jstring vae, jstring llm, jint threads, jboolean cpuOnly, jstring family, jstring sampler, jstring scheduler) {
  try {
    offgrid::VideoRequest request{};
    request.weight = string(env, weight); request.vae = string(env, vae); request.llm = string(env, llm);
    request.threads = threads; request.cpuOnly = cpuOnly;
    request.imageFamily = string(env, family); request.imageSampler = string(env, sampler); request.imageScheduler = string(env, scheduler);
    runtime.loadImage(request, string(env, path));
  } catch (const std::exception &error) {
    auto klass = env->FindClass("java/lang/IllegalStateException");
    if (klass) { env->ThrowNew(klass, error.what()); env->DeleteLocalRef(klass); }
  }
}
extern "C" JNIEXPORT jstring JNICALL Java_ai_offgridmobile_video_VideoGenerationModule_nativeImagePath(JNIEnv *env, jobject) {
  return env->NewStringUTF(runtime.loadedImagePath().c_str());
}
extern "C" JNIEXPORT void JNICALL Java_ai_offgridmobile_video_VideoGenerationModule_nativeUnloadImage(JNIEnv *env, jobject) {
  try { runtime.unloadImage(); }
  catch (const std::exception &error) {
    auto klass = env->FindClass("java/lang/IllegalStateException");
    if (klass) { env->ThrowNew(klass, error.what()); env->DeleteLocalRef(klass); }
  }
}
extern "C" JNIEXPORT jbyteArray JNICALL Java_ai_offgridmobile_video_VideoGenerationModule_nativeGenerateImage(
  JNIEnv *env, jobject self, jstring prompt, jstring negative, jint width, jint height, jint steps, jdouble guidance, jdouble seed, jint previewInterval) {
  jbyteArray output = nullptr;
  jobject owner = nullptr;
  try {
    offgrid::VideoRequest request{};
    request.prompt = string(env, prompt); request.negative = string(env, negative);
    request.width = width; request.height = height; request.steps = steps; request.guidance = guidance; request.seed = seed;
    JavaVM *vm = nullptr;
    if (env->GetJavaVM(&vm) != JNI_OK) throw std::runtime_error("Could not access the image host.");
    owner = env->NewGlobalRef(self);
    if (!owner) throw std::runtime_error("Could not retain the image host.");
    auto klass = env->GetObjectClass(self);
    auto progress = env->GetMethodID(klass, "imageProgress", "(II)V");
    auto preview = env->GetMethodID(klass, "imagePreview", "([BIIII)V");
    env->DeleteLocalRef(klass);
    if (!progress || !preview) throw std::runtime_error("Missing image progress callback.");
    runtime.image(request, [&](int step, int total) {
      AttachedEnv thread(vm);
      if (!thread.env) { runtime.cancel(); return; }
      thread.env->CallVoidMethod(owner, progress, step, total);
      if (thread.env->ExceptionCheck()) { thread.env->ExceptionClear(); runtime.cancel(); }
    }, [&](const sd_image_t &image) {
      const uint64_t size = uint64_t(image.width) * image.height * image.channel;
      if (!image.data || image.width != uint32_t(width) || image.height != uint32_t(height) || (image.channel != 3 && image.channel != 4) || size > INT32_MAX)
        throw std::runtime_error("The image engine returned invalid pixels.");
      output = env->NewByteArray(static_cast<jsize>(size));
      if (!output) throw std::runtime_error("Not enough memory to save the image.");
      env->SetByteArrayRegion(output, 0, size, reinterpret_cast<jbyte *>(image.data));
    }, previewInterval, [&](int step, const sd_image_t &image) {
      const uint64_t size = uint64_t(image.width) * image.height * image.channel;
      if (!image.data || (image.channel != 3 && image.channel != 4) || size > INT32_MAX) return;
      AttachedEnv thread(vm);
      if (!thread.env) return;
      jbyteArray bytes = thread.env->NewByteArray(static_cast<jsize>(size));
      if (bytes) {
        thread.env->SetByteArrayRegion(bytes, 0, size, reinterpret_cast<jbyte *>(image.data));
        thread.env->CallVoidMethod(owner, preview, bytes, image.width, image.height, image.channel, step);
        thread.env->DeleteLocalRef(bytes);
      }
      if (thread.env->ExceptionCheck()) thread.env->ExceptionClear();
    });
  } catch (const std::exception &error) {
    if (!env->ExceptionCheck()) {
      auto klass = env->FindClass("java/lang/IllegalStateException");
      if (klass) { env->ThrowNew(klass, error.what()); env->DeleteLocalRef(klass); }
    }
  }
  if (owner) env->DeleteGlobalRef(owner);
  return output;
}
