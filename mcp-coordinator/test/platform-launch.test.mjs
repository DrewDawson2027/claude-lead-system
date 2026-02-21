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
  const cmd = __test__.buildWorkerScript({
    taskId: 'W1',
    workDir: 'C:\\\\work',
    resultFile: 'C:\\\\r.txt',
    pidFile: 'C:\\\\p.pid',
    metaFile: 'C:\\\\m.meta.json',
    model: 'sonnet',
    agent: 'build',
    promptFile: 'C:\\\\prompt.txt',
    workerPs1File: 'C:\\\\worker.ps1',
    platformName: 'win32',
  });
  assert.match(cmd, /ExecutionPolicy Bypass -File/);
  assert.doesNotMatch(cmd, /-Command/);
});

test('unix worker script safely quotes apostrophes in paths', () => {
  const cmd = __test__.buildWorkerScript({
    taskId: 'W2',
    workDir: "/tmp/o'hara/work",
    resultFile: "/tmp/o'hara/result.txt",
    pidFile: "/tmp/o'hara/pid.txt",
    metaFile: "/tmp/o'hara/meta.json",
    model: 'sonnet',
    agent: '',
    promptFile: "/tmp/o'hara/prompt.txt",
    workerPs1File: '',
    platformName: 'linux',
  });
  assert.match(cmd, /cd '\/tmp\/o'\\''hara\/work'/);
  assert.match(cmd, /< '\/tmp\/o'\\''hara\/prompt\.txt'/);
});

// --- Missing branch tests: buildPlatformLaunchCommand ---

test('darwin iTerm2 tab creates tab (not split)', () => {
  const launch = __test__.buildPlatformLaunchCommand('darwin', 'iTerm2', 'echo hi', 'tab');
  assert.equal(launch.app, 'iTerm2');
  assert.match(launch.args.join(' '), /create tab with default profile/);
});

test('darwin Terminal uses do script', () => {
  const launch = __test__.buildPlatformLaunchCommand('darwin', 'Terminal', 'echo hi', 'tab');
  assert.equal(launch.app, 'Terminal');
  assert.equal(launch.command, 'osascript');
  assert.match(launch.args.join(' '), /do script/);
});

test('darwin none falls back to background', () => {
  const launch = __test__.buildPlatformLaunchCommand('darwin', 'none', 'echo hi', 'tab');
  assert.equal(launch.app, 'background');
  assert.equal(launch.command, 'bash');
  assert.equal(launch.detached, true);
});

test('win32 WindowsTerminal tab uses nt (not sp)', () => {
  const launch = __test__.buildPlatformLaunchCommand('win32', 'WindowsTerminal', 'echo hi', 'tab');
  assert.equal(launch.app, 'WindowsTerminal');
  assert.deepEqual(launch.args.slice(0, 4), ['-w', '0', 'nt', 'cmd']);
});

test('win32 cmd fallback uses start', () => {
  const launch = __test__.buildPlatformLaunchCommand('win32', 'cmd', 'echo hi', 'tab');
  assert.equal(launch.app, 'cmd');
  assert.equal(launch.command, 'cmd');
  assert.deepEqual(launch.args.slice(0, 3), ['/c', 'start', '']);
});

test('linux gnome-terminal uses -- separator', () => {
  const launch = __test__.buildPlatformLaunchCommand('linux', 'gnome-terminal', 'echo hi', 'tab');
  assert.equal(launch.app, 'gnome-terminal');
  assert.equal(launch.command, 'gnome-terminal');
  assert.deepEqual(launch.args.slice(0, 2), ['--', 'bash']);
});

test('linux konsole uses -e flag', () => {
  const launch = __test__.buildPlatformLaunchCommand('linux', 'konsole', 'echo hi', 'tab');
  assert.equal(launch.app, 'konsole');
  assert.equal(launch.command, 'konsole');
  assert.deepEqual(launch.args.slice(0, 2), ['-e', 'bash']);
});

test('linux alacritty uses -e flag', () => {
  const launch = __test__.buildPlatformLaunchCommand('linux', 'alacritty', 'echo hi', 'tab');
  assert.equal(launch.app, 'alacritty');
  assert.equal(launch.command, 'alacritty');
  assert.deepEqual(launch.args.slice(0, 2), ['-e', 'bash']);
});

test('linux kitty tab uses launch --type=tab', () => {
  const launch = __test__.buildPlatformLaunchCommand('linux', 'kitty', 'echo hi', 'tab');
  assert.equal(launch.app, 'kitty');
  assert.match(launch.args.join(' '), /--type=tab/);
});

// --- Missing branch: unix worker script with agent ---

test('unix worker script includes agent flag', () => {
  const cmd = __test__.buildWorkerScript({
    taskId: 'W3',
    workDir: '/tmp/work',
    resultFile: '/tmp/result.txt',
    pidFile: '/tmp/pid.txt',
    metaFile: '/tmp/meta.json',
    model: 'sonnet',
    agent: 'my-agent',
    promptFile: '/tmp/prompt.txt',
    workerPs1File: '',
    platformName: 'linux',
  });
  assert.match(cmd, /--agent 'my-agent'/);
  assert.match(cmd, /unset CLAUDECODE/);
});

test('unix worker script omits agent flag when empty', () => {
  const cmd = __test__.buildWorkerScript({
    taskId: 'W4',
    workDir: '/tmp/work',
    resultFile: '/tmp/result.txt',
    pidFile: '/tmp/pid.txt',
    metaFile: '/tmp/meta.json',
    model: 'sonnet',
    agent: '',
    promptFile: '/tmp/prompt.txt',
    workerPs1File: '',
    platformName: 'linux',
  });
  assert.doesNotMatch(cmd, /--agent/);
});
