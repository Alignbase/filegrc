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
npx filegrc program-path --json
npx filegrc obligations --json
npx filegrc validate --json
```

Read `AGENTS.md` and `data/AGENTS.md` before broad changes.

{{starter_setup}}

filegrc manages GRC records and audit evidence. It does not replace infrastructure logging, monitoring, identity, backup, endpoint, or incident-detection systems.
