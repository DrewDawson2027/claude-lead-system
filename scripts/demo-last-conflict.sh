#!/bin/bash
# Show a real past conflict detection event from the live conflict log
CONFLICTS_FILE="$HOME/.claude/terminals/conflicts.jsonl"

if [[ ! -f "$CONFLICTS_FILE" ]] || [[ ! -s "$CONFLICTS_FILE" ]]; then
  echo "No conflict history found."
  exit 0
fi

echo "▶  Last recorded conflict (from live conflict log):"
tail -1 "$CONFLICTS_FILE" | python3 -c "
import json, sys
d = json.loads(sys.stdin.read())
fname = d['files'][0].split('/')[-1] if d.get('files') else 'unknown'
nsessions = len(d.get('conflicts', []))
ts = d.get('ts', '')[:19].replace('T', ' ')
print(f'  File:     {fname}')
print(f'  Sessions: {nsessions} in conflict')
print(f'  Detected: {ts} UTC')
"
