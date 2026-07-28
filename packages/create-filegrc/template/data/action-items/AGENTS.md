# Action Item Instructions

Create an Action Item only when follow-up needs its own assignee, deadline, and completion proof. Keep simpler remediation on the Finding or other source record. Set `sourceResourceId` to the record that created the work; filegrc derives the backlink and adds every open Action Item to Work Queue. Keep the assignee, due date or policy window, blockers, completion records, and evidence explicit.

For an event-generated action, do not weaken or extend its policy deadline by hand. Create the requested completion resource and close the action atomically:

```sh
npx filegrc complete-action ACTION_ITEM_ID completion-mutation.json --completed-on YYYY-MM-DD
```

filegrc rejects the wrong completion type. Mark ordinary Action Items `done` only after the work occurred, set `completedOn`, and link the completion record or evidence. Use `blocked` while a named dependency prevents work, and link that dependency with `blockingResourceIds`.
