#!/bin/sh
# PreToolUse hook on Bash: reading other tickets fills the main session with
# their text. Neighbouring tickets go to an Explore subagent, which returns a
# short brief (docs/agents/ticket-workflow.md, step 1).
input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')
# A subagent's hook input carries agent_id; the sweep and the briefs read
# tickets on purpose, so the ticket-count checks hold only in the main session.
agent=$(printf '%s' "$input" | jq -r '.agent_id // ""')

# Piped, `gh issue view --comments` prints the comments without the body.
if printf '%s' "$cmd" | grep -Eq 'gh +issue +view[^;&|]*--comments' &&
  ! printf '%s' "$cmd" | grep -Eq 'gh +issue +view[^;&|]*--json'; then
  echo "Piped, \`gh issue view --comments\` prints only the comments, without the body. Read the ticket with \`gh issue view <n> --json title,body,comments\`, or one comment with \`--json comments --jq '.comments[-1].body'\`." >&2
  exit 2
fi

[ -n "$agent" ] && exit 0

brief="Ask an Explore subagent for a short brief on the neighbouring tickets (what each one owns that this ticket touches), rather than reading them here."
if printf '%s' "$cmd" | grep -Eq '(^|[;&|(] *)(for|while) ' &&
  printf '%s' "$cmd" | grep -Eq 'gh +issue +view'; then
  echo "$brief" >&2
  exit 2
fi
# Two or more different tickets viewed in one command.
count=$(printf '%s' "$cmd" | grep -Eo 'gh +issue +view +[0-9]+' | grep -Eo '[0-9]+$' | sort -u | wc -l | tr -d ' ')
if [ "$count" -gt 1 ]; then
  echo "$brief" >&2
  exit 2
fi
exit 0
