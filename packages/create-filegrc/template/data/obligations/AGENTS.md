# Obligation Instructions

An obligation is a reusable policy schedule or event template. It is not the record that proves one occurrence happened.

- Calendar obligations need a valid recurrence anchor, owners, expected completion types, and policy or control links.
- Event obligations need a stable lowercase `eventType`, a prompt, owners, expected completion types, and an explicit deadline window.
- Keep completed occurrences in `completionResourceIds`. Do not replace prior links when a new period starts.
- Keep starter obligations as proposals until every governing policy is active and effective and, when the obligation names controls, at least one linked control is implemented.
- When an approved cadence changes, update the policy, control, and obligation together.
- Pause or retire a template only when the underlying policy work no longer applies. Do not delete historical templates that explain prior periods.

Use `npx filegrc obligations --json` to inspect calculated recurring work and preview every Policy Event task, owner, deadline, and requested proof. Run `npx filegrc complete OBLIGATION_ID --scaffold --window-start YYYY-MM-DD --completed-on YYYY-MM-DD > completion-mutation.json`, fill the actual work and proof, then pass that file to `npx filegrc complete OBLIGATION_ID completion-mutation.json`. The scaffold includes the current Obligation revision, and the final command creates and links the dated occurrence in one validated write. Use `npx filegrc trigger EVENT_TYPE ...` only after the matching event occurs; it adds all configured Action Items to the Work Queue atomically.
