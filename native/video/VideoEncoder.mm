#import "VideoEncoder.h"
#import <AVFoundation/AVFoundation.h>

BOOL OGEncodeVideo(sd_image_t *frames, int count, int fps, NSString *path,
                   const std::atomic_bool &cancelled, NSError **error) {
  if (!frames || count < 1 || fps < 1) return NO;
  AVAssetWriter *writer = [[AVAssetWriter alloc] initWithURL:[NSURL fileURLWithPath:path]
      fileType:AVFileTypeMPEG4 error:error];
  if (!writer) return NO;
  NSDictionary *settings = @{ AVVideoCodecKey: AVVideoCodecTypeH264,
      AVVideoWidthKey: @(frames[0].width), AVVideoHeightKey: @(frames[0].height) };
  AVAssetWriterInput *input = [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeVideo outputSettings:settings];
  input.expectsMediaDataInRealTime = NO;
  NSDictionary *attributes = @{ (id)kCVPixelBufferPixelFormatTypeKey: @(kCVPixelFormatType_32BGRA),
      (id)kCVPixelBufferWidthKey: @(frames[0].width), (id)kCVPixelBufferHeightKey: @(frames[0].height),
      (id)kCVPixelBufferIOSurfacePropertiesKey: @{} };
  AVAssetWriterInputPixelBufferAdaptor *adaptor = [AVAssetWriterInputPixelBufferAdaptor
      assetWriterInputPixelBufferAdaptorWithAssetWriterInput:input sourcePixelBufferAttributes:attributes];
  if (![writer canAddInput:input]) return NO;
  [writer addInput:input];
  if (![writer startWriting]) { if (error) *error = writer.error; return NO; }
  [writer startSessionAtSourceTime:kCMTimeZero];
  BOOL ok = YES;
  for (int i = 0; i < count && ok; ++i) {
    @autoreleasepool {
      // Bound a stalled encoder and permit Stop while waiting for its next buffer.
      NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:30];
      while (!input.readyForMoreMediaData && writer.status == AVAssetWriterStatusWriting &&
             !cancelled.load() && deadline.timeIntervalSinceNow > 0) [NSThread sleepForTimeInterval:0.01];
      if (cancelled.load() || !input.readyForMoreMediaData || frames[i].channel < 3 || !frames[i].data || frames[i].width != frames[0].width || frames[i].height != frames[0].height) { ok = NO; break; }
      CVPixelBufferRef buffer = nil;
      if (CVPixelBufferPoolCreatePixelBuffer(NULL, adaptor.pixelBufferPool, &buffer) != kCVReturnSuccess) { ok = NO; break; }
      CVPixelBufferLockBaseAddress(buffer, 0);
      auto *pixels = (uint8_t *)CVPixelBufferGetBaseAddress(buffer);
      size_t stride = CVPixelBufferGetBytesPerRow(buffer);
      for (uint32_t y = 0; y < frames[i].height; ++y) {
        for (uint32_t x = 0; x < frames[i].width; ++x) {
          const uint8_t *rgb = frames[i].data + (y * frames[i].width + x) * frames[i].channel;
          uint8_t *bgra = pixels + y * stride + x * 4;
          bgra[0] = rgb[2]; bgra[1] = rgb[1]; bgra[2] = rgb[0]; bgra[3] = 255;
        }
      }
      CVPixelBufferUnlockBaseAddress(buffer, 0);
      ok = [adaptor appendPixelBuffer:buffer withPresentationTime:CMTimeMake(i, fps)];
      CVPixelBufferRelease(buffer);
    }
  }
  if (ok) {
    [input markAsFinished];
    dispatch_semaphore_t finished = dispatch_semaphore_create(0);
    [writer finishWritingWithCompletionHandler:^{ dispatch_semaphore_signal(finished); }];
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:30];
    while (dispatch_semaphore_wait(finished, dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_MSEC * 100)) != 0) {
      if (cancelled.load() || deadline.timeIntervalSinceNow <= 0) { [writer cancelWriting]; break; }
    }
    ok = writer.status == AVAssetWriterStatusCompleted && !cancelled.load();
  }
  if (!ok) {
    if (error) *error = writer.error;
    [writer cancelWriting];
    [[NSFileManager defaultManager] removeItemAtPath:path error:nil];
  }
  return ok;
}
