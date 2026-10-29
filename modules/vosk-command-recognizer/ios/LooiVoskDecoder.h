#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN
@interface LooiVoskModel : NSObject
- (nullable instancetype)initWithPath:(NSString *)path NS_SWIFT_NAME(init(path:));
@end

@interface LooiVoskDecoder : NSObject
- (nullable instancetype)initWithModel:(LooiVoskModel *)model grammar:(NSString *)grammar NS_SWIFT_NAME(init(model:grammar:));
- (NSDictionary *)acceptSamples:(NSArray<NSNumber *> *)samples NS_SWIFT_NAME(accept(samples:));
- (void)reset;
@end

/// A separate unconstrained recognizer for assistant output. The caller feeds
/// 24 kHz mono PCM16; this decoder resamples it to 16 kHz and returns Vosk
/// partial and final endpoint words with response-relative word times.
@interface LooiVoskAssistantOutputDecoder : NSObject
- (nullable instancetype)initWithModel:(LooiVoskModel *)model NS_SWIFT_NAME(init(model:));
- (NSArray<NSDictionary<NSString *, id> *> *)acceptPcm24:(NSData *)data NS_SWIFT_NAME(accept(pcm24:));
- (NSArray<NSDictionary<NSString *, id> *> *)finish;
@end
NS_ASSUME_NONNULL_END
