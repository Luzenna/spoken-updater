// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as semver from '../src/semver.js';
import { parseToc, tocOwner } from '../src/toc.js';

test('semver compares numerically, not as strings or by date', () => {
  assert.equal(semver.compare('2.10.0', '2.9.9'), 1);
  assert.equal(semver.compare('v2.2.1', '2.2.1'), 0);
  assert.equal(semver.compare('0.0.3', '0.0.10'), -1);
  assert.equal(semver.compare('2.0.0', '0.0.3'), 1);
  assert.equal(semver.compare('1.0.0-beta.2', '1.0.0'), -1);
  assert.equal(semver.compare('1.0.0-beta.2', '1.0.0-beta.10'), -1);
  assert.equal(semver.compare('1.0.0-alpha', '1.0.0-1'), 1);
});

test('semver max skips invalid versions', () => {
  assert.equal(semver.max(['2.1.0', 'banana', '2.10.0', '2.2.0', 'v3']), '2.10.0');
  assert.equal(semver.max(['nope']), null);
  assert.equal(semver.clean('v2.3.2'), '2.3.2');
  assert.equal(semver.valid('2.3'), false);
});

test('toc parsing reads version, interface list and X-Part-Of', () => {
  const t = parseToc('﻿## Interface: 100007, 16001\r\n## Title: x\r\n## Version: 2.3.2\r\n## X-Part-Of: Spoken\r\nfile.lua\r\n');
  assert.equal(t.version, '2.3.2');
  assert.deepEqual(t.interfaces, [100007, 16001]);
  assert.equal(t.partOf, 'Spoken');
  assert.deepEqual(parseToc('## Interface: 11509').interfaces, [11509]);
});

test('toc owner handles flavor suffixes', () => {
  assert.equal(tocOwner('SpokenPlayer.toc'), 'SpokenPlayer');
  assert.equal(tocOwner('SpokenPlayer_Mainline.toc'), 'SpokenPlayer');
  assert.equal(tocOwner('SpokenPlayer-Forever.toc'), 'SpokenPlayer');
  assert.equal(tocOwner('SpokenPlayer_Camelot.toc'), 'SpokenPlayer');
  assert.equal(tocOwner('SpokenQuestsAudio_frFR.toc'), 'SpokenQuestsAudio_frFR');
  assert.equal(tocOwner('readme.md'), null);
});
