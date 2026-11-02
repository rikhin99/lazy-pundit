#!/bin/sh
# PreToolUse hook on Bash: reading tickets in a loop fills the main session
# with other tickets' text. Neighbouring tickets go to an Explore subagent,
# which returns a short brief (docs/agents/ticket-workflow.md, step 1).
cmd=$(jq -r '.tool_input.command // ""')
if printf '%s' "$cmd" | grep -Eq '(^|[;&|(] *)(for|while) ' &&
  printf '%s' "$cmd" | grep -Eq 'gh +issue +view'; then
  echo "Ask an Explore subagent for a short brief on the neighbouring tickets (what each one owns that this ticket touches), rather than reading them in a loop here." >&2
  exit 2
fi
exit 0
