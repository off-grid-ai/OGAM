// Report a problem: opens Mail with the support address in To, the subject, the header as the
// body and the full log attached. Resolves NO when this device cannot send mail, so JS falls back
// to the share sheet.
#import <React/RCTBridgeModule.h>
#import <React/RCTUtils.h>
#import <MessageUI/MessageUI.h>

@interface ProblemReportModule : NSObject <RCTBridgeModule, MFMailComposeViewControllerDelegate>
@end

@implementation ProblemReportModule

RCT_EXPORT_MODULE(ProblemReportModule)

+ (BOOL)requiresMainQueueSetup { return NO; }

- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }

RCT_EXPORT_METHOD(composeEmail:(NSString *)to
                  subject:(NSString *)subject
                  body:(NSString *)body
                  attachmentPath:(NSString *)attachmentPath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  if (![MFMailComposeViewController canSendMail]) {
    resolve(@NO);
    return;
  }
  UIViewController *presenter = RCTPresentedViewController();
  if (presenter == nil) {
    resolve(@NO);
    return;
  }
  MFMailComposeViewController *mail = [MFMailComposeViewController new];
  mail.mailComposeDelegate = self;
  [mail setToRecipients:@[ to ]];
  [mail setSubject:subject];
  [mail setMessageBody:body isHTML:NO];
  if (attachmentPath.length > 0) {
    NSData *log = [NSData dataWithContentsOfFile:attachmentPath];
    if (log != nil) {
      [mail addAttachmentData:log mimeType:@"text/plain" fileName:attachmentPath.lastPathComponent];
    }
  }
  [presenter presentViewController:mail animated:YES completion:nil];
  resolve(@YES);
}

- (void)mailComposeController:(MFMailComposeViewController *)controller
          didFinishWithResult:(MFMailComposeResult)result
                        error:(NSError *)error
{
  [controller dismissViewControllerAnimated:YES completion:nil];
}

@end
