import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function failedJobMessage(run, jobs) {
  if (!['Validate', 'Publish to npm'].includes(run.name)) return null;
  const failed = jobs.filter(job => ['failure', 'timed_out'].includes(job.conclusion));
  if (failed.length === 0) return null;
  return `FileGRC ${run.name} failed: ${run.html_url}\n${failed.map(job => `• ${job.name}: ${job.html_url}`).join('\n')}`;
}

export async function alertFailedJobs({ runId, repository, token, webhook, fetchImpl = fetch }) {
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  async function github(path) {
    const response = await fetchImpl(`https://api.github.com/repos/${repository}/actions/runs/${runId}${path}`, { headers });
    if (!response.ok) throw new Error(`GitHub API failed (${response.status}).`);
    return response.json();
  }
  const run = await github('');
  if (run.status !== 'completed') throw new Error('Run has not completed.');
  const jobs = [];
  for (let page = 1; ; page += 1) {
    const batch = (await github(`/jobs?per_page=100&page=${page}`)).jobs;
    jobs.push(...batch);
    if (batch.length < 100) break;
  }
  const message = failedJobMessage(run, jobs);
  if (!message) return false;
  const response = await fetchImpl(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: message }),
  });
  if (!response.ok) throw new Error(`Slack alert failed (${response.status}).`);
  return true;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const runId = event.workflow_run?.id ?? Number(event.inputs?.run_id);
    if (!Number.isSafeInteger(runId) || runId <= 0) throw new Error('A valid run ID is required.');
    const sent = await alertFailedJobs({
      runId,
      repository: process.env.GITHUB_REPOSITORY,
      token: process.env.GITHUB_TOKEN,
      webhook: process.env.SLACK_WEBHOOK_URL,
    });
    console.log(sent ? 'Failure alert sent.' : 'No failed Validate or Publish jobs to alert.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
