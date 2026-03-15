#!/bin/bash
# Count unique coord_ MCP tools registered in the coordinator
count=$(grep -oE 'coord_[a-z_]+' ~/claude-lead-system/mcp-coordinator/index.js | sort -u | wc -l | tr -d ' ')
echo "${count} MCP coordination tools registered"
