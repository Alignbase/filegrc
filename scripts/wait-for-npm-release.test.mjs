import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkNpmReleasePackage, waitForNpmRelease } from './wait-for-npm-release.mjs';

const pkg = { name: 'filegrc', version: '0.16.23' };
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('waits for an accepted publish to appear as the latest npm version', async () => {
  let attempts = 0;
  let time = 0;
  const messages = [];
  await waitForNpmRelease([pkg], {
    fetchImpl: async url => {
      if (url.includes('/dist-tags')) return response({ latest: '0.16.23' });
      attempts += 1;
      return attempts < 3 ? response({}, 404)
        : response({ version: '0.16.23', dist: { tarball: 'https://registry.npmjs.org/filegrc/-/filegrc-0.16.23.tgz' } });
    },
    now: () => time,
    sleep: async milliseconds => { time += milliseconds; },
    timeoutMs: 30_000,
    intervalMs: 10_000,
    log: message => messages.push(message),
  });
  assert.equal(attempts, 3);
  assert.equal(time, 20_000);
  assert.match(messages.at(-1), /exposes filegrc@0\.16\.23 as latest/);
});

test('requires a complete exact version and latest tag', async () => {
  assert.match(await checkNpmReleasePackage(pkg, async url => (
    url.includes('/dist-tags') ? response({ latest: '0.16.22' })
      : response({ version: '0.16.23', dist: { tarball: 'tarball' } })
  )), /latest is 0\.16\.22/);
  assert.match(await checkNpmReleasePackage(pkg, async () => response({ version: '0.16.23' })), /metadata is incomplete/);
});

test('reports the pending package when registry propagation exceeds the deadline', async () => {
  let time = 0;
  await assert.rejects(waitForNpmRelease([pkg], {
    fetchImpl: async () => response({}, 404),
    now: () => time,
    sleep: async milliseconds => { time += milliseconds; },
    timeoutMs: 20_000,
    intervalMs: 10_000,
    log: () => {},
  }), /filegrc@0\.16\.23: HTTP 404/);
  assert.equal(time, 20_000);
});
