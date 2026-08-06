#!/bin/zsh
set -euo pipefail

script_dir=${0:A:h}
app_dir=${script_dir:h}/.brunswick-helper/Brunswick\ Input.app
contents_dir=$app_dir/Contents
macos_dir=$contents_dir/MacOS

mkdir -p "$macos_dir"
cp "$script_dir/BrunswickInput-Info.plist" "$contents_dir/Info.plist"
stable_sdk=/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk
if [[ -d ${BRUNSWICK_SWIFT_SDK:-$stable_sdk} ]]; then
  swiftc -sdk "${BRUNSWICK_SWIFT_SDK:-$stable_sdk}" "$script_dir/brunswick-input.swift" -o "$macos_dir/Brunswick Input"
else
  swiftc "$script_dir/brunswick-input.swift" -o "$macos_dir/Brunswick Input"
fi
codesign --force --deep --sign - "$app_dir"
echo "$app_dir"
