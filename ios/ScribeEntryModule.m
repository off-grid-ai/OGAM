#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(ScribeEntryModule, NSObject)

RCT_EXTERN_METHOD(takePending:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(finish:(NSString *)requestId text:(NSString *)text resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)

@end
