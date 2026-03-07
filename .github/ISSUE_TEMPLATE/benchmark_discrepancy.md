---
name: Benchmark discrepancy
about: Report unexpected benchmark results that differ from published numbers
title: "[BENCHMARK] "
labels: benchmark
assignees: ""
---

**Which benchmark**
e.g. coordinator session read, boot scan, conflict detection, cost comparison

**Expected result**
What the README, `bench/latest-results.json`, or `docs/BENCH_METHODOLOGY.md` says.

**Observed result**
What you measured locally.

**Hardware and OS**

- CPU:
- RAM:
- Disk (SSD/HDD):
- OS:
- Node.js version:

**bench/latest-results.json content**

```json
paste content of: cat bench/latest-results.json | jq .results
```

**CI run link (if applicable)**
Link to the CI run where the discrepancy was observed.

**Steps to reproduce**

```bash
node bench/coord-benchmark.mjs
```

**Additional context**
Any other relevant info (other processes running, VM vs bare metal, etc).
