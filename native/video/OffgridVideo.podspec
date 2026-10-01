Pod::Spec.new do |s|
  s.name = 'OffgridVideo'
  s.version = '0.1.0'
  s.summary = 'Local Wan video generation and MP4 encoding for Off Grid AI'
  s.homepage = 'https://github.com/off-grid-ai/OGAM'
  s.license = { :type => 'AGPL-3.0', :file => '../../LICENSE' }
  s.author = 'Off Grid AI'
  s.source = { :git => 'https://github.com/off-grid-ai/OGAM.git' }
  s.platform = :ios, '17.0'
  s.source_files = '*.{h,mm}', 'common/*.hpp'
  s.vendored_frameworks = 'OffgridVideoRuntime.xcframework'
  s.frameworks = 'BackgroundTasks', 'AVFoundation', 'CoreVideo', 'Metal', 'Accelerate', 'UIKit'
  s.dependency 'React-Core'
  s.pod_target_xcconfig = { 'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17' }
end
