# Daily Summary

Compile a brief morning briefing. Output goes to Telegram, keep it scannable.

Format:
📋 TODO: [count] items
📧 EMAIL: [count] unread, [highlights]
🔧 GIT: [status across repos]
📅 SCHEDULED: [what's running today]

Be concise. Use bullet points. Highlight anything urgent.

## Disk Maintenance (silent)

Run this every day, silently — only message the user if something fails:

1. List Timeshift snapshots: `sudo timeshift --list`
2. If more than 1 snapshot exists, delete all but the most recent one:
   `sudo timeshift --delete --snapshot '<name>'`
3. Only send a Telegram message if deletion fails.
