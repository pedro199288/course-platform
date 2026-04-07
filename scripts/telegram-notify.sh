#!/usr/bin/env bash
# Send a Telegram message via Bot API
# Requires TG_BOT_CLAUDIA_TOKEN and TG_BOT_CLAUDIA_CHAT_ID in environment.
set -euo pipefail

if [ -z "${TG_BOT_CLAUDIA_TOKEN:-}" ] || [ -z "${TG_BOT_CLAUDIA_CHAT_ID:-}" ]; then
  echo "Error: TG_BOT_CLAUDIA_TOKEN and TG_BOT_CLAUDIA_CHAT_ID must be set."
  exit 1
fi

MESSAGE="${1:-No message provided}"

curl -s -X POST "https://api.telegram.org/bot${TG_BOT_CLAUDIA_TOKEN}/sendMessage" \
  -d chat_id="$TG_BOT_CLAUDIA_CHAT_ID" \
  -d text="$MESSAGE" \
  -d parse_mode="Markdown" \
  > /dev/null
