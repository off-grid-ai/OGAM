#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <UIKit/UIKit.h>
#import <AVFoundation/AVFoundation.h>
#import <BackgroundTasks/BackgroundTasks.h>
#import "VideoEncoder.h"
#include "common/VideoRuntime.hpp"
#include <cstdio>
#include <cstring>

static BOOL OGSaveRgbPng(const sd_image_t &image, NSString *output) {
  if (!image.data || (image.channel != 3 && image.channel != 4)) return NO;
  CFDataRef data = CFDataCreate(kCFAllocatorDefault, image.data, image.width * image.height * image.channel);
  CGDataProviderRef provider = data ? CGDataProviderCreateWithCFData(data) : nullptr;
  CGColorSpaceRef color = CGColorSpaceCreateDeviceRGB();
  CGImageRef bitmap = provider ? CGImageCreate(image.width, image.height, 8, 8 * image.channel, image.width * image.channel, color, image.channel == 4 ? kCGImageAlphaLast : kCGImageAlphaNone, provider, nullptr, false, kCGRenderingIntentDefault) : nullptr;
  NSData *png = bitmap ? UIImagePNGRepresentation([UIImage imageWithCGImage:bitmap]) : nil;
  if (bitmap) CGImageRelease(bitmap);
  CGColorSpaceRelease(color); if (provider) CGDataProviderRelease(provider); if (data) CFRelease(data);
  return png && [png writeToFile:output atomically:YES];
}

@interface VideoGenerationModule : RCTEventEmitter <RCTBridgeModule>
@end
/// A start image as RGB at the clip size, centre-cropped to fill (Animate this photo, Continue).
static std::vector<uint8_t> OGInitImageRGB(NSString *path, int width, int height) {
  UIImage *image = [UIImage imageWithContentsOfFile:[path stringByReplacingOccurrencesOfString:@"file://" withString:@""]];
  if (!image.CGImage || width <= 0 || height <= 0) return {};
  std::vector<uint8_t> rgba(static_cast<size_t>(width) * height * 4);
  CGColorSpaceRef space = CGColorSpaceCreateDeviceRGB();
  CGContextRef context = CGBitmapContextCreate(rgba.data(), width, height, 8, width * 4, space,
                                               kCGImageAlphaNoneSkipLast | kCGBitmapByteOrder32Big);
  CGColorSpaceRelease(space);
  if (!context) return {};
  const CGFloat scale = MAX(width / image.size.width, height / image.size.height);
  const CGSize drawn = CGSizeMake(image.size.width * scale, image.size.height * scale);
  UIGraphicsPushContext(context);
  CGContextTranslateCTM(context, 0, height);
  CGContextScaleCTM(context, 1, -1);
  [image drawInRect:CGRectMake((width - drawn.width) / 2, (height - drawn.height) / 2, drawn.width, drawn.height)];
  UIGraphicsPopContext();
  CGContextRelease(context);
  std::vector<uint8_t> rgb(static_cast<size_t>(width) * height * 3);
  for (size_t pixel = 0, count = static_cast<size_t>(width) * height; pixel < count; ++pixel) {
    rgb[pixel * 3] = rgba[pixel * 4]; rgb[pixel * 3 + 1] = rgba[pixel * 4 + 1]; rgb[pixel * 3 + 2] = rgba[pixel * 4 + 2];
  }
  return rgb;
}

@implementation VideoGenerationModule {
  offgrid::VideoRuntime _runtime;
  dispatch_queue_t _worker;
  BOOL _busy;
  BOOL _listeners;
  BOOL _holdsIdleTimer;
  BOOL _previousIdleTimerDisabled;
  NSString *_videoInterruptionReason;
  NSString *_imageNativeError;
  BGTask *_continued;
  NSString *_taskIdentifier;
  dispatch_block_t _continuedWork;
}
RCT_EXPORT_MODULE(VideoGenerationModule)
+ (BOOL)requiresMainQueueSetup { return YES; }
// Start images and sd.cpp's in-process ESRGAN upscaler (exported by this runtime build) run here.
- (NSDictionary *)constantsToExport { return @{@"supportsInitImage": @YES, @"supportsUpscale": @YES}; }
- (instancetype)init {
  if ((self = [super init])) {
    _worker = dispatch_queue_create("ai.offgrid.video", DISPATCH_QUEUE_SERIAL);

    [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(backgrounded)
      name:UIApplicationDidEnterBackgroundNotification object:nil];
  }
  return self;
}
- (void)dealloc {
  [[NSNotificationCenter defaultCenter] removeObserver:self];
  if (_holdsIdleTimer) {
    BOOL previous = _previousIdleTimerDisabled;
    dispatch_async(dispatch_get_main_queue(), ^{ UIApplication.sharedApplication.idleTimerDisabled = previous; });
  }
}
- (void)keepScreenAwake {
  if (_holdsIdleTimer) return;
  _previousIdleTimerDisabled = UIApplication.sharedApplication.idleTimerDisabled;
  _holdsIdleTimer = YES;
  UIApplication.sharedApplication.idleTimerDisabled = YES;
}
- (void)restoreScreenIdleTimer {
  if (!_holdsIdleTimer) return;
  UIApplication.sharedApplication.idleTimerDisabled = _previousIdleTimerDisabled;
  _holdsIdleTimer = NO;
}
- (NSArray<NSString *> *)supportedEvents { return @[@"VideoGenerationProgress", @"SDImageProgress"]; }
- (void)startObserving { _listeners = YES; }
- (void)stopObserving { _listeners = NO; }
- (void)logLifecycle:(NSString *)detail {
  NSLog(@"[VideoLifecycle] %@", detail);
  if (_listeners) [self sendEventWithName:@"VideoGenerationProgress"
    body:@{@"lifecycle":detail, @"at":@([[NSDate date] timeIntervalSince1970] * 1000)}];
}
- (void)beginImageDiagnostics {
  @synchronized (self) { _imageNativeError = nil; }
  sd_set_log_callback([](enum sd_log_level_t level, const char *text, void *data) {
    if (!text) return;
    std::fputs(text, stderr);
    // Retain placement and failure evidence, without prompts or model contents.
    if (std::strstr(text, "prompt")) return;
    if (level < SD_LOG_WARN && !std::strstr(text, "auto-fit") &&
        !std::strstr(text, "backend") && !std::strstr(text, "MiB") &&
        !std::strstr(text, "sampling completed") && !std::strstr(text, "cancelling")) return;
    VideoGenerationModule *owner = (__bridge VideoGenerationModule *)data;
    NSString *detail = [NSString stringWithUTF8String:text];
    if (!detail) return;
    if (detail.length > 2048) detail = [detail substringToIndex:2048];
    if (level == SD_LOG_ERROR) {
      @synchronized (owner) { owner->_imageNativeError = detail; }
    }
    dispatch_async(dispatch_get_main_queue(), ^{
      if (owner->_listeners) [owner sendEventWithName:@"SDImageProgress" body:@{@"diagnostic":detail}];
    });
  }, (__bridge void *)self);
}
- (NSString *)finishImageDiagnostics:(NSString *)failure {
  sd_set_log_callback(nullptr, nullptr);
  @synchronized (self) {
    return failure && _imageNativeError.length
      ? [NSString stringWithFormat:@"%@ %@", failure, _imageNativeError] : failure;
  }
}
- (void)interruptVideo:(NSString *)reason {
  _videoInterruptionReason = reason;
  _runtime.cancel();
  if (_listeners) [self sendEventWithName:@"VideoGenerationProgress"
    body:@{@"interruption":reason}];
}
- (void)backgrounded {
  // Metal work must stop before the OS removes GPU access. Continued GPU tasks
  // are admitted separately by the background coordinator on supported systems.
  [self logLifecycle:[NSString stringWithFormat:@"background busy=%d admittedGPU=%d", _busy, _continued != nil]];
  if (_busy && !_continued) {
    [self interruptVideo:@"Video generation stopped when the app went into the background. Keep Off Grid open and try again."];
  }
}
- (void)emitStage:(NSString *)stage step:(int)step total:(int)total {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self->_videoInterruptionReason) return;
    if (@available(iOS 26.0, *)) {
      if (self->_continued && total > 0) {
        BGContinuedProcessingTask *task = (BGContinuedProcessingTask *)self->_continued;
        task.progress.totalUnitCount = total + 2;
        task.progress.completedUnitCount = MIN(step + 1, total + 1);
        [task updateTitle:@"Generating video" subtitle:stage];
      }
    }
    if (self->_listeners) [self sendEventWithName:@"VideoGenerationProgress"
      body:@{@"stage":stage, @"step":@(step), @"total":@(total)}];
  });
}
/// Upscale every frame of a clip with sd.cpp's ESRGAN, then write it at the clip's own rate.
RCT_REMAP_METHOD(upscaleVideo, upscaleVideo:(NSDictionary *)input resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSString *inputPath = input[@"inputPath"], *outputPath = input[@"outputPath"], *modelPath = input[@"modelPath"];
  const uint32_t factor = [input[@"scale"] unsignedIntValue] ?: 2;
  self->_runtime.cancelled.store(false);
  dispatch_async(self->_worker, ^{
    @autoreleasepool {
      AVAsset *asset = [AVAsset assetWithURL:[NSURL fileURLWithPath:inputPath]];
      AVAssetTrack *track = [[asset tracksWithMediaType:AVMediaTypeVideo] firstObject];
      NSError *error = nil;
      AVAssetReader *reader = track ? [AVAssetReader assetReaderWithAsset:asset error:&error] : nil;
      if (!reader) { reject(@"VIDEO_UPSCALE_FAILED", @"The clip has no video.", error); return; }
      AVAssetReaderTrackOutput *output = [AVAssetReaderTrackOutput assetReaderTrackOutputWithTrack:track
        outputSettings:@{(id)kCVPixelBufferPixelFormatTypeKey: @(kCVPixelFormatType_32BGRA)}];
      [reader addOutput:output];
      upscaler_ctx_t *upscaler = new_upscaler_ctx(modelPath.UTF8String, false, 4, 128, nullptr, nullptr);
      if (!upscaler) { reject(@"VIDEO_UPSCALE_FAILED", @"The upscaler model did not load.", nil); return; }
      std::vector<sd_image_t> frames;
      const int fps = MAX(1, (int)lroundf(track.nominalFrameRate));
      BOOL ok = [reader startReading];
      while (ok && !self->_runtime.cancelled.load()) {
        CMSampleBufferRef sample = [output copyNextSampleBuffer];
        if (!sample) break;
        CVPixelBufferRef pixels = CMSampleBufferGetImageBuffer(sample);
        CVPixelBufferLockBaseAddress(pixels, kCVPixelBufferLock_ReadOnly);
        const size_t w = CVPixelBufferGetWidth(pixels), h = CVPixelBufferGetHeight(pixels), stride = CVPixelBufferGetBytesPerRow(pixels);
        const uint8_t *bgra = static_cast<const uint8_t *>(CVPixelBufferGetBaseAddress(pixels));
        std::vector<uint8_t> rgb(w * h * 3);
        for (size_t y = 0; y < h; ++y) for (size_t x = 0; x < w; ++x) {
          const uint8_t *p = bgra + y * stride + x * 4;
          rgb[(y * w + x) * 3] = p[2]; rgb[(y * w + x) * 3 + 1] = p[1]; rgb[(y * w + x) * 3 + 2] = p[0];
        }
        CVPixelBufferUnlockBaseAddress(pixels, kCVPixelBufferLock_ReadOnly);
        CFRelease(sample);
        sd_image_t *up = nullptr; int count = 0;
        if (!upscale(upscaler, {static_cast<uint32_t>(w), static_cast<uint32_t>(h), 3, rgb.data()}, factor, &up, &count) || !up || count < 1) { ok = NO; break; }
        frames.push_back(up[0]);
        free(up);
      }
      free_upscaler_ctx(upscaler);
      NSError *encodeError = nil;
      if (ok && !frames.empty() && !self->_runtime.cancelled.load())
        ok = OGEncodeVideo(frames.data(), static_cast<int>(frames.size()), fps, outputPath, self->_runtime.cancelled, &encodeError);
      else ok = NO;
      for (auto &frame : frames) free(frame.data);
      if (ok) resolve(@{@"path": outputPath});
      else reject(@"VIDEO_UPSCALE_FAILED", encodeError.localizedDescription ?: @"Could not upscale the clip.", encodeError);
    }
  });
}
RCT_REMAP_METHOD(cancel, cancelWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    self->_runtime.cancel();
    if (self->_continuedWork) {
      if (self->_taskIdentifier) [BGTaskScheduler.sharedScheduler cancelTaskRequestWithIdentifier:self->_taskIdentifier];
      dispatch_block_t pending = self->_continuedWork; self->_continuedWork = nil;
      pending(); // The worker observes cancellation and settles the JS promise.
    }
    resolve(nil);
  });
}
RCT_REMAP_METHOD(generate, generate:(NSDictionary *)input resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  // The request's paths and prompt become std::string; a missing one ([nil UTF8String] is NULL) is
  // undefined behaviour there, so it is refused here instead.
  for (NSString *key in @[@"weight", @"vae", @"prompt", @"outputPath"]) {
    if (![input[key] isKindOfClass:NSString.class]) {
      reject(@"VIDEO_BAD_REQUEST", [NSString stringWithFormat:@"The video request has no %@.", key], nil);
      return;
    }
  }
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self->_busy) { reject(@"VIDEO_BUSY", @"Video generation is already running.", nil); return; }
    self->_busy = YES; self->_runtime.cancelled.store(false);
    self->_videoInterruptionReason = nil;
    [self keepScreenAwake];
    [self startContinuedWork:^{
    dispatch_async(self->_worker, ^{
      @autoreleasepool {
        NSString *output = input[@"outputPath"];
        NSError *failure = nil;
        // Keep targeted runtime diagnostics in the same persistent lifecycle log.
        sd_set_log_callback([](enum sd_log_level_t, const char *text, void *data) {
          if (!text) return;
          std::fputs(text, stderr);
          if (!std::strstr(text, "Wan VAE decode backend=")) return;
          VideoGenerationModule *owner = (__bridge VideoGenerationModule *)data;
          NSString *detail = [NSString stringWithUTF8String:text];
          dispatch_async(dispatch_get_main_queue(), ^{ [owner logLifecycle:detail]; });
        }, (__bridge void *)self);
        try {
          offgrid::VideoRequest request{
            [input[@"weight"] UTF8String], [input[@"vae"] UTF8String], [(input[@"encoder"] ?: @"") UTF8String],
            [input[@"prompt"] UTF8String], [(input[@"negativePrompt"] ?: @"") UTF8String],
            [input[@"width"] intValue], [input[@"height"] intValue], [input[@"frames"] intValue],
            [input[@"fps"] intValue], [input[@"steps"] intValue], [input[@"guidance"] floatValue], [input[@"seed"] longLongValue]
          };
          request.llm = [(input[@"llm"] ?: @"") UTF8String];
          request.embeddings = [(input[@"embeddings"] ?: @"") UTF8String];
          request.audioVae = [(input[@"audioVae"] ?: @"") UTF8String];
          request.flowShift = [input[@"flowShift"] floatValue];
          // Fastest settings' choice: the CPU when it was placed there, Metal otherwise.
          request.cpuOnly = [input[@"backend"] isEqual:@"cpu"];
          if ([input[@"initImage"] isKindOfClass:NSString.class])
            request.initImage = OGInitImageRGB(input[@"initImage"], request.width, request.height);
          [self emitStage:@"preparing" step:0 total:request.steps];
          self->_runtime.run(request, [&](int step, int total) {
            [self emitStage:@"generating" step:step total:total];
          }, [&](sd_image_t *frames, int count, int fps) {
            [self emitStage:@"encoding" step:0 total:count];
            NSError *encodingError = nil;
            if (!OGEncodeVideo(frames, count, fps, output, self->_runtime.cancelled, &encodingError))
              throw std::runtime_error(encodingError ? encodingError.localizedDescription.UTF8String : "Video encoding stopped.");
          }, [&](const char *) { [self emitStage:@"conditioning" step:0 total:0]; },
          [&](int completed, int total) { [self emitStage:@"decoding" step:completed total:total]; },
          [&](const sd_image_t &image) {
            if (self->_runtime.cancelled.load()) return;
            NSString *path = [output stringByAppendingString:@".preview.png"];
            @try {
              if (!OGSaveRgbPng(image, path)) return;
            } @catch (NSException *exception) {
              [[NSFileManager defaultManager] removeItemAtPath:path error:nil];
              return;
            }
            NSDictionary *preview = @{@"path":path, @"width":@(image.width), @"height":@(image.height)};
            dispatch_async(dispatch_get_main_queue(), ^{
              if (self->_listeners) [self sendEventWithName:@"VideoGenerationProgress"
                  body:@{@"stage":@"encoding", @"step":@0, @"total":@0, @"preview":preview}];
            });
          });
        } catch (const std::exception &error) {
          failure = [NSError errorWithDomain:@"OffgridVideo" code:1 userInfo:@{NSLocalizedDescriptionKey:@(error.what())}];
          [[NSFileManager defaultManager] removeItemAtPath:output error:nil];
        }
        sd_set_log_callback(nullptr, nullptr);
        dispatch_async(dispatch_get_main_queue(), ^{
          self->_busy = NO;
          [self restoreScreenIdleTimer];
          if (self->_continued) {
            [self->_continued setTaskCompletedWithSuccess:failure == nil]; self->_continued = nil;
          }
          if (failure && self->_videoInterruptionReason)
            reject(@"VIDEO_BACKGROUND_INTERRUPTED", self->_videoInterruptionReason, failure);
          else if (failure) reject(self->_runtime.cancelled.load() ? @"VIDEO_CANCELLED" : @"VIDEO_FAILED", failure.localizedDescription, failure);
          else resolve(@{@"path":output});
        });
      }
    });
    }];
  });
}
RCT_REMAP_METHOD(getLoadedImagePath, imagePathWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  auto path = _runtime.loadedImagePath(); resolve(path.empty() ? nil : @(path.c_str()));
}
RCT_REMAP_METHOD(loadImageModel, loadImage:(NSDictionary *)input resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self->_busy) { reject(@"IMAGE_BUSY", @"Image or video generation is running.", nil); return; }
    self->_busy = YES; self->_runtime.cancelled.store(false);
    dispatch_async(self->_worker, ^{
      NSString *failure = nil;
      [self beginImageDiagnostics];
      try {
        offgrid::VideoRequest request{};
        request.weight = [input[@"weight"] UTF8String]; request.vae = [(input[@"vae"] ?: @"") UTF8String];
        request.llm = [(input[@"llm"] ?: @"") UTF8String];
        request.imageFamily = [(input[@"family"] ?: @"") UTF8String];
        request.imageSampler = [(input[@"sampler"] ?: @"") UTF8String];
        request.imageScheduler = [(input[@"scheduler"] ?: @"") UTF8String];
        request.threads = [input[@"threads"] intValue]; request.cpuOnly = [input[@"cpuOnly"] boolValue];
        self->_runtime.loadImage(request, [input[@"modelPath"] UTF8String]);
      } catch (const std::exception &error) { failure = @(error.what()); }
      failure = [self finishImageDiagnostics:failure];
      dispatch_async(dispatch_get_main_queue(), ^{
        self->_busy = NO;
        if (failure) reject(@"IMAGE_LOAD_FAILED", failure, nil); else resolve(@YES);
      });
    });
  });
}
RCT_REMAP_METHOD(unloadImageModel, unloadImageWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self->_busy) { reject(@"IMAGE_BUSY", @"Image or video generation is running.", nil); return; }
    self->_busy = YES;
    dispatch_async(self->_worker, ^{
      NSString *failure = nil;
      try { self->_runtime.unloadImage(); } catch (const std::exception &error) { failure = @(error.what()); }
      dispatch_async(dispatch_get_main_queue(), ^{
        self->_busy = NO;
        if (failure) reject(@"IMAGE_UNLOAD_FAILED", failure, nil); else resolve(@YES);
      });
    });
  });
}
RCT_REMAP_METHOD(generateImage, generateImage:(NSDictionary *)input resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self->_busy) { reject(@"IMAGE_BUSY", @"Image or video generation is running.", nil); return; }
    self->_busy = YES; self->_runtime.cancelled.store(false);
    [self keepScreenAwake];
    dispatch_async(self->_worker, ^{
      @autoreleasepool {
        NSString *output = input[@"outputPath"];
        NSString *failure = nil;
        [self beginImageDiagnostics];
        try {
          offgrid::VideoRequest request{};
          request.prompt = [input[@"prompt"] UTF8String]; request.negative = [input[@"negativePrompt"] UTF8String];
          request.width = [input[@"width"] intValue]; request.height = [input[@"height"] intValue];
          request.steps = [input[@"steps"] intValue]; request.guidance = [input[@"guidanceScale"] floatValue]; request.seed = [input[@"seed"] longLongValue];
          if (request.width < 64 || request.width > 2048 || request.height < 64 || request.height > 2048 || request.width % 16 || request.height % 16)
            throw std::runtime_error("Image dimensions are not supported.");
          self->_runtime.image(request, [&](int step, int total) {
            dispatch_async(dispatch_get_main_queue(), ^{
              if (self->_listeners) [self sendEventWithName:@"SDImageProgress" body:@{@"step":@(step), @"totalSteps":@(total), @"progress":@(total > 0 ? double(step) / total : 0)}];
            });
          }, [&](const sd_image_t &image) {
            if (!image.data || (image.channel != 3 && image.channel != 4) || image.width != request.width || image.height != request.height)
              throw std::runtime_error("The image engine returned invalid pixels.");
            if (!OGSaveRgbPng(image, output)) throw std::runtime_error("Could not save the image.");
          }, std::max(0, [input[@"previewInterval"] intValue]), [&](int step, const sd_image_t &image) {
            NSString *path = [output stringByAppendingString:@".preview.png"];
            if (!OGSaveRgbPng(image, path)) return;
            const int total = request.steps;
            dispatch_async(dispatch_get_main_queue(), ^{
              if (self->_listeners) [self sendEventWithName:@"SDImageProgress" body:@{
                @"step":@(step), @"totalSteps":@(total), @"progress":@(total > 0 ? double(step) / total : 0), @"previewPath":path
              }];
            });
          });
          if (self->_runtime.cancelled.load()) throw std::runtime_error("Image generation stopped.");
        } catch (const std::exception &error) {
          failure = @(error.what()); [[NSFileManager defaultManager] removeItemAtPath:output error:nil];
        }
        failure = [self finishImageDiagnostics:failure];
        dispatch_async(dispatch_get_main_queue(), ^{
          self->_busy = NO;
          [self restoreScreenIdleTimer];
          [[NSFileManager defaultManager] removeItemAtPath:[output stringByAppendingString:@".preview.png"] error:nil];
          if (failure) reject(@"IMAGE_FAILED", failure, nil);
          else resolve(@{@"id":input[@"id"], @"imagePath":output, @"width":input[@"width"], @"height":input[@"height"], @"seed":input[@"seed"]});
        });
      }
    });
  });
}
- (void)startContinuedWork:(dispatch_block_t)work {
  _continuedWork = [work copy];
  if (@available(iOS 26.0, *)) {
    BGContinuedProcessingTaskRequestResources resources = BGTaskScheduler.supportedResources;
    [self logLifecycle:[NSString stringWithFormat:@"supportedBackgroundResources=%lu gpu=%d", (unsigned long)resources, (resources & BGContinuedProcessingTaskRequestResourcesGPU) != 0]];
    if (resources & BGContinuedProcessingTaskRequestResourcesGPU) {
      if (!_taskIdentifier) {
        _taskIdentifier = [NSString stringWithFormat:@"%@.video.generation", NSBundle.mainBundle.bundleIdentifier];
        __weak VideoGenerationModule *weakSelf = self;
        BOOL registered = [BGTaskScheduler.sharedScheduler registerForTaskWithIdentifier:_taskIdentifier usingQueue:dispatch_get_main_queue() launchHandler:^(BGTask *task) {
          VideoGenerationModule *owner = weakSelf;
          if (!owner || !owner->_busy) { [task setTaskCompletedWithSuccess:NO]; return; }
          owner->_continued = task;
          [owner logLifecycle:[NSString stringWithFormat:@"admitted continued GPU task %@", task.identifier]];
          __weak BGTask *expiringTask = task;
          task.expirationHandler = ^{
            dispatch_async(dispatch_get_main_queue(), ^{
              VideoGenerationModule *active = weakSelf;
              if (active && active->_continued == expiringTask && active->_busy) {
                [active logLifecycle:[NSString stringWithFormat:@"continued GPU task expired %@", expiringTask.identifier]];
                [active interruptVideo:@"iOS stopped background video generation. Keep Off Grid open and try again."];
              }
            });
          };
          dispatch_block_t admitted = owner->_continuedWork; owner->_continuedWork = nil;
          if (admitted) admitted();
        }];
        [self logLifecycle:[NSString stringWithFormat:@"registration %@ success=%d", _taskIdentifier, registered]];
        if (!registered) { _taskIdentifier = nil; _continuedWork = nil; work(); return; }
      }
      BGContinuedProcessingTaskRequest *request = [[BGContinuedProcessingTaskRequest alloc] initWithIdentifier:_taskIdentifier title:@"Generating video" subtitle:@"Loading model"];
      request.requiredResources = BGContinuedProcessingTaskRequestResourcesGPU;
      request.strategy = BGContinuedProcessingTaskRequestSubmissionStrategyFail;
      NSError *submissionError = nil;
      if ([BGTaskScheduler.sharedScheduler submitTaskRequest:request error:&submissionError]) {
        [self logLifecycle:[NSString stringWithFormat:@"submitted continued GPU task %@", _taskIdentifier]];
        return;
      }
      [self logLifecycle:[NSString stringWithFormat:@"continued GPU task refused domain=%@ code=%ld detail=%@", submissionError.domain, (long)submissionError.code, submissionError.localizedDescription]];
    }
  }
  [self logLifecycle:[NSString stringWithFormat:@"running in foreground without admitted background GPU access"]];
  _continuedWork = nil;
  work();
}
@end
