#!/usr/bin/env bash
# 演控机 secondary IP 一键配置（macOS）——报告 §六.5。
# 6 个逻辑 DS 各绑 10.TE.AM.5（DS 惯例地址）；队号 9001~9006 → 10.90.X.5。
# 注意：alias 重启 / 网卡 bounce（WiFi 重连、DHCP 续租）后失效，属预期；
# GHPaths 启动自检兜底（见 docs/architecture.md）。
#
# 用法：sudo ./scripts/setup-aliases.sh add|remove|status [网卡名，默认 en0]

set -euo pipefail

ACTION="${1:-status}"
IFACE="${2:-en0}"
BASE="10"
TEAMS=(9001 9002 9003 9004 9005 9006)

team_ip() {
  local team="$1"
  printf '%s.%d.%d.5' "$BASE" "$(( (team / 100) % 100 ))" "$(( team % 100 ))"
}

case "$ACTION" in
  add)
    if [ "$(id -u)" -ne 0 ]; then
      echo "需要 sudo（ifconfig alias 是特权操作）" >&2
      exit 1
    fi
    for team in "${TEAMS[@]}"; do
      ip="$(team_ip "$team")"
      ifconfig "$IFACE" alias "$ip" 255.255.255.0
      echo "added   $ip on $IFACE (team $team)"
    done
    ;;
  remove)
    if [ "$(id -u)" -ne 0 ]; then
      echo "需要 sudo" >&2
      exit 1
    fi
    for team in "${TEAMS[@]}"; do
      ip="$(team_ip "$team")"
      if ifconfig "$IFACE" -alias "$ip" 2>/dev/null; then
        echo "removed $ip"
      else
        echo "absent  $ip"
      fi
    done
    ;;
  status)
    for team in "${TEAMS[@]}"; do
      ip="$(team_ip "$team")"
      if ifconfig "$IFACE" 2>/dev/null | grep -q "inet ${ip} "; then
        echo "OK      $ip (team $team)"
      else
        echo "MISSING $ip (team $team)"
      fi
    done
    ;;
  *)
    echo "usage: $0 add|remove|status [iface]" >&2
    exit 2
    ;;
esac
