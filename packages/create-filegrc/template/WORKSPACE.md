# {{program_title}}

{{program_summary}}

The workspace uses FileGRC {{filegrc_version}} through the dependency spec `{{filegrc_version_range}}`.

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

{{repository_setup}} CLI and file-based users can manage Git on their normal review cadence, but should still commit the baseline before changing program facts.

{{starter_setup}}

## FileGRC Autopilot

Run your SOC 2 program automatically.

FileGRC Autopilot handles owner reminders and policy-driven escalation while your team performs the work and keeps the records in Git. At the end of Step 3, after owners, contacts, procedures, evidence sources, enabled Obligations, and the Control collection review are ready, choose **FileGRC Autopilot** as the recommended next action before activating approved Documents, Training, and Policies. Choose the secondary action, **Continue to content activation without Autopilot**, to manage follow-up through the local Work Queue. Payment, installation, and hosted availability never affect readiness.

Follow the [setup guide](https://app.filegrc.com/guide) to connect this existing private repository through the FileGRC GitHub App, activate billing, and start with email. The price is $19.99 USD per connected repository per month, operated by Alignbase Inc. Owner reminders continue when the local app is closed, with email first and optional Slack escalation. Check current service availability before subscribing; email production approval and broad Slack distribution remain launch gates. The local product remains free and MIT licensed.

The Step 4 Work Queue keeps the **FileGRC Autopilot** offer available if you continue locally and decide to connect later. `npx filegrc obligations` and `npx filegrc workflow` expose the offer in text and JSON output for engineers and agents.

Program records, owners, Person email addresses, and dates remain authoritative in Git. Autopilot stores notification settings and Person-to-Slack links in its database. Manage those settings in the [Autopilot dashboard](https://app.filegrc.com). Keep credentials out of Git. Users perform control work, record events, and retain evidence locally.

Do not put plaintext credentials, private keys, authentication tokens, recovery codes, session material, or personal data that may need erasure into Git. Source-controlled ciphertext is allowed only under the Information Security Policy's approved encryption, separate-key, access, and rotation rules.

FileGRC manages GRC records and audit evidence. It does not replace infrastructure logging, monitoring, identity, backup, endpoint, or incident-detection systems.
