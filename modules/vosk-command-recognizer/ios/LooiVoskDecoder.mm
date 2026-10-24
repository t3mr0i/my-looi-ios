#import "LooiVoskDecoder.h"
#include <vector>
#include <algorithm>

// Stable Vosk C ABI, as declared in react-native-vosk/ios/Vosk-API.h.
// Vosk is Copyright Alpha Cephei Inc., Apache-2.0. The pinned dependency supplies
// the actual XCFramework; no network download takes place during compilation.
extern "C" {
  struct VoskModel;
  struct VoskRecognizer;
  VoskModel *vosk_model_new(const char *);
  void vosk_model_free(VoskModel *);
  VoskRecognizer *vosk_recognizer_new_grm(VoskModel *, float, const char *);
  int vosk_recognizer_accept_waveform_f(VoskRecognizer *, const float *, int);
  const char *vosk_recognizer_result(VoskRecognizer *);
  const char *vosk_recognizer_partial_result(VoskRecognizer *);
  void vosk_recognizer_reset(VoskRecognizer *);
  void vosk_recognizer_free(VoskRecognizer *);
}

@interface LooiVoskModel ()
@property(nonatomic, assign) VoskModel *handle;
@end
@implementation LooiVoskModel
- (instancetype)initWithPath:(NSString *)path {
  if ((self = [super init])) {
    _handle = vosk_model_new(path.fileSystemRepresentation);
    if (!_handle) return nil;
  }
  return self;
}
- (void)dealloc { if (_handle) vosk_model_free(_handle); }
@end

@implementation LooiVoskDecoder {
  LooiVoskModel *_model;
  VoskRecognizer *_recognizer;
}
- (instancetype)initWithModel:(LooiVoskModel *)model grammar:(NSString *)grammar {
  if ((self = [super init])) {
    _model = model;
    _recognizer = vosk_recognizer_new_grm(model.handle, 16000, grammar.UTF8String);
    if (!_recognizer) return nil;
  }
  return self;
}
- (NSDictionary *)acceptSamples:(NSArray<NSNumber *> *)samples {
  std::vector<float> pcm(samples.count);
  for (NSUInteger i = 0; i < samples.count; i++) {
    pcm[i] = std::max(-1.0f, std::min(1.0f, samples[i].floatValue)) * 32767.0f;
  }
  const int result = vosk_recognizer_accept_waveform_f(_recognizer, pcm.data(), (int)pcm.size());
  if (result < 0) return @{ @"error": @"Vosk rejected the PCM input" };
  const char *json = result ? vosk_recognizer_result(_recognizer) : vosk_recognizer_partial_result(_recognizer);
  NSData *data = json ? [[NSString stringWithUTF8String:json] dataUsingEncoding:NSUTF8StringEncoding] : nil;
  NSDictionary *value = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
  return @{ @"endpoint": @(result != 0), @"text": value[result ? @"text" : @"partial"] ?: @"" };
}
- (void)reset { vosk_recognizer_reset(_recognizer); }
- (void)dealloc { if (_recognizer) vosk_recognizer_free(_recognizer); }
@end
