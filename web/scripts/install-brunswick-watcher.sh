#!/bin/zsh
set -euo pipefail

script_dir=${0:A:h}
web_dir=${script_dir:h}
node_bin=${BRUNSWICK_NODE_BIN:-$(command -v node || true)}
label=com.onpar.brunswick-watcher
launch_agents_dir=$HOME/Library/LaunchAgents
plist_path=$launch_agents_dir/$label.plist
log_path=$HOME/Library/Logs/OnParBrunswickWatcher.log
runner_path=$web_dir/.brunswick-helper/run-brunswick-watcher.command

if [[ -z $node_bin ]]; then
  echo "Node.js was not found. Set BRUNSWICK_NODE_BIN to its absolute path." >&2
  exit 1
fi

"$script_dir/build-brunswick-input.sh"
mkdir -p "$launch_agents_dir" "$HOME/Library/Logs"

cat > "$runner_path" <<RUNNER
#!/bin/zsh
while true; do
  cd "$web_dir"
  "$node_bin" "$web_dir/scripts/watch-brunswick-lanes.mjs" --interval 10 >> "$log_path" 2>&1
  echo "\$(date '+%H:%M:%S') watcher exited; restarting in 10 seconds" >> "$log_path"
  sleep 10
done
RUNNER
chmod +x "$runner_path"

cat > "$plist_path" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key><array>
    <string>/usr/bin/open</string>
    <string>-a</string><string>Terminal</string>
    <string>$runner_path</string>
  </array>
  <key>RunAtLoad</key><true/>
</dict></plist>
PLIST

plutil -lint "$plist_path"
launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$plist_path"
launchctl kickstart -k "gui/$(id -u)/$label"

echo "Installed $label"
echo "Log: $log_path"
echo "The watcher runs in Terminal so macOS Screen Recording permission applies."
echo "Verify: pgrep -fl watch-brunswick-lanes.mjs"
