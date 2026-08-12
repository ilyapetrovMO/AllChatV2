#!/usr/bin/env bash
set -euo pipefail

action="${1:-}"
device="${2:-}"
profile="${3:-}"
seed="${ALLCHAT_NETEM_SEED:-41023}"

if [[ -z "$device" || ! "$device" =~ ^[a-zA-Z0-9_.:-]+$ ]]; then
  echo "usage: $0 apply|clear <network-device> [wifi|mobile|lossy]" >&2
  exit 2
fi

if [[ "$action" == "clear" ]]; then
  tc qdisc del dev "$device" root 2>/dev/null || true
  exit 0
fi
if [[ "$action" != "apply" ]]; then
  echo "usage: $0 apply|clear <network-device> [wifi|mobile|lossy]" >&2
  exit 2
fi

case "$profile" in
  wifi)   args=(delay 30ms 10ms distribution normal loss random 0.5% seed "$seed" rate 20mbit) ;;
  mobile) args=(delay 90ms 35ms distribution normal loss random 2% seed "$seed" rate 4mbit) ;;
  lossy)  args=(delay 180ms 80ms distribution normal loss random 8% seed "$seed" rate 1200kbit) ;;
  *) echo "unknown profile: $profile (expected wifi, mobile, or lossy)" >&2; exit 2 ;;
esac

tc qdisc replace dev "$device" root netem "${args[@]}"
echo "applied deterministic $profile profile to $device (seed $seed)"
