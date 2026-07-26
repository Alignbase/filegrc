# FileGRC

FileGRC is a zero-dependency Node.js engine for Git-native GRC workspaces. It validates plain-file records, renders a local web app, provides safe CRUD operations, and builds a read-only audit view.

Most users should create a complete workspace:

```sh
npx create-filegrc@latest company-grc
```

Inside a workspace:

```sh
npx filegrc validate
npx filegrc serve
npx filegrc build
npx filegrc describe risk
npx filegrc search "access review"
```

The package requires Node.js 20 or newer. It uses Git for authors, commit timestamps, messages, diffs, and revisions. It never creates commits automatically.

The editable server has no authentication and binds to loopback by default. Put it behind trusted authentication before exposing it on a network, or publish the read-only static build.

The authoritative data model ships in this package. Import the public Node.js API from `filegrc` and the model loader from `filegrc/model`.
