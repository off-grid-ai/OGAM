#pragma once
#ifdef __APPLE__
#include <OffgridVideoRuntime/stable-diffusion.h>
#else
#include "stable-diffusion.h"
#include "ggml-backend.h"
#endif
#include <atomic>
#include <limits>
#include <functional>
#include <mutex>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

namespace offgrid {
struct VideoRequest {
  std::string weight, vae, encoder, prompt, negative;
  int width, height, frames, fps, steps;
  float guidance;
  int64_t seed;
  std::string llm, embeddings, audioVae;
  // The model's tiny decoder (taew2_1 / taew2_2), when it is on disk: frames in seconds, no tiling.
  std::string taesd;
  float flowShift = 0;
  bool cpuOnly = false;
  bool skipNpu = false;
  int threads = 4;
  std::string imageFamily, imageSampler, imageScheduler;
  // Optional start image (Animate this photo, Continue): RGB, width x height x 3 of this request.
  std::vector<uint8_t> initImage;
};
// One instance per process. Both host bridges use the same native lifecycle.
class VideoRuntime {
  std::mutex contextMutex;
  std::mutex executionMutex;
  sd_ctx_t *context = nullptr;
  sd_ctx_t *imageContext = nullptr;
  std::string imagePath;
  // What the image context was loaded from and on, so a generation that fails on an accelerated
  // backend can reload one step down and try once more.
  VideoRequest imageLoad;
  enum class ImagePlace { npu, gpu, cpu } imagePlace = ImagePlace::gpu;
  // Whether the last loadContext placed the model on the CPU (by request, by rule or as its fallback).
  bool lastLoadOnCpu = false;
  sample_method_t imageSampler = EULER_SAMPLE_METHOD;
  scheduler_t imageScheduler = SCHEDULER_COUNT;
  sd_ctx_t *loadContext(const VideoRequest &request, std::string &preferred, bool image = false) {
      sd_ctx_params_t config;
      sd_ctx_params_init(&config);
      lastLoadOnCpu = false;
      if (request.imageFamily == "checkpoint") config.model_path = request.weight.c_str();
      else config.diffusion_model_path = request.weight.c_str();
      config.vae_path = request.vae.c_str();
      config.t5xxl_path = request.encoder.c_str();
      config.llm_path = request.llm.c_str();
      config.embeddings_connectors_path = request.embeddings.c_str();
      config.audio_vae_path = request.audioVae.c_str();
      config.taesd_path = request.taesd.c_str();
      config.enable_mmap = true;
      config.diffusion_flash_attn = true;
      config.auto_fit = true;
      config.eager_load = false;
#ifdef __ANDROID__
      // Probe the NPU before choosing it. Devices without a usable Hexagon
      // runtime retain Vulkan diffusion and the CPU conditioning fallback.
      sd_list_devices(nullptr, 0);
      const auto gpuDevice = ggml_backend_dev_by_name("Vulkan0");
      const std::string gpuDescription = gpuDevice ? ggml_backend_dev_description(gpuDevice) : "";
      const std::string vaeName = request.vae.substr(request.vae.find_last_of("/\\") + 1);
      const bool wanVae = vaeName == "wan_2.1_vae.safetensors" || vaeName == "wan2.2_vae.safetensors";
      const bool adrenoWan = wanVae && gpuDescription.find("Adreno") != std::string::npos;
      // The Hexagon backend returns a constant Wan DiT output: it ignores the
      // latent, timestep and prompt, so sampling leaves the start noise intact.
      // Adreno Vulkan crashes in the same DiT graph. Wan diffusion runs on CPU.
      const bool wanCpu = adrenoWan || (wanVae && !gpuDevice);
      // Adreno Vulkan also crashes in the SD/SDXL UNet graph (SIGSEGV in ggml_vk_build_graph,
      // ggml-vulkan.cpp:12252; OnePlus SM8635, RealVisXL Lightning Q4, 2026-10-27), and a crash ends the
      // process before any fallback can run. SD images on Adreno run on the CPU, as Wan diffusion does.
      const bool imageCpu = image && gpuDescription.find("Adreno") != std::string::npos;
      // An SD/SDXL image UNet does not fit the HTP0 cap, so the scheduler splits it across HTP0 and
      // Vulkan0, and Hexagon cannot compute on a view Vulkan holds ("HTP0 cannot execute MUL: tensor
      // (view) uses Vulkan0 buffer"; OnePlus SM8635, RealVisXL Lightning Q4, 2026-10-27). No sd.cpp
      // image has generated on HTP0, so images skip the NPU, as Wan does.
      const bool skipNpu = request.skipNpu || wanVae || image;

      for (size_t i = 0; i < ggml_backend_dev_count(); ++i) {
        auto device = ggml_backend_dev_get(i);
        const char *name = ggml_backend_dev_name(device);
        if (request.cpuOnly || skipNpu || std::string(name).rfind("HTP", 0) != 0) continue;
        try {
          auto probe = ggml_backend_dev_init(device, nullptr);
          if (!probe) continue;
          preferred = name;
          ggml_backend_free(probe);
          break;
        } catch (const std::exception &) {
          // An installed driver can still reject the DSP session.
        }
      }
      // Wan decode still loses the Adreno device between spatial tiles after
      // the matvec compiler workaround. Route this decoder to CPU before it can
      // invalidate the GPU context.
      const std::string vaeBackend = gpuDevice && !adrenoWan ? ",vae=Vulkan0" : ",vae=cpu";
      const std::string npuBackend = preferred + vaeBackend;
      const std::string gpuBackend = "Vulkan0,te=cpu" + vaeBackend;
      config.backend = preferred.empty() ? gpuBackend.c_str() : npuBackend.c_str();
      // Stream NPU weights from disk per graph segment. Keeping a second
      // complete copy on Vulkan retains the text encoder during diffusion and
      // can trigger Android's low-memory killer. The graph cap still controls
      // staging even though explicit disk placement disables auto-fit.
      if (!preferred.empty()) {
        config.params_backend = "disk";
        config.auto_fit = false;
      }
      config.max_vram = "HTP0=1.5";
      config.disable_prefetch = true;
#else
      // A Metal budget for the managed weights. Without one the Wan text encoder's 3.5 GB buffer
      // stayed resident through sampling and the VAE decode: on an iPhone 17 Pro Max (6 GB limit)
      // the decode ran under critical memory warnings, two clips ended with no frames and a third
      // took 798 s to decode. Within the budget the model manager releases it once it is used.
      if (!image) config.max_vram = "MTL0=4";
#endif
      config.n_threads = request.threads;
#ifdef __ANDROID__
      if (request.cpuOnly || wanCpu || imageCpu) {
#else
      if (request.cpuOnly) {
#endif
        config.backend = "cpu"; config.params_backend = nullptr; config.auto_fit = true;
        lastLoadOnCpu = true;
#ifdef __ANDROID__
        preferred.clear();
#endif
      }
      sd_ctx_t *loaded = nullptr;
#ifdef __ANDROID__
      try { loaded = new_sd_ctx(&config); }
      catch (const std::exception &) {
        if (request.cpuOnly || cancelled.load()) throw;
      }
      if (!loaded && !preferred.empty() && !cancelled.load()) {
        preferred.clear();
        config.params_backend = nullptr;
        config.auto_fit = true;
        config.backend = gpuBackend.c_str();
        try { loaded = new_sd_ctx(&config); }
        catch (const std::exception &) {
          if (cancelled.load()) throw;
        }
      }
      if (!loaded && !cancelled.load()) {
        config.backend = "cpu";
        lastLoadOnCpu = true;
        loaded = new_sd_ctx(&config);
      }
#else
      loaded = new_sd_ctx(&config);
#endif
      return loaded;
  }
public:
  ~VideoRuntime() {
    if (context) free_sd_ctx(context);
    if (imageContext) free_sd_ctx(imageContext);
  }
  std::atomic_bool cancelled{false};
  void cancel() {
    cancelled.store(true);
    std::lock_guard<std::mutex> guard(contextMutex);
    if (context) sd_cancel_generation(context, SD_CANCEL_ALL);
    if (imageContext) sd_cancel_generation(imageContext, SD_CANCEL_ALL);
  }
  void loadImage(const VideoRequest &request, const std::string &path) {
    std::unique_lock<std::mutex> execution(executionMutex, std::try_to_lock);
    if (!execution.owns_lock()) throw std::runtime_error("Image or video generation is running.");
    // Packs (a diffusion transformer, its LLM text encoder and VAE) load the same way; FLUX 3
    // Klein needs a newer engine than this one (stable-diffusion.cpp 8cd731e).
    static const std::set<std::string> families{"checkpoint", "qwen-image-2.1", "z-image", "flux2-klein"};
    if (!request.imageFamily.empty() && !families.count(request.imageFamily))
      throw std::runtime_error("This image model family is not supported.");
    const auto sampler = request.imageSampler.empty() ? EULER_SAMPLE_METHOD : str_to_sample_method(request.imageSampler.c_str());
    const auto scheduler = request.imageScheduler.empty() ? SCHEDULER_COUNT : str_to_scheduler(request.imageScheduler.c_str());
    if (sampler == SAMPLE_METHOD_COUNT || (!request.imageScheduler.empty() && scheduler == SCHEDULER_COUNT))
      throw std::runtime_error("The image sampler or scheduler is not supported.");
    {
      std::lock_guard<std::mutex> guard(contextMutex);
      if (imageContext) free_sd_ctx(imageContext);
      imageContext = nullptr; imagePath.clear();
    }
    std::string preferred;
    auto loaded = loadContext(request, preferred, true);
    if (!loaded) throw std::runtime_error("Could not load the image model pack.");
    std::lock_guard<std::mutex> guard(contextMutex);
    if (cancelled.load()) { free_sd_ctx(loaded); throw std::runtime_error("Image loading stopped."); }
    imageContext = loaded; imagePath = path;
    imageLoad = request;
    imagePlace = !preferred.empty() ? ImagePlace::npu : lastLoadOnCpu ? ImagePlace::cpu : ImagePlace::gpu;
    imageSampler = sampler;
    imageScheduler = scheduler == SCHEDULER_COUNT ? sd_get_default_scheduler(loaded, sampler) : scheduler;
  }
  void unloadImage() {
    std::unique_lock<std::mutex> execution(executionMutex, std::try_to_lock);
    if (!execution.owns_lock()) throw std::runtime_error("Image or video generation is running.");
    std::lock_guard<std::mutex> guard(contextMutex);
    if (imageContext) free_sd_ctx(imageContext);
    imageContext = nullptr; imagePath.clear();
  }
  std::string loadedImagePath() {
    std::lock_guard<std::mutex> guard(contextMutex);
    return imageContext ? imagePath : "";
  }
  void image(const VideoRequest &request,
             const std::function<void(int, int)> &progress,
             const std::function<void(const sd_image_t &)> &save,
             int previewInterval = 0,
             const std::function<void(int, const sd_image_t &)> &preview = {}) {
    std::unique_lock<std::mutex> execution(executionMutex, std::try_to_lock);
    if (!execution.owns_lock()) throw std::runtime_error("Image or video generation is running.");
    if (!imageContext) throw std::runtime_error("Image model is unloaded.");
    // The engine owns the result; free it whole, never its parts.
    sd_image_generation_result_t *result = nullptr;
    auto produced = [&] { return result && result->count == 1 && result->items[0].image.data; };
    auto cleanup = [&] {
      sd_set_progress_callback(nullptr, nullptr);
      sd_set_preview_callback(nullptr, PREVIEW_NONE, 0, false, false, nullptr);
      free_sd_image_generation_result(result);
      result = nullptr;
    };
    try {
      if (cancelled.load()) throw std::runtime_error("Image generation stopped.");
      sd_set_progress_callback([](int step, int total, float, void *data) {
        (*static_cast<const std::function<void(int, int)> *>(data))(step, total);
      }, const_cast<void *>(static_cast<const void *>(&progress)));
      if (preview && previewInterval > 0) {
        // Project the existing latent tensor. Do not run an extra VAE decode.
        sd_set_preview_callback([](int step, int count, sd_image_t* frames, bool, void* data) {
          if (count < 1 || !frames || !frames[0].data) return;
          try { (*static_cast<const std::function<void(int, const sd_image_t &)>*>(data))(step, frames[0]); }
          catch (...) { /* Optional previews must not fail generation. */ }
        }, PREVIEW_PROJ, previewInterval, true, false,
           const_cast<void*>(static_cast<const void*>(&preview)));
      }
      sd_img_gen_params_t params; sd_img_gen_params_init(&params);
      params.prompt = request.prompt.c_str(); params.negative_prompt = request.negative.c_str();
      params.width = request.width; params.height = request.height; params.seed = request.seed;
      params.batch_count = 1;
      params.sample_params.sample_steps = request.steps;
      params.sample_params.guidance.txt_cfg = request.guidance;
      params.sample_params.sample_method = imageSampler;
      params.sample_params.scheduler = imageScheduler;
      params.vae_tiling_params.enabled = true;
      bool made = generate_image(imageContext, &params, &result) && produced();
      // A graph that fails on an accelerated backend gets one more try one step down (NPU -> GPU,
      // GPU -> CPU), as loading falls back: the person gets an image, not an error.
      if (!made && imagePlace != ImagePlace::cpu && !cancelled.load()) {
        free_sd_image_generation_result(result); result = nullptr;
        VideoRequest retry = imageLoad;
        if (imagePlace == ImagePlace::npu) retry.skipNpu = true; else retry.cpuOnly = true;
        std::string preferred;
        sd_ctx_t *reloaded = loadContext(retry, preferred, true);
        if (reloaded) {
          std::lock_guard<std::mutex> guard(contextMutex);
          free_sd_ctx(imageContext);
          imageContext = reloaded;
          imageLoad = retry;
          imagePlace = lastLoadOnCpu ? ImagePlace::cpu : ImagePlace::gpu;
          made = generate_image(imageContext, &params, &result) && produced();
        }
      }
      if (!made) throw std::runtime_error("The image engine produced no image.");
      if (cancelled.load()) throw std::runtime_error("Image generation stopped.");
      save(result->items[0].image);
    } catch (...) { cleanup(); throw; }
    cleanup();
  }
  void run(const VideoRequest &request,
           const std::function<void(int, int)> &progress,
           const std::function<void(sd_image_t *, int, int)> &encode,
           const std::function<void(const char *)> &conditioning,
           const std::function<void(int, int)> &decodeProgress,
           const std::function<void(const sd_image_t &)> &preview) {
    std::unique_lock<std::mutex> execution(executionMutex, std::try_to_lock);
    if (!execution.owns_lock()) throw std::runtime_error("Video generation is already running.");
    sd_video_generation_result_t *result = nullptr;
    struct DecodeObserver {
      const std::function<void(int, int)> &progress;
      const std::function<void(const sd_image_t &)> &frame;
    } observer{decodeProgress, preview};
    auto cleanup = [&] {
      free_sd_video_generation_result(result);
      result = nullptr;
      sd_set_video_decode_callback(nullptr, nullptr, nullptr);
      sd_set_progress_callback(nullptr, nullptr);
      std::lock_guard<std::mutex> guard(contextMutex);
      if (context) free_sd_ctx(context);
      context = nullptr;
    };
    try {
      if (cancelled.load()) throw std::runtime_error("Video generation stopped.");
      std::string preferred;
      sd_ctx_t *loaded = loadContext(request, preferred);
      {
        std::lock_guard<std::mutex> guard(contextMutex);
        context = loaded;
      }
      if (!loaded) throw std::runtime_error("Could not load the video model pack.");
      if (cancelled.load()) throw std::runtime_error("Video generation stopped.");
      sd_set_progress_callback([](int step, int total, float, void *data) {
        (*static_cast<const std::function<void(int, int)> *>(data))(step, total);
      }, const_cast<void *>(static_cast<const void *>(&progress)));
      sd_set_video_decode_callback([](int completed, int total, void *data) {
        static_cast<DecodeObserver *>(data)->progress(completed, total);
      }, [](const sd_image_t *image, void *data) {
        try { static_cast<DecodeObserver *>(data)->frame(*image); }
        catch (...) { /* The optional preview must not fail generation. */ }
      }, &observer);
      sd_vid_gen_params_t params;
      sd_vid_gen_params_init(&params);
      params.prompt = request.prompt.c_str(); params.negative_prompt = request.negative.c_str();
      params.width = request.width; params.height = request.height;
      params.video_frames = request.frames; params.fps = request.fps; params.seed = request.seed;
      params.sample_params.sample_steps = request.steps;
      params.sample_params.guidance.txt_cfg = request.guidance;
      params.sample_params.flow_shift = request.flowShift > 0 ? request.flowShift : std::numeric_limits<float>::infinity();
      params.sample_params.sample_method = EULER_SAMPLE_METHOD;
      params.sample_params.scheduler = sd_get_default_scheduler(loaded, EULER_SAMPLE_METHOD);
      // The tiny decoder needs no tiling: it decodes the whole clip in one small graph.
      const bool tiny = !request.taesd.empty();
      params.vae_tiling_params.enabled = !tiny;
      if (request.initImage.size() == static_cast<size_t>(request.width) * request.height * 3)
        params.init_image = {static_cast<uint32_t>(request.width), static_cast<uint32_t>(request.height), 3,
                             const_cast<uint8_t *>(request.initImage.data())};
#ifdef __ANDROID__
      // Mobile Vulkan drivers can lose the device on a full temporal decode.
      // Keep each decode graph small instead of waiting for allocation failure:
      // a lost GPU cannot recover through the allocator's tiling retry.
      if (!tiny) {
        params.vae_tiling_params.temporal_tiling = true;
        params.vae_tiling_params.tile_size_w = 128;
        params.vae_tiling_params.tile_size_h = 128;
        params.vae_tiling_params.extra_tiling_args = "temporal_tile_frames=1";
      }
      conditioning(preferred.empty() ? "cpu" : "npu");
#else
      // Wan's stateful decoder retains causal feature caches between temporal
      // chunks. Bound the graph without dropping frames or changing resolution.
      const std::string vaeName = request.vae.substr(request.vae.find_last_of("/\\") + 1);
      if (!tiny && (vaeName == "wan_2.1_vae.safetensors" || vaeName == "wan2.2_vae.safetensors")) {
        params.vae_tiling_params.temporal_tiling = true;
        params.vae_tiling_params.extra_tiling_args = "temporal_tile_frames=1";
      }
      conditioning("");
#endif
      if (!generate_video(loaded, &params, &result) || !result || !result->frames || result->frame_count == 0)
        throw std::runtime_error(cancelled.load() ? "Video generation stopped." : "The video engine produced no frames.");
      if (cancelled.load()) throw std::runtime_error("Video generation stopped.");
      encode(result->frames, result->frame_count, result->fps > 0 ? result->fps : request.fps);
    } catch (...) { cleanup(); throw; }
    cleanup();
  }
};
}
