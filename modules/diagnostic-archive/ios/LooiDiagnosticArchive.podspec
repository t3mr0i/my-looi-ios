Pod::Spec.new do |s|
  s.name = 'LooiDiagnosticArchive'
  s.version = '1.0.0'
  s.summary = 'My LOOI Apple platform implementation'
  s.homepage = 'https://github.com/t3mr0i/my-looi-ios'
  s.license = { :type => 'MIT' }
  s.author = 'My LOOI contributors'
  s.source = { :git => 'https://github.com/t3mr0i/my-looi-ios.git' }
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.source_files = '**/*.{h,m,mm,swift}'
  s.dependency 'ExpoModulesCore'
  s.dependency 'ZIPFoundation', '0.9.20'
end
