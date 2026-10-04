#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(DownloadManagerModule, RCTEventEmitter)

RCT_EXTERN_METHOD(startDownload:(NSDictionary *)params
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(startMultiFileDownload:(NSDictionary *)params
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(stopDownload:(NSString *)downloadId
                  retainPartial:(BOOL)retainPartial
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getActiveDownloads:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getDownloadProgress:(NSString *)downloadId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(moveCompletedDownload:(NSString *)downloadId
                  targetPath:(NSString *)targetPath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(startProgressPolling)
RCT_EXTERN_METHOD(stopProgressPolling)

RCT_EXTERN_METHOD(addListener:(NSString *)eventName)
RCT_EXTERN_METHOD(removeListeners:(int)count)

@end
