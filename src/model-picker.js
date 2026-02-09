// ──── Smart Model Selection ────
// Picks the most appropriate Claude model based on task complexity.
// Skills can override this with an explicit `model` field in skill.json.

// Patterns that suggest simple tasks → use haiku (fast, cheap)
const SIMPLE_PATTERNS = [
  /check\s+(my\s+)?email/i,
  /summarize/i,
  /what('s| is)\s+(the\s+)?(time|date|weather)/i,
  /remind\s+me/i,
  /list\s+(my\s+)?/i,
  /status/i,
  /how\s+(many|much)/i,
  /translate/i,
  /convert/i,
  /define/i,
  /explain\s+\w+$/i, // short explanation
];

// Patterns that suggest complex tasks → use opus (powerful, thorough)
const COMPLEX_PATTERNS = [
  /deploy/i,
  /build\s+(a|an|the|me)/i,
  /create\s+(a|an|the|me)\s+\w+\s+(app|site|project|service|api)/i,
  /refactor/i,
  /debug/i,
  /fix\s+(the|a|this)/i,
  /implement/i,
  /architect/i,
  /design\s+(a|an|the)/i,
  /migrate/i,
  /set\s*up/i,
  /write\s+(a|an|the|me)\s+\w+\s+(script|function|module|class)/i,
  /analyze\s+(the\s+)?(code|codebase|repo)/i,
  /review\s+(the\s+)?(code|pr|pull)/i,
];

/**
 * Pick a model based on message content.
 * Returns a model string or null (to use CLI default).
 *
 * Model options:
 * - null          → uses CLI default (usually sonnet)
 * - "opus"        → complex multi-step tasks
 * - "haiku"       → simple lookups, summaries, quick answers
 * - "sonnet"      → balanced middle ground
 */
function pickModel(message) {
  // Check complex patterns first (they take priority)
  for (const pattern of COMPLEX_PATTERNS) {
    if (pattern.test(message)) {
      return 'opus';
    }
  }

  // Check simple patterns
  for (const pattern of SIMPLE_PATTERNS) {
    if (pattern.test(message)) {
      return 'haiku';
    }
  }

  // Default: sonnet (balanced)
  return 'sonnet';
}

/**
 * Resolve final model: skill override > auto-detected > default
 */
function resolveModel(skillModel, message) {
  // Skill explicitly sets model → use it
  if (skillModel) return skillModel;

  // Auto-detect from message
  return pickModel(message);
}

export { pickModel, resolveModel };
