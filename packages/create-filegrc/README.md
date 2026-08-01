# create-filegrc

Create a Git-native filegrc workspace for a SOC 2 program. Use a dedicated private repository so browser-generated compliance commits stay separate from application development history.

```sh
npx create-filegrc@latest company-grc
cd company-grc
npm run validate
npm run serve
```

Setup asks for the legal organization name, the initial policy owner and their email, a security reporting address, and the program timezone. The generated private project includes a starter Security program, Program Readiness, a policy-driven Work Queue, Policy Events that add linked tasks, later audit preparation, evidence packets, and one dependency: `filegrc`.

Creation has two layers. The five-record foundation contains workspace settings, the initial owner, the oversight team, renderer settings, and the filegrc system of record. The default `security` starter adds the framework references, proposed policies, controls, obligations, documents, and training records. Pass `--starter foundation` when you want to stop before selecting a framework.

For one noninteractive run, pass company and service fields together or use `--config setup.json`. The optional `setup` object defines the service boundary and management goal after installation. Use `--filegrc-package <directory>` to exercise unpublished local engine changes instead of installing the registry release. This writes a machine-local `file:` dependency, so replace it with a released version before sharing the generated workspace.

```json
{
  "companyName": "Example Company",
  "policyOwnerName": "Security Owner",
  "policyOwnerEmail": "owner@example.com",
  "securityContactEmail": "security@example.com",
  "timezone": "America/Chicago",
  "starter": "security",
  "setup": {
    "serviceName": "Example Service",
    "boundary": "The production service and supporting infrastructure.",
    "criticality": "high",
    "dataClassification": "Confidential",
    "internetExposed": true,
    "programGoal": "type-2"
  }
}
```

```sh
npx create-filegrc@latest company-grc --config setup.json
```

Generated workspaces also include layered `AGENTS.md` instructions and model-driven headless commands. `filegrc program-path` gives agents the same six steps, exact page guidance, current status, and next actions shown in the renderer. Agents can define program scope, approve policies, implement controls, test External Evidence, complete policy work, trigger event tasks, and prepare later audit packets through the same domain functions used by the renderer.

Git is initialized on `main` when needed. New workspaces use trunk mode with `main` and `origin`. Browser editing becomes available after that branch has an upstream; each save fast-forwards, validates, commits, and pushes automatically. Existing parent repositories are supported and never receive a nested Git repository.

Creation output reports the resolved filegrc version, program timezone, starter record counts, whether installation ran, and whether the target joined an existing Git worktree or received a new repository.

Use `npx create-filegrc@latest --help` for noninteractive options.
