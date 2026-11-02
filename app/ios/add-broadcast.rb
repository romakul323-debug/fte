# Добавляет в Xcode-проект расширение «VolnaScreen» (показ экрана iPhone через системную запись экрана).
# Запускается в GitHub Actions перед сборкой; повторный запуск ничего не меняет.
require 'xcodeproj'

path = File.join(__dir__, 'App', 'App.xcodeproj')
project = Xcodeproj::Project.open(path)
if project.targets.any? { |t| t.name == 'VolnaScreen' }
  puts 'VolnaScreen уже есть'
  exit 0
end
app = project.targets.find { |t| t.name == 'App' }
marketing = app.build_configurations.map { |c| c.build_settings['MARKETING_VERSION'] }.compact.first || '1.0'

ext = project.new_target(:app_extension, 'VolnaScreen', :ios, '15.0', nil, :swift)
group = project.main_group.new_group('VolnaScreen', 'VolnaScreen')
src = group.new_reference('SampleHandler.swift')
group.new_reference('Info.plist')
ext.add_file_references([src])
ext.add_system_framework('ReplayKit')

ext.build_configurations.each do |c|
  s = c.build_settings
  s['PRODUCT_NAME'] = 'VolnaScreen'
  s['PRODUCT_BUNDLE_IDENTIFIER'] = 'ru.volna.messenger.VolnaScreen'
  s['INFOPLIST_FILE'] = 'VolnaScreen/Info.plist'
  s['GENERATE_INFOPLIST_FILE'] = 'NO'
  s['SWIFT_VERSION'] = '5.0'
  s['IPHONEOS_DEPLOYMENT_TARGET'] = '15.0'
  s['TARGETED_DEVICE_FAMILY'] = '1,2'
  s['SKIP_INSTALL'] = 'YES'
  s['MARKETING_VERSION'] = marketing
  s['CURRENT_PROJECT_VERSION'] ||= '1'
  s['APPLICATION_EXTENSION_API_ONLY'] = 'YES'
  s['CODE_SIGN_STYLE'] = 'Automatic'
  s['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks']
end

app.add_dependency(ext)
embed = app.new_copy_files_build_phase('Embed Foundation Extensions')
embed.symbol_dst_subfolder_spec = :plug_ins
bf = embed.add_file_reference(ext.product_reference, true)
bf.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }

project.save
puts 'VolnaScreen добавлено'
