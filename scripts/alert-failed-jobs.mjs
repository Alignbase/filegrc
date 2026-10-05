import { fileURLToPath } from 'node:url';

export function notificationMessage(run, jobs, result, releaseTag = '') {
  if (run.name !== 'Publish to npm') return null;
  if (!['success', 'failure'].includes(result)) return null;

  const subject = `FileGRC npm release workflow${releaseTag ? ` ${releaseTag}` : ''}`;
  if (result === 'success') return `${subject} succeeded: ${run.html_url}`;

  const failed = jobs.filter(job => ['failure', 'timed_out'].includes(job.conclusion));
  const details = failed.length
    ? `\n${failed.map(job => `• ${job.name}: ${job.html_url}`).join('\n')}`
    : '';
  return `<!channel> ${subject} failed: ${run.html_url}${details}`;
}

export async function sendNotification({ runId, repository, token, webhook, result, releaseTag = '', fetchImpl = fetch }) {
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
  const jobs = [];
  if (result === 'failure') {
    for (let page = 1; ; page += 1) {
      const batch = (await github(`/jobs?per_page=100&page=${page}`)).jobs;
      jobs.push(...batch);
      if (batch.length < 100) break;
    }
  }
  const message = notificationMessage(run, jobs, result, releaseTag);
  if (!message) return false;
  const response = await fetchImpl(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: message }),
  });
  if (!response.ok) throw new Error(`Slack notification failed (${response.status}).`);
  return true;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const runId = Number(process.env.GITHUB_RUN_ID);
    if (!Number.isSafeInteger(runId) || runId <= 0) throw new Error('A valid run ID is required.');
    const sent = await sendNotification({
      runId,
      repository: process.env.GITHUB_REPOSITORY,
      token: process.env.GITHUB_TOKEN,
      webhook: process.env.SLACK_WEBHOOK_URL,
      result: process.env.NOTIFICATION_RESULT,
      releaseTag: process.env.RELEASE_TAG,
    });
    console.log(sent ? 'Slack notification sent.' : 'No matching run to notify.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
