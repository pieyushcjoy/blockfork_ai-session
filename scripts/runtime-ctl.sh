#!/usr/bin/env bash
set -euo pipefail

LABEL="com.blockfork.runtime"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST_DEST="$HOME/Library/LaunchAgents/${LABEL}.plist"
ENV_FILE_INPUT="${ENV_FILE:-}"

usage() {
  cat <<USAGE
Usage: scripts/runtime-ctl.sh <install|uninstall|start|stop|restart|status|logs>

Optional:
  ENV_FILE=.env.validation scripts/runtime-ctl.sh restart
USAGE
}

resolve_env_file() {
  if [[ -z "$ENV_FILE_INPUT" ]]; then
    return 0
  fi

  if [[ "$ENV_FILE_INPUT" == /* ]]; then
    printf '%s' "$ENV_FILE_INPUT"
    return 0
  fi

  printf '%s' "$ROOT_DIR/$ENV_FILE_INPUT"
}

write_plist() {
  local resolved_env_file="${1:-}"
  local env_block=""

  if [[ -n "$resolved_env_file" ]]; then
    env_block=$(cat <<EOF
    <key>ENV_FILE</key>
    <string>${resolved_env_file}</string>
EOF
)
  fi

  cat > "$PLIST_DEST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>

  <key>WorkingDirectory</key>
  <string>${ROOT_DIR}</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>cd ${ROOT_DIR} &amp;&amp; npm start</string>
  </array>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
${env_block}
  </dict>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>${ROOT_DIR}/logs/launchd.out.log</string>

  <key>StandardErrorPath</key>
  <string>${ROOT_DIR}/logs/launchd.err.log</string>
</dict>
</plist>
EOF
}

is_loaded() {
  launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1
}

install_agent() {
  local resolved_env_file
  resolved_env_file="$(resolve_env_file)"
  mkdir -p "$HOME/Library/LaunchAgents"
  write_plist "$resolved_env_file"
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST_DEST" >/dev/null 2>&1 || true
  launchctl enable "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
  if [[ -n "$resolved_env_file" ]]; then
    echo "Installed LaunchAgent at $PLIST_DEST using ENV_FILE=$resolved_env_file"
  else
    echo "Installed LaunchAgent at $PLIST_DEST"
  fi
}

uninstall_agent() {
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
  rm -f "$PLIST_DEST"
  echo "Uninstalled LaunchAgent ($LABEL)"
}

start_agent() {
  install_agent
  sleep 1

  if ! is_loaded; then
    echo "Failed to load LaunchAgent $LABEL" >&2
    exit 1
  fi

  launchctl enable "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
  launchctl kickstart -k "gui/$(id -u)/$LABEL"
  echo "Started $LABEL"
}

stop_agent() {
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
  echo "Stopped $LABEL"
}

restart_agent() {
  stop_agent
  sleep 1
  start_agent
}

status_agent() {
  if launchctl print "gui/$(id -u)/$LABEL" >/tmp/${LABEL}.status.$$ 2>&1; then
    cat /tmp/${LABEL}.status.$$
    rm -f /tmp/${LABEL}.status.$$
    return 0
  fi

  cat /tmp/${LABEL}.status.$$ >&2 || true
  rm -f /tmp/${LABEL}.status.$$
  return 1
}

logs_agent() {
  local repo_root
  repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  echo "== launchd stdout =="
  tail -n 80 "$repo_root/logs/launchd.out.log" 2>/dev/null || echo "No stdout log yet"
  echo
  echo "== launchd stderr =="
  tail -n 80 "$repo_root/logs/launchd.err.log" 2>/dev/null || echo "No stderr log yet"
}

cmd="${1:-}"
case "$cmd" in
  install) install_agent ;;
  uninstall) uninstall_agent ;;
  start) start_agent ;;
  stop) stop_agent ;;
  restart) restart_agent ;;
  status) status_agent ;;
  logs) logs_agent ;;
  *) usage; exit 1 ;;
esac
