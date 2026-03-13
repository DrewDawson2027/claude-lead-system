const fs = require('fs');

let content = fs.readFileSync('bench/workflow-benchmark.mjs', 'utf8');

// 1. Rename the harness to "Scenario Model & Benchmark"
content = content.replace('Workflow Benchmark Harness', 'Workflow Scenario Model & Benchmark Harness');

// 2. Wrap api_cost and max_plan_pressure under modeled_economics
// Wrap latency under measured_latency
// Wrap operator_control under feature_analysis
content = content.replace(/api_cost: \{/g, 'modeled_economics: {\n                api_cost: {');
content = content.replace(/max_plan_pressure: \{/g, 'max_plan_pressure: {');
content = content.replace(/latency: \{/g, '    },\n            measured_latency: {');
content = content.replace(/operator_control: \{/g, 'feature_analysis: {\n                operator_control: {');

// Fix the closing braces for these structures (this is tricky with regex, let's do more precise replacements)
