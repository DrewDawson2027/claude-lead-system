/**
 * Hook watchdog — validate hook files exist, are executable, have valid syntax.
 */

import { existsSync, accessSync, constants, readdirSync } from 'fs';
import { join, extname } from 'path';
import { spawnSync } from 'child_process';

/**
 * Validate all hook files in a directory.
 * @param {string} hooksDir - path to hooks directory
 * @returns {{ hooks: Array<{ name: string, path: string, exists: boolean, executable: boolean, syntax_valid: boolean, issues: string[] }>, all_valid: boolean }}
 */
export function validateHooks(hooksDir) {
  if (!existsSync(hooksDir)) return { hooks: [], all_valid: true };

  let files;
  try { files = readdirSync(hooksDir); } catch { return { hooks: [], all_valid: true }; }

  const hookFiles = files.filter(f => f.endsWith('.sh') || f.endsWith('.py'));
  const results = [];

  for (const f of hookFiles) {
    const fp = join(hooksDir, f);
    const ext = extname(f);
    const issues = [];
    let executable = true;
    let syntax_valid = true;

    // Check executable permission (non-Windows, .sh only)
    if (ext === '.sh' && process.platform !== 'win32') {
      try {
        accessSync(fp, constants.X_OK);
      } catch {
        executable = false;
        issues.push('Not executable (missing +x)');
      }
    }

    // Syntax check
    if (ext === '.sh') {
      const result = spawnSync('bash', ['-n', fp], { timeout: 5000, stdio: 'pipe' });
      if (result.status !== 0) {
        syntax_valid = false;
        issues.push(`Bash syntax error: ${(result.stderr || '').toString().trim().slice(0, 200)}`);
      }
    } else if (ext === '.py') {
      const result = spawnSync('python3', ['-c', `import py_compile, sys; py_compile.compile(sys.argv[1], doraise=True)`, fp], { timeout: 5000, stdio: 'pipe' });
      if (result.status !== 0) {
        syntax_valid = false;
        issues.push(`Python syntax error: ${(result.stderr || '').toString().trim().slice(0, 200)}`);
      }
    }

    results.push({ name: f, path: fp, exists: true, executable, syntax_valid, issues });
  }

  return {
    hooks: results,
    all_valid: results.every(h => h.executable && h.syntax_valid && h.issues.length === 0),
  };
}

/**
 * Validate hook output format for a sample output string.
 * @param {string} hookName
 * @param {string} sampleOutput
 * @returns {{ valid: boolean, issues: string[] }}
 */
export function validateHookOutputFormat(hookName, sampleOutput) {
  const issues = [];
  if (!sampleOutput || !sampleOutput.trim()) {
    return { valid: true, issues: [] }; // Empty output is acceptable
  }

  // Python hooks should output valid JSON
  if (hookName.endsWith('.py')) {
    try {
      JSON.parse(sampleOutput.trim());
    } catch {
      issues.push('Python hook output is not valid JSON');
    }
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Run hook selftest where supported.
 * Hooks that accept --selftest return a known-good output.
 * @param {string} hooksDir
 * @returns {Array<{ name: string, selftest_passed: boolean, output: string, error: string|null }>}
 */
export function runHookSelftest(hooksDir) {
  if (!existsSync(hooksDir)) return [];

  let files;
  try { files = readdirSync(hooksDir); } catch { return []; }

  const results = [];
  for (const f of files.filter(x => x.endsWith('.sh') || x.endsWith('.py'))) {
    const fp = join(hooksDir, f);
    const ext = extname(f);
    const cmd = ext === '.sh' ? 'bash' : 'python3';
    const args = ext === '.sh' ? [fp, '--selftest'] : [fp, '--selftest'];

    try {
      const result = spawnSync(cmd, args, { timeout: 10000, stdio: 'pipe', env: { ...process.env, HOOK_SELFTEST: '1' } });
      const output = (result.stdout || '').toString().trim();
      const stderr = (result.stderr || '').toString().trim();

      if (result.status === 0) {
        results.push({ name: f, selftest_passed: true, output: output.slice(0, 500), error: null });
      } else {
        // Hooks that don't support --selftest will exit non-zero — that's OK
        results.push({ name: f, selftest_passed: false, output: output.slice(0, 500), error: stderr.slice(0, 200) || 'exited non-zero' });
      }
    } catch (err) {
      results.push({ name: f, selftest_passed: false, output: '', error: err.message });
    }
  }

  return results;
}
