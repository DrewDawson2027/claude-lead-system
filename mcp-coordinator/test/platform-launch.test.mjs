import test from 'node:test';
import assert from 'node:assert/strict';
import { __test__ } from '../index.js';

test('darwin iTerm2 split uses AppleScript split command', () => {
  const launch = __test__.buildPlatformLaunchCommand('darwin', 'iTerm2', "echo hi", 'split');
  assert.equal(launch.app, 'iTerm2');
  assert.equal(launch.command, 'osascript');
  assert.equal(Array.isArray(launch.args), true);
  assert.equal(launch.args[0], '-e');
  assert.match(launch.args.join(' '), /split vertically with default profile/);
  assert.match(launch.args.join(' '), /write text/);
});

test('windows terminal split uses wt sp -V', () => {
  const launch = __test__.buildPlatformLaunchCommand('win32', 'WindowsTerminal', 'echo hi', 'split');
  assert.equal(launch.app, 'WindowsTerminal');
  assert.equal(launch.command, 'wt');
  assert.deepEqual(launch.args.slice(0, 4), ['-w', '0', 'sp', '-V']);
});

test('linux kitty split uses kitty launch window', () => {
  const launch = __test__.buildPlatformLaunchCommand('linux', 'kitty', 'echo hi', 'split');
  assert.equal(launch.app, 'kitty');
  assert.equal(launch.command, 'kitty');
  assert.deepEqual(launch.args.slice(0, 4), ['@', 'launch', '--type=window', 'bash']);
});

test('fallback uses nohup background', () => {
  const launch = __test__.buildPlatformLaunchCommand('linux', 'none', 'echo hi', 'tab');
  assert.equal(launch.app, 'background');
  assert.equal(launch.command, 'bash');
  assert.deepEqual(launch.args.slice(0, 2), ['-lc', 'echo hi']);
});

test('windows worker script launch uses powershell file mode', () => {
  const cmd = __test__.buildWorkerScript(
    'W1',
    'C:\\\\work',
    'C:\\\\r.txt',
    'C:\\\\p.pid',
    'C:\\\\m.meta.json',
    '--model sonnet',
    '--agent build',
    '--settings C:\\\\settings.json',
    'C:\\\\prompt.txt',
    'C:\\\\worker.ps1',
    'win32',
  );
  assert.match(cmd, /ExecutionPolicy Bypass -File/);
  assert.doesNotMatch(cmd, /-Command/);
});
