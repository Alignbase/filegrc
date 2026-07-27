# Action Item Instructions

An action item must point to the record that created the work. Keep the assignee, due date or policy window, blockers, completion records, and evidence explicit.

For an event-generated action, do not weaken or extend its policy deadline by hand. Create the requested completion resource and close the action atomically:

```sh
npx filegrc complete-action ACTION_ITEM_ID completion-mutation.json --completed-on YYYY-MM-DD
```

FileGRC rejects the wrong completion type. Mark ordinary action items `done` only after the work occurred and the completion record or evidence is linked. Use `blocked` while a named dependency prevents work, and link that dependency with `blockingResourceIds`.
