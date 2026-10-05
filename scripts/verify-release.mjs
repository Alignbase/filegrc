import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const manifests = [
  'package.json',
  'packages/filegrc/package.json',
  'packages/create-filegrc/package.json',
  'packages/create-filegrc/template/package.json',
];

export function releaseVersion(tag) {
  if (!/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(tag ?? '')) {
    throw new Error('Release must use an existing vX.Y.Z tag.');
  }
  return tag.slice(1);
}

export function verifyRelease({ tag, ref, runGit, readVersion }) {
  const version = releaseVersion(tag);
  if (ref !== `refs/tags/${tag}`) {
    throw new Error(`Publish must run from refs/tags/${tag}.`);
  }
  for (const path of manifests) {
    if (readVersion(path) !== version) {
      throw new Error(`${path} does not match ${tag}.`);
    }
  }

  runGit('fetch', '--no-tags', 'origin', 'main');
  const tagCommit = runGit('rev-parse', '--verify', `refs/tags/${tag}^{commit}`);
  const checkoutCommit = runGit('rev-parse', 'HEAD');
  if (tagCommit !== checkoutCommit) {
    throw new Error(`${tag} does not point at the checked-out commit.`);
  }
  try {
    runGit('merge-base', '--is-ancestor', tagCommit, 'FETCH_HEAD');
  } catch {
    throw new Error(`${tag} is not on protected main.`);
  }
  return { tag, version, commit: tagCommit };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const result = verifyRelease({
      tag: process.env.RELEASE_TAG,
      ref: process.env.GITHUB_REF,
      runGit: (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim(),
      readVersion: path => JSON.parse(readFileSync(path, 'utf8')).version,
    });
    console.log(`Verified ${result.tag} at ${result.commit} on main.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
