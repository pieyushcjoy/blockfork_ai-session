#!/usr/bin/env bash
set -euo pipefail

LABEL="com.blockfork.runtime"
PLIST_TEMPLATE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/ops/com.blockfork.runtime.plist.template"
PLIST_DEST="$HOME/Library/LaunchAgents/${LABEL}.plist"

usage() {
  cat <<USAGE
Usage: scripts/runtime-ctl.sh <install|uninstall|start|stop|restart|status|logs>
USAGE
}

ensure_template() {
  if [[ ! -f "$PLIST_TEMPLATE" ]]; then
    echo "Missing plist template: $PLIST_TEMPLATE" >&2
    exit 1
  fi
}

is_loaded() {
  launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1
}

install_agent() {
  ensure_template
  mkdir -p "$HOME/Library/LaunchAgents"
  cp "$PLIST_TEMPLATE" "$PLIST_DEST"
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST_DEST" >/dev/null 2>&1 || true
  launchctl enable "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
  echo "Installed LaunchAgent at $PLIST_DEST"
}

uninstall_agent() {
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
  rm -f "$PLIST_DEST"
  echo "Uninstalled LaunchAgent ($LABEL)"
}

start_agent() {
  if [[ ! -f "$PLIST_DEST" ]]; then
    install_agent
  fi

  if ! is_loaded; then
    launchctl bootstrap "gui/$(id -u)" "$PLIST_DEST" >/dev/null 2>&1 || true
    sleep 1
  fi

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
