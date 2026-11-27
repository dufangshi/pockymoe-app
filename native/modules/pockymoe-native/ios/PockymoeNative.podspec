Pod::Spec.new do |s|
  s.name           = 'PockymoeNative'
  s.version        = '0.1.0'
  s.summary        = 'Pockymoe native helpers'
  s.author         = 'Pockymoe'
  s.homepage       = 'https://github.com/dufangshi/pockymoe-app'
  s.license        = 'UNLICENSED'
  s.platforms      = { :ios => '17.0' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,swift}'
end
