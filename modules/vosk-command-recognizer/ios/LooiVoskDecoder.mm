#import "LooiVoskDecoder.h"
#include <vector>
#include <algorithm>
#include <cmath>
#include <cstdint>

// Stable Vosk C ABI, as declared in react-native-vosk/ios/Vosk-API.h.
// Vosk is Copyright Alpha Cephei Inc., Apache-2.0. The pinned dependency supplies
// the source archive for the isolated dynamic framework. Only this C ABI is
// exported, keeping its OpenFST registry separate from Sherpa's. No network
// download takes place during compilation.
extern "C" {
  struct VoskModel;
  struct VoskRecognizer;
  VoskModel *vosk_model_new(const char *);
  void vosk_model_free(VoskModel *);
  VoskRecognizer *vosk_recognizer_new(VoskModel *, float);
  VoskRecognizer *vosk_recognizer_new_grm(VoskModel *, float, const char *);
  void vosk_recognizer_set_words(VoskRecognizer *, int);
  void vosk_recognizer_set_partial_words(VoskRecognizer *, int);
  int vosk_recognizer_accept_waveform_f(VoskRecognizer *, const float *, int);
  const char *vosk_recognizer_result(VoskRecognizer *);
  const char *vosk_recognizer_partial_result(VoskRecognizer *);
  void vosk_recognizer_reset(VoskRecognizer *);
  void vosk_recognizer_free(VoskRecognizer *);
}

@interface LooiVoskModel ()
@property(nonatomic, assign) VoskModel *handle;
@end

namespace {
constexpr double kAssistantInputRate = 24000.0;
constexpr double kAssistantOutputRate = 16000.0;
constexpr double kResampleStep = 1.5;
constexpr double kLowPassCutoff = 0.31; // cycles per 24 kHz input sample
constexpr int64_t kFilterRadius = 24;
constexpr int kRecognizerChunkFrames = 1600; // at most 100 ms per Vosk call

double sinc(double value) {
  if (std::abs(value) < 1e-9) return 1.0;
  const double angle = M_PI * value;
  return std::sin(angle) / angle;
}
}

@implementation LooiVoskAssistantOutputDecoder {
  LooiVoskModel *_model;
  VoskRecognizer *_recognizer;
  std::vector<float> _pendingInput;
  int64_t _pendingStartFrame;
  int64_t _sourceFrames;
  int64_t _nextOutputFrame;
  NSString *_lastPartialSignature;
}

- (instancetype)initWithModel:(LooiVoskModel *)model {
  if ((self = [super init])) {
    _model = model;
    _recognizer = vosk_recognizer_new(model.handle, (float)kAssistantOutputRate);
    if (!_recognizer) return nil;
    vosk_recognizer_set_words(_recognizer, 1);
    vosk_recognizer_set_partial_words(_recognizer, 1);
  }
  return self;
}

- (NSArray<NSDictionary<NSString *, id> *> *)acceptPcm24:(NSData *)data {
  if (data.length == 0) return @[];
  if ((data.length & 1U) != 0) return @[@{ @"error": @"Assistant PCM16 payload has an odd byte count" }];

  const auto *bytes = static_cast<const uint8_t *>(data.bytes);
  const NSUInteger frameCount = data.length / 2;
  _pendingInput.reserve(_pendingInput.size() + frameCount);
  for (NSUInteger frame = 0; frame < frameCount; frame++) {
    const uint16_t bits = (uint16_t)bytes[frame * 2] | ((uint16_t)bytes[frame * 2 + 1] << 8);
    const int16_t sample = static_cast<int16_t>(bits);
    _pendingInput.push_back(static_cast<float>(sample) / 32768.0f);
  }
  _sourceFrames += static_cast<int64_t>(frameCount);

  std::vector<float> output;
  while (((double)_nextOutputFrame * kResampleStep) + kFilterRadius < (double)_sourceFrames) {
    output.push_back([self resampledSampleAtOutputFrame:_nextOutputFrame]);
    _nextOutputFrame++;
  }
  [self trimInputHistory];

  NSMutableArray<NSDictionary<NSString *, id> *> *events = [NSMutableArray array];
  [self acceptOutputSamples:output events:events];
  return events;
}

- (NSArray<NSDictionary<NSString *, id> *> *)finish {
  const int64_t targetOutputFrames = (_sourceFrames * 2 + 2) / 3;
  std::vector<float> tail;
  while (_nextOutputFrame < targetOutputFrames) {
    tail.push_back([self resampledSampleAtOutputFrame:_nextOutputFrame]);
    _nextOutputFrame++;
  }
  [self trimInputHistory];

  NSMutableArray<NSDictionary<NSString *, id> *> *events = [NSMutableArray array];
  [self acceptOutputSamples:tail events:events];

  // End-of-response padding exists only for Vosk endpoint detection. It is not
  // added to _sourceFrames and therefore never advances response-relative time.
  std::vector<float> silence(12800, 0.0f);
  [self acceptOutputSamples:silence events:events];
  return events;
}

- (float)resampledSampleAtOutputFrame:(int64_t)outputFrame {
  const double position = (double)outputFrame * kResampleStep;
  const int64_t first = static_cast<int64_t>(std::ceil(position - kFilterRadius));
  const int64_t last = static_cast<int64_t>(std::floor(position + kFilterRadius));
  double weighted = 0.0;
  double weightSum = 0.0;
  for (int64_t inputFrame = first; inputFrame <= last; inputFrame++) {
    const double distance = (double)inputFrame - position;
    const double windowPosition = std::abs(distance) / (double)kFilterRadius;
    if (windowPosition > 1.0) continue;
    const double window = 0.5 + 0.5 * std::cos(M_PI * windowPosition);
    const double weight = (2.0 * kLowPassCutoff) * sinc(2.0 * kLowPassCutoff * distance) * window;
    weightSum += weight;
    if (inputFrame >= 0 && inputFrame < _sourceFrames) {
      const int64_t localFrame = inputFrame - _pendingStartFrame;
      if (localFrame >= 0 && localFrame < static_cast<int64_t>(_pendingInput.size())) {
        weighted += (double)_pendingInput[static_cast<size_t>(localFrame)] * weight;
      }
    }
  }
  if (std::abs(weightSum) < 1e-9) return 0.0f;
  // Vosk's `_f` entry point expects float containers holding PCM16 amplitude,
  // not normalized audio floats. Match the existing microphone decoder.
  const double pcm16 = std::max(-32768.0, std::min(32767.0, (weighted / weightSum) * 32767.0));
  return static_cast<float>(pcm16);
}

- (void)trimInputHistory {
  const int64_t keepFrom = std::max<int64_t>(0,
    static_cast<int64_t>(std::floor((double)_nextOutputFrame * kResampleStep)) - kFilterRadius);
  const int64_t removeCount = std::min<int64_t>(
    static_cast<int64_t>(_pendingInput.size()), keepFrom - _pendingStartFrame);
  if (removeCount <= 0) return;
  _pendingInput.erase(_pendingInput.begin(), _pendingInput.begin() + removeCount);
  _pendingStartFrame += removeCount;
}

- (void)acceptOutputSamples:(const std::vector<float> &)samples
                      events:(NSMutableArray<NSDictionary<NSString *, id> *> *)events {
  size_t offset = 0;
  while (offset < samples.size()) {
    const size_t count = std::min<size_t>(kRecognizerChunkFrames, samples.size() - offset);
    const int result = vosk_recognizer_accept_waveform_f(_recognizer, samples.data() + offset, (int)count);
    if (result < 0) {
      [events addObject:@{ @"error": @"Vosk rejected assistant output PCM" }];
      return;
    }
    offset += count;
    const BOOL endpoint = result != 0;
    const char *json = endpoint ? vosk_recognizer_result(_recognizer) : vosk_recognizer_partial_result(_recognizer);
    NSData *jsonData = json ? [[NSString stringWithUTF8String:json] dataUsingEncoding:NSUTF8StringEncoding] : nil;
    NSDictionary *resultObject = jsonData
      ? [NSJSONSerialization JSONObjectWithData:jsonData options:0 error:nil]
      : nil;
    NSString *wordsKey = endpoint ? @"result" : @"partial_result";
    NSArray *rawWords = [resultObject[wordsKey] isKindOfClass:NSArray.class] ? resultObject[wordsKey] : @[];
    NSMutableArray<NSDictionary<NSString *, id> *> *words = [NSMutableArray arrayWithCapacity:rawWords.count];
    for (id rawWord in rawWords) {
      if (![rawWord isKindOfClass:NSDictionary.class]) continue;
      NSDictionary *wordObject = rawWord;
      NSString *word = [wordObject[@"word"] isKindOfClass:NSString.class] ? wordObject[@"word"] : @"";
      NSNumber *start = [wordObject[@"start"] isKindOfClass:NSNumber.class] ? wordObject[@"start"] : nil;
      NSNumber *end = [wordObject[@"end"] isKindOfClass:NSNumber.class] ? wordObject[@"end"] : nil;
      NSNumber *confidence = [wordObject[@"conf"] isKindOfClass:NSNumber.class] ? wordObject[@"conf"] : nil;
      if (word.length == 0 || !start || !end || !confidence) continue;
      const double startSeconds = start.doubleValue;
      const double endSeconds = end.doubleValue;
      const double conf = confidence.doubleValue;
      if (!std::isfinite(startSeconds) || !std::isfinite(endSeconds) || !std::isfinite(conf) ||
          startSeconds < 0.0 || endSeconds <= startSeconds || conf < 0.0 || conf > 1.0) continue;
      [words addObject:@{
        @"word": word,
        // Vosk already offsets these times across endpoint resets through its
        // frame_offset_ / samples_round_start_ counters.
        @"startMs": @(startSeconds * 1000.0),
        @"endMs": @(endSeconds * 1000.0),
        @"confidence": @(conf)
      }];
    }
    NSMutableDictionary<NSString *, id> *event = [@{
      @"words": words,
      @"endpoint": @(endpoint),
      @"audioDurationMs": @(((double)_sourceFrames / kAssistantInputRate) * 1000.0)
    } mutableCopy];
    if (endpoint) {
      [events addObject:event];
      _lastPartialSignature = @"";
    } else if (words.count > 0) {
      NSMutableString *signature = [NSMutableString string];
      for (NSDictionary<NSString *, id> *word in words) {
        const long long startBucket = llround([word[@"startMs"] doubleValue] / 100.0);
        const long long endBucket = llround([word[@"endMs"] doubleValue] / 100.0);
        const long long confidenceBucket = llround([word[@"confidence"] doubleValue] * 20.0);
        [signature appendFormat:@"%@|%lld|%lld|%lld;", word[@"word"], startBucket, endBucket, confidenceBucket];
      }
      if (![_lastPartialSignature isEqualToString:signature]) {
        [events addObject:event];
        _lastPartialSignature = signature;
      }
    }
  }
}

- (void)dealloc {
  if (_recognizer) vosk_recognizer_free(_recognizer);
}
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
