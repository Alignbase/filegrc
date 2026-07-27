# Obligation Instructions

An obligation is a reusable policy schedule or event template. It is not the record that proves one occurrence happened.

- Calendar obligations need a valid recurrence anchor, owners, expected completion types, and policy or control links.
- Event obligations need a stable lowercase `eventType`, a prompt, owners, expected completion types, and an explicit deadline window.
- Keep completed occurrences in `completionResourceIds`. Do not replace prior links when a new period starts.
- When an approved cadence changes, update the policy, control, and obligation together.
- Pause or retire a template only when the underlying policy work no longer applies. Do not delete historical templates that explain prior periods.

Use `npx filegrc obligations --json` to inspect calculated work. Use `npx filegrc complete OBLIGATION_ID completion-mutation.json` to create and link a dated occurrence in one validated write.
