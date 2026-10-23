#import <Foundation/Foundation.h>
#import <OffgridVideoRuntime/stable-diffusion.h>
#include <atomic>
BOOL OGEncodeVideo(sd_image_t *frames, int count, int fps, NSString *path,
                   const std::atomic_bool &cancelled, NSError **error);
