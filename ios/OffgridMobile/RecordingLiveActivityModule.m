#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

// Bridges the Swift RecordingLiveActivityModule (Day-recorder Live Activity) to React Native.
@interface RCT_EXTERN_MODULE (RecordingLiveActivityModule, RCTEventEmitter)

RCT_EXTERN_METHOD(start : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(stop : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)

@end
