#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(DeviceMemoryModule, NSObject)

RCT_EXTERN_METHOD(getMemoryInfo:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
