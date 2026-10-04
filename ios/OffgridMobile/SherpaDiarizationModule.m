#import <React/RCTBridgeModule.h>

// Bridges the Swift SherpaOnnxDiarization module (on-device diarization + voiceprints) to JS.
@interface RCT_EXTERN_MODULE (SherpaOnnxDiarization, NSObject)

RCT_EXTERN_METHOD(prepare:(NSDictionary *)model
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(diarize:(NSDictionary *)input
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(embed:(NSDictionary *)input
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
