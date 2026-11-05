# The brand faces (Geist, Geist Mono; SIL OFL 1.1) copied into the app bundle, as the icon fonts are.
# Listed in Info.plist UIAppFonts so fontFamily "Geist" + fontWeight resolves on iOS.
Pod::Spec.new do |s|
  s.name     = 'OffgridFonts'
  s.version  = '1.0.0'
  s.summary  = 'Geist and Geist Mono for Off Grid AI'
  s.homepage = 'https://github.com/vercel/geist-font'
  s.license  = { :type => 'OFL-1.1', :file => 'geist/OFL.txt' }
  s.author   = 'Vercel'
  s.platform = :ios, '15.1'
  s.source   = { :path => '.' }
  s.resources = 'geist/*.ttf'
end
