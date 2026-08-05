# {{program_title}}

{{program_summary}}

The workspace uses filegrc {{filegrc_version}} through the dependency spec `{{filegrc_version_range}}`.

## Work locally

You need Node.js 20 or newer and Git.

```sh
npm install
npm run validate
npm run serve
```

The editable server binds to loopback by default and has no authentication. Do not expose it to an untrusted network.

Agents and terminal users can inspect the workspace without the browser:

```sh
npx filegrc guide --json
npx filegrc program-path --next --json
npx filegrc obligations --json
npx filegrc validate --json
```

Read `AGENTS.md` and `data/AGENTS.md` before broad changes.

## Establish the Git baseline

Review the generated proposals and make an initial commit before recording setup decisions. This gives later changes a clear baseline and prevents first-run files from looking like real-world policy events.

If this is a dedicated repository:

```sh
git add .
git commit -m "Initialize FileGRC program"
```

The editable browser uses `main` and pushes saved changes to `origin`. Connect this repository to a dedicated private remote and push `main` before using browser writes. CLI and file-based users can manage Git on their normal review cadence, but should still commit the baseline before changing program facts.

{{starter_setup}}

filegrc manages GRC records and audit evidence. It does not replace infrastructure logging, monitoring, identity, backup, endpoint, or incident-detection systems.
