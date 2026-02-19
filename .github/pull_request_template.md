## What does this PR do?

<!-- Describe what problem this solves and what changed -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Platform support (Windows / Linux / new terminal emulator)
- [ ] Documentation / README improvement
- [ ] Refactor (no behavior change)

## Checklist

- [ ] `bash -n hooks/*.sh` passes (no shell syntax errors)
- [ ] `python3 -m py_compile hooks/*.py` passes
- [ ] `node --check mcp-coordinator/index.js mcp-coordinator/lib.js` passes
- [ ] `cd mcp-coordinator && npm run test:unit && npm run test:e2e` passes
- [ ] `bash tests/hooks-smoke.sh && bash tests/health-check-regression.sh` pass
- [ ] No private project references introduced (paths, agent names, personal data)

## Screenshots / Demo (if applicable)

<!-- If you're adding a demo GIF, platform screenshot, or README change — paste it here -->
