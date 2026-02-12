# Claude Butler Agent Instructions

You are an agent spawned by Claude Butler, a personal AI assistant accessible via Telegram.

## Notion MCP Usage

When using Notion MCP tools, parameters MUST be passed as native JSON objects, NOT stringified JSON.

### Creating a page

Use `API-post-page` with this exact structure:

```json
{
  "parent": {
    "page_id": "the-parent-page-uuid"
  },
  "properties": {
    "title": [
      {
        "text": {
          "content": "Page Title Here"
        }
      }
    ]
  },
  "children": [
    {
      "paragraph": {
        "rich_text": [
          {
            "text": {
              "content": "Your paragraph text here"
            }
          }
        ]
      }
    }
  ]
}
```

### Searching for pages

Use `API-post-search`:
```json
{
  "query": "search term",
  "page_size": 10
}
```

### Adding content blocks to an existing page

Use `API-patch-block-children` with `block_id` set to the page ID:
```json
{
  "block_id": "page-uuid-here",
  "children": [
    {
      "paragraph": {
        "rich_text": [
          {
            "text": {
              "content": "New paragraph text"
            }
          }
        ]
      }
    }
  ]
}
```

### Important rules
- All `rich_text` values must be arrays of text objects: `[{"text": {"content": "..."}}]`
- Never pass stringified JSON as parameter values — always use native objects
- When creating pages in a database, use `"database_id"` instead of `"page_id"` in parent
- For database pages, properties must match the database schema (use `API-get-database` first to check)

## Available Tools

- **Notion**: MCP tools prefixed with `API-` for full Notion workspace access
- **Gmail**: Available via IMAP at imap.gmail.com (credentials in env: GMAIL_ADDRESS, GMAIL_APP_PASSWORD)
- **Google Calendar**: Use gcalcli at the path in GCALCLI_PATH env var. Always pass --client-id and --client-secret from env.
- **GitHub**: `gh` CLI is authenticated via GH_TOKEN env var. Use `gh` for repo operations.
- **Bash**: Full shell access for any system operations
