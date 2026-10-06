import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const registry = 'https://registry.npmjs.org';
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function readRegistryJson(url, fetchImpl) {
  const response = await fetchImpl(url, {
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export async function checkNpmReleasePackage({ name, version }, fetchImpl = fetch) {
  try {
    const packagePath = encodeURIComponent(name);
    const published = await readRegistryJson(`${registry}/${packagePath}/${encodeURIComponent(version)}`, fetchImpl);
    if (published.version !== version || !published.dist?.tarball) {
      return `${name}@${version}: version metadata is incomplete`;
    }
    const tags = await readRegistryJson(`${registry}/-/package/${packagePath}/dist-tags`, fetchImpl);
    if (tags.latest !== version) return `${name}@${version}: latest is ${tags.latest || 'missing'}`;
    return null;
  } catch (error) {
    return `${name}@${version}: ${error.message}`;
  }
}

export async function waitForNpmRelease(packages, {
  fetchImpl = fetch,
  now = Date.now,
  sleep = pause,
  timeoutMs = 600_000,
  intervalMs = 10_000,
  log = console.log,
} = {}) {
  const deadline = now() + timeoutMs;
  while (true) {
    const pending = (await Promise.all(packages.map(pkg => checkNpmReleasePackage(pkg, fetchImpl))))
      .filter(Boolean);
    if (pending.length === 0) {
      log(`npm exposes ${packages.map(({ name, version }) => `${name}@${version}`).join(' and ')} as latest.`);
      return;
    }
    if (now() >= deadline) {
      throw new Error(`npm did not expose the release within ${timeoutMs / 1000} seconds:\n${pending.join('\n')}`);
    }
    log(`Waiting for npm registry: ${pending.join('; ')}`);
    await sleep(Math.min(intervalMs, deadline - now()));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const packages = ['filegrc', 'create-filegrc'].map(name => ({
    name,
    version: JSON.parse(readFileSync(new URL(`../packages/${name}/package.json`, import.meta.url), 'utf8')).version,
  }));
  try {
    await waitForNpmRelease(packages);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
