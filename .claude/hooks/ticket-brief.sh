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
  echo "Piped, \`gh issue view --comments\` prints only the comments, without the body. Read the ticket and its brief (the latest comment) with \`gh issue view <n> --json title,body,comments --jq '.title, .body, (.comments[-1].body // \"\")'\`, or one comment with \`--json comments --jq '.comments[-1].body'\`." >&2
  exit 2
fi

[ -n "$agent" ] && exit 0

# Without --jq, a view's comments come as the whole thread's JSON (#123's
# retro: 7.2k with the workflow doc); the brief is the latest comment.
if printf '%s' "$cmd" | grep -Eq 'gh +issue +view[^;&|]*--json +[^ ]*comments' &&
  ! printf '%s' "$cmd" | grep -Eq 'gh +issue +view[^;&|]*--jq'; then
  echo "Read the ticket and its brief (the latest comment) with \`gh issue view <n> --json title,body,comments --jq '.title, .body, (.comments[-1].body // \"\")'\`, not the whole thread's JSON." >&2
  exit 2
fi

brief="Ask an Explore subagent for a short brief on the neighbouring tickets (what each one owns that this ticket touches), rather than reading them here."
if printf '%s' "$cmd" | grep -Eq '(^|[;&|(] *)(for|while) ' &&
  printf '%s' "$cmd" | grep -Eq 'gh +issue +view'; then
  echo "$brief" >&2
  exit 2
fi
# Two or more different tickets printed in one command. A view whose output
# goes to a file (`> file`, not `2>`) isn't read here, so it doesn't count.
count=$(printf '%s' "$cmd" | grep -Eo 'gh +issue +view +[0-9]+[^;&|]*' |
  grep -Ev '(^|[^0-9])>' | grep -Eo '^gh +issue +view +[0-9]+' |
  grep -Eo '[0-9]+$' | sort -u | wc -l | tr -d ' ')
if [ "$count" -gt 1 ]; then
  echo "$brief" >&2
  exit 2
fi
exit 0
