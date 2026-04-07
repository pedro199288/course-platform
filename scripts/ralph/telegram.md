## Telegram notifications

To send a Telegram notification, first set the environment variables (provided below), then run:

```
bash scripts/telegram-notify.sh "Your message here"
```

Send a Telegram message when you START an issue and when you FINISH it.
Every message MUST begin with this prefix followed by a line break:
📚 Course Platform

Example messages:
'📚 Course Platform
🤖 Starting #3: Add user profile page'
'📚 Course Platform
✅ #3: Add user profile page — 4 issues remaining'
