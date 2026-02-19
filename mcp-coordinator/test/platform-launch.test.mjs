import test from 'node:test';
import assert from 'node:assert/strict';
import { __test__ } from '../index.js';

test('darwin iTerm2 split uses AppleScript split command', () => {
  const launch = __test__.buildPlatformLaunchCommand('darwin', 'iTerm2', "echo hi", 'split');
  assert.equal(launch.app, 'iTerm2');
  assert.equal(launch.shell, false);
  assert.match(launch.cmd, /split vertically with default profile/);
  assert.match(launch.cmd, /write text/);
});

test('windows terminal split uses wt sp -V', () => {
  const launch = __test__.buildPlatformLaunchCommand('win32', 'WindowsTerminal', 'echo hi', 'split');
  assert.equal(launch.app, 'WindowsTerminal');
  assert.equal(launch.shell, true);
  assert.match(launch.cmd, /wt -w 0 sp -V/);
});

test('linux kitty split uses kitty launch window', () => {
  const launch = __test__.buildPlatformLaunchCommand('linux', 'kitty', 'echo hi', 'split');
  assert.equal(launch.app, 'kitty');
  assert.equal(launch.shell, false);
  assert.match(launch.cmd, /kitty @ launch --type=window/);
});

test('fallback uses nohup background', () => {
  const launch = __test__.buildPlatformLaunchCommand('linux', 'none', 'echo hi', 'tab');
  assert.equal(launch.app, 'background');
  assert.match(launch.cmd, /nohup bash -c/);
});
