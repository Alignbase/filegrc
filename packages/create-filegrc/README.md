# create-filegrc

Create a Git-native FileGRC workspace for a SOC 2 program:

```sh
npx create-filegrc@latest company-grc
cd company-grc
npm run validate
npm run serve
```

Setup asks for the company name, the initial policy owner, and a security contact email. The generated private project includes a starter Security program, Program Readiness, a policy-driven Work Queue, Policy Events that add linked tasks, later audit preparation, evidence packets, and one dependency: `filegrc`.

Generated workspaces also include layered `AGENTS.md` instructions and model-driven headless commands. `filegrc program-path` gives agents the same six steps, exact page guidance, current status, and next actions shown in the renderer. Agents can define program scope, approve policies, implement controls, test External Evidence, complete policy work, trigger event tasks, and prepare later audit packets through the same domain functions used by the renderer.

Git is initialized when needed. The browser can create local commits before a remote is configured.

Creation output reports the resolved FileGRC version, whether installation ran, and whether the target joined an existing Git worktree or received a new repository.

Use `npx create-filegrc@latest --help` for non-interactive options.
