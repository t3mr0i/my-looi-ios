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
NS_ASSUME_NONNULL_END
