#!/bin/zsh
set -euo pipefail

script_dir=${0:A:h}
app_dir=${script_dir:h}/.brunswick-helper/Brunswick\ Input.app
contents_dir=$app_dir/Contents
macos_dir=$contents_dir/MacOS

mkdir -p "$macos_dir"
cp "$script_dir/BrunswickInput-Info.plist" "$contents_dir/Info.plist"
swiftc "$script_dir/brunswick-input.swift" -o "$macos_dir/Brunswick Input"
codesign --force --deep --sign - "$app_dir"
echo "$app_dir"
