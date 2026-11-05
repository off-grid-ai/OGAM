#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(PDFExtractorModule, NSObject)

RCT_EXTERN_METHOD(extractText:(NSString *)filePath
                  maxChars:(double)maxChars
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(pageCount:(NSString *)filePath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(extractPages:(NSString *)filePath
                  start:(double)start
                  count:(double)count
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(renderPage:(NSString *)filePath
                  pageIndex:(double)pageIndex
                  maxWidth:(double)maxWidth
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
