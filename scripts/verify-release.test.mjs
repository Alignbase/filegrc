import assert from 'node:assert/strict';
import { test } from 'node:test';
import { releaseVersion, verifyRelease } from './verify-release.mjs';

test('release tag must be a version tag', () => {
  assert.equal(releaseVersion('v0.16.22'), '0.16.22');
  for (const tag of ['0.16.22', 'main', 'v0.16', 'v01.2.3', 'v0.16.22/other']) {
    assert.throws(() => releaseVersion(tag));
  }
});

test('release requires matching manifests, checkout, and main ancestry', () => {
  const calls = [];
  const git = (...args) => {
    calls.push(args);
    if (args[0] === 'rev-parse') return 'abc123';
    return '';
  };
  const input = { tag: 'v0.16.22', ref: 'refs/tags/v0.16.22', runGit: git, readVersion: () => '0.16.22' };
  assert.equal(verifyRelease(input).commit, 'abc123');
  assert.deepEqual(calls.at(-1), ['merge-base', '--is-ancestor', 'abc123', 'FETCH_HEAD']);
  assert.throws(() => verifyRelease({ ...input, readVersion: () => '0.16.21' }), /does not match/);
  assert.throws(() => verifyRelease({ ...input, ref: 'refs/heads/main' }), /must run from/);
  assert.throws(() => verifyRelease({ ...input, runGit: (...args) => args[0] === 'rev-parse' && args[1] === 'HEAD' ? 'other' : 'abc123' }), /checked-out/);
  assert.throws(() => verifyRelease({ ...input, runGit: (...args) => {
    if (args[0] === 'merge-base') throw new Error('unrelated');
    return 'abc123';
  } }), /protected main/);
});
