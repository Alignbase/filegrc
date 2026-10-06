import assert from 'node:assert/strict';
import { test } from 'node:test';
import { notificationMessage, sendNotification } from './alert-failed-jobs.mjs';

test('publication success is quiet and failures mention the channel', () => {
  const run = { name: 'Publish to npm', html_url: 'https://github.com/example/actions/runs/1' };
  const jobs = [{ name: 'publish', conclusion: 'failure', html_url: 'https://github.com/example/actions/runs/1/job/2' }];
  assert.equal(notificationMessage(run, [], 'success', 'v1.2.3'), 'FileGRC npm release workflow v1.2.3 succeeded: https://github.com/example/actions/runs/1');
  assert.match(notificationMessage(run, jobs, 'failure', 'v1.2.3'), /^<!channel> FileGRC npm release workflow v1\.2\.3 failed:/);
  assert.match(notificationMessage(run, jobs, 'failure'), /publish: https:\/\/github.com\/example\/actions\/runs\/1\/job\/2/);
  assert.equal(notificationMessage({ ...run, name: 'Other' }, jobs, 'failure'), null);
});

test('ignores unrelated workflows', () => {
  const run = { name: 'Validate', html_url: 'https://github.com/example/actions/runs/1' };
  assert.equal(notificationMessage(run, [], 'success'), null);
  assert.equal(notificationMessage(run, [], 'failure'), null);
});

test('inline notification posts while the source run is still in progress', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/jobs?per_page=100&page=1')) return { ok: true, json: async () => ({ jobs: [{ name: 'publish', conclusion: 'failure', html_url: 'https://github.com/job/4' }] }) };
    if (url.endsWith('/runs/3')) return { ok: true, json: async () => ({ name: 'Publish to npm', status: 'in_progress', html_url: 'https://github.com/run/3' }) };
    return { ok: true };
  };
  assert.equal(await sendNotification({ runId: 3, repository: 'owner/repo', token: 'test-token', webhook: 'https://hooks.example/test', result: 'failure', fetchImpl }), true);
  assert.equal(calls.at(-1).url, 'https://hooks.example/test');
  assert.match(JSON.parse(calls.at(-1).options.body).text, /^<!channel> FileGRC npm release workflow failed:/);
});
