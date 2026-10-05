import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alertFailedJobs, failedJobMessage } from './alert-failed-jobs.mjs';

test('message includes each failed job and its run link', () => {
  const run = { name: 'Validate', html_url: 'https://github.com/example/actions/runs/1' };
  const jobs = [
    { name: 'clean-install', conclusion: 'failure', html_url: 'https://github.com/example/actions/runs/1/job/2' },
    { name: 'compatibility', conclusion: 'success', html_url: 'https://github.com/example/actions/runs/1/job/3' },
  ];
  assert.match(failedJobMessage(run, jobs), /clean-install: https:\/\/github.com\/example\/actions\/runs\/1\/job\/2/);
  assert.equal(failedJobMessage({ ...run, name: 'Other' }, jobs), null);
  assert.equal(failedJobMessage(run, jobs.slice(1)), null);
});

test('alert posts only failed jobs through the secret webhook', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/jobs?per_page=100&page=1')) return { ok: true, json: async () => ({ jobs: [{ name: 'publish', conclusion: 'failure', html_url: 'https://github.com/job/4' }] }) };
    if (url.endsWith('/runs/3')) return { ok: true, json: async () => ({ name: 'Publish to npm', status: 'completed', html_url: 'https://github.com/run/3' }) };
    return { ok: true };
  };
  assert.equal(await alertFailedJobs({ runId: 3, repository: 'owner/repo', token: 'test-token', webhook: 'https://hooks.example/test', fetchImpl }), true);
  assert.equal(calls.at(-1).url, 'https://hooks.example/test');
  assert.match(JSON.parse(calls.at(-1).options.body).text, /publish: https:\/\/github.com\/job\/4/);
});
