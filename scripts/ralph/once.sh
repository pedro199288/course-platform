#!/bin/bash

issues=$(gh issue list --state open --json number,title,body,comments)
commits=$(git log -n 5 --format="%H%n%ad%n%B---" --date=short 2>/dev/null || echo "No commits found")
prompt=$(cat scripts/ralph/prompt.md)
telegram=$(cat scripts/ralph/telegram.md)
REMAINING=$(echo "$issues" | jq 'length')

claude --permission-mode acceptEdits \
  "You are Ralph, an autonomous coding agent. Single iteration ($REMAINING issues remaining).

## Telegram environment variables
\`\`\`
export TG_BOT_CLAUDIA_TOKEN=\"${TG_BOT_CLAUDIA_TOKEN}\"
export TG_BOT_CLAUDIA_CHAT_ID=\"${TG_BOT_CLAUDIA_CHAT_ID}\"
\`\`\`

$telegram

## Context
Previous commits: $commits

Open issues: $issues

$prompt"
