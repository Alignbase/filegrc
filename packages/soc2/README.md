# soc2

`soc2` is a zero-dependency Node.js engine for Git-native GRC workspaces. It validates plain-file records, renders a local web app, provides safe CRUD operations, and builds a read-only audit view.

Most users should create a complete workspace:

```sh
npx create-soc2@latest company-soc2
```

Inside a workspace:

```sh
npx soc2 validate
npx soc2 serve
npx soc2 build
npx soc2 describe risk
npx soc2 search "access review"
```

The package requires Node.js 20 or newer. It uses Git for authors, commit timestamps, messages, diffs, and revisions. It never creates commits automatically.

The editable server has no authentication and binds to loopback by default. Put it behind trusted authentication before exposing it on a network, or publish the read-only static build.

The authoritative data model ships in this package. Import the public Node.js API from `soc2` and the model loader from `soc2/model`.
