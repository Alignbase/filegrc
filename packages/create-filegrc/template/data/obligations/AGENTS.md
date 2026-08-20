# Obligation Instructions

An obligation is a reusable policy schedule or event template. It is not the record that proves one occurrence happened.

- Calendar obligations need a valid recurrence anchor, owners, expected completion types, and policy or control links.
- Event obligations need a stable lowercase `eventType`, a prompt, owners, expected completion types, and an explicit deadline window.
- Keep completed occurrences in `completionResourceIds`. Do not replace prior links when a new period starts.
- Configure and enable Obligations during Step 3. An enabled Obligation remains dormant until every governing Policy and required program Document is active and effective and, when it names Controls, at least one linked Control is implemented. FileGRC starts calendar work from the latest Policy or governed Document effective date, so pre-cutover periods do not become overdue work.
- Calendar Obligations generated with `status: proposed` contain suggested starting cadences. Review the scope and risk, edit the cadence when needed, and change the Obligation to `active` only when management accepts that schedule. A proposed Obligation never counts as a configured schedule.
- When an approved cadence changes, update the policy, control, and obligation together.
- Pause or retire a template only when the underlying policy work no longer applies. Do not delete historical templates that explain prior periods.

Use `npx filegrc obligations --json` to inspect calculated recurring work and preview every Policy Event task, owner, deadline, and requested proof. Run `npx filegrc complete OBLIGATION_ID --scaffold --window-start YYYY-MM-DD --completed-on YYYY-MM-DD > completion-mutation.json`, fill the actual work and proof, then pass that file to `npx filegrc complete OBLIGATION_ID completion-mutation.json`. The scaffold includes the current Obligation revision, and the final command creates and links the dated occurrence in one validated write. Use `npx filegrc trigger EVENT_TYPE ...` only after the matching event occurs; it adds all configured Action Items to the Work Queue atomically.
