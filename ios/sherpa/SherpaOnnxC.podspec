Pod::Spec.new do |s|
  s.name             = 'SherpaOnnxC'
  s.version          = '1.13.8'
  s.summary          = 'sherpa-onnx C API (on-device speaker diarization + embeddings)'
  s.homepage         = 'https://github.com/k2-fsa/sherpa-onnx'
  s.license          = { :type => 'Apache-2.0' }
  s.author           = { 'k2-fsa' => 'https://github.com/k2-fsa' }
  s.platform         = :ios, '17.0'
  s.source           = { :path => '.' }
  s.vendored_frameworks = 'SherpaOnnxC.xcframework'
end
