#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(OffgridConfinedFile, NSObject)

RCT_EXTERN_METHOD(deleteConfinedRegularFile:(NSDictionary *)input
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(moveConfinedRegularFile:(NSDictionary *)input
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(restoreConfinedRegularFile:(NSDictionary *)input
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(adoptLegacyConfinedQuarantineReceipt:(NSDictionary *)input
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
