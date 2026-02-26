/**
 * Cost comparison: Lead System vs Agent Teams.
 * Estimates real cost based on active workers and sessions.
 * @module cost-comparison
 */

import { readdirSync } from "fs";
import { join } from "path";
import { cfg } from "./constants.js";
import { readJSON, text } from "./helpers.js";

// Pricing per 1K tokens (as of Feb 2026)
const PRICING = {
  "claude-sonnet-4-5": { input: 0.003, output: 0.015 },
  "claude-opus-4-5":   { input: 0.015, output: 0.075 },
  "claude-haiku-3-5":  { input: 0.0008, output: 0.004 },
  "sonnet":            { input: 0.003, output: 0.015 },
  "opus":              { input: 0.015, output: 0.075 },
  "haiku":             { input: 0.0008, output: 0.004 },
};

const DEFAULT_PRICING = { input: 0.003, output: 0.015 }; // Sonnet default

function estimateCost(tokens, model) {
  const pricing = PRICING[model] || DEFAULT_PRICING;
  // Assume 60% input, 40% output ratio
  const inputTokens = tokens * 0.6;
  const outputTokens = tokens * 0.4;
  return (inputTokens / 1000) * pricing.input + (outputTokens / 1000) * pricing.output;
}

function readWorkerMetas() {
  const dir = cfg().RESULTS_DIR;
  try {
    return readdirSync(dir)
      .filter(f => f.startsWith("meta-") && f.endsWith(".json"))
      .map(f => readJSON(join(dir, f)))
      .filter(Boolean);
  } catch { return []; }
}

function readSessions() {
  const dir = cfg().TERMINALS_DIR;
  try {
    return readdirSync(dir)
      .filter(f => f.startsWith("session-") && f.endsWith(".json"))
      .map(f => readJSON(join(dir, f)))
      .filter(Boolean);
  } catch { return []; }
}

/**
 * Handle coord_cost_comparison tool call.
 * Compares estimated Lead System cost vs projected Agent Teams cost.
 * @returns {object} MCP text response
 */
export function handleCostComparison() {
  const workers = readWorkerMetas();
  const sessions = readSessions().filter(s => s.status !== "closed");

  const leadSessionCount = sessions.length;
  const workerCount = workers.length;

  // Lead System: estimate tokens from worker metas
  let leadWorkerTokens = 0;
  let leadWorkerCost = 0;
  for (const w of workers) {
    const tokens = w.estimated_tokens || w.tokens || 80000; // default 80K per worker
    const model = w.model || "sonnet";
    leadWorkerTokens += tokens;
    leadWorkerCost += estimateCost(tokens, model);
  }

  // Lead session (the orchestrator): estimate 150K tokens
  const leadSessionTokens = 150000;
  const leadSessionCost = estimateCost(leadSessionTokens, "opus");

  // Lead System total
  const leadTotal = leadSessionCost + leadWorkerCost;

  // Agent Teams projection: each worker becomes a full teammate with 3-5x token overhead
  const TEAMMATE_OVERHEAD = 3.5; // teammates maintain growing context windows
  const COORDINATION_TOKENS = 100000; // messaging between teammates costs tokens
  const agentTeamsWorkerCost = workerCount > 0
    ? workers.reduce((sum, w) => {
        const tokens = (w.estimated_tokens || w.tokens || 80000) * TEAMMATE_OVERHEAD;
        return sum + estimateCost(tokens, w.model || "sonnet");
      }, 0)
    : 0;
  const agentTeamsCoordCost = estimateCost(COORDINATION_TOKENS, "sonnet");
  const agentTeamsSessionCost = estimateCost(leadSessionTokens, "opus");
  const agentTeamsTotal = agentTeamsSessionCost + agentTeamsWorkerCost + agentTeamsCoordCost;

  const savings = agentTeamsTotal - leadTotal;
  const savingsPct = agentTeamsTotal > 0 ? ((savings / agentTeamsTotal) * 100).toFixed(0) : 0;

  let output = `## Cost Comparison: Lead System vs Agent Teams\n\n`;
  output += `### Current Session\n`;
  output += `- Active sessions: ${leadSessionCount}\n`;
  output += `- Workers spawned: ${workerCount}\n\n`;

  output += `### Lead System (actual)\n`;
  output += `| Component | Tokens | Cost |\n|-----------|--------|------|\n`;
  output += `| Lead session (Opus) | ~${(leadSessionTokens / 1000).toFixed(0)}K | $${leadSessionCost.toFixed(2)} |\n`;
  for (const w of workers) {
    const tokens = w.estimated_tokens || w.tokens || 80000;
    const cost = estimateCost(tokens, w.model || "sonnet");
    output += `| Worker: ${w.worker_id || w.name || "unnamed"} (${w.model || "sonnet"}) | ~${(tokens / 1000).toFixed(0)}K | $${cost.toFixed(2)} |\n`;
  }
  output += `| Coordination (filesystem) | 0 | $0.00 |\n`;
  output += `| **Total** | | **$${leadTotal.toFixed(2)}** |\n\n`;

  output += `### Agent Teams (projected)\n`;
  output += `| Component | Tokens | Cost |\n|-----------|--------|------|\n`;
  output += `| Lead session (Opus) | ~${(leadSessionTokens / 1000).toFixed(0)}K | $${agentTeamsSessionCost.toFixed(2)} |\n`;
  for (const w of workers) {
    const baseTokens = w.estimated_tokens || w.tokens || 80000;
    const tokens = baseTokens * TEAMMATE_OVERHEAD;
    const cost = estimateCost(tokens, w.model || "sonnet");
    output += `| Teammate: ${w.worker_id || w.name || "unnamed"} (${w.model || "sonnet"}) | ~${(tokens / 1000).toFixed(0)}K | $${cost.toFixed(2)} |\n`;
  }
  output += `| Coordination (API tokens) | ~${(COORDINATION_TOKENS / 1000).toFixed(0)}K | $${agentTeamsCoordCost.toFixed(2)} |\n`;
  output += `| **Total** | | **$${agentTeamsTotal.toFixed(2)}** |\n\n`;

  output += `### Savings\n`;
  output += `- **$${savings.toFixed(2)} saved** (${savingsPct}% reduction)\n`;
  output += `- Coordination cost: $0.00 vs $${agentTeamsCoordCost.toFixed(2)}\n`;
  output += `- Worker overhead: ${TEAMMATE_OVERHEAD}x less (stateless vs growing context)\n`;

  return text(output);
}
