# Policy Event Instructions

Do not create an `obligation-event` or its Action Items by hand. Preview the configured Policy Event, then trigger its work:

```sh
npx filegrc obligations --json
npx filegrc trigger EVENT_TYPE --occurred-on YYYY-MM-DD --subject RESOURCE_ID --json
```

The obligations output lists every task the trigger will add, with its owner, deadline, and requested proof. Use `--occurred-at` with an RFC 3339 timestamp when any action has an hour-based deadline. The trigger creates the event and adds all Action Items to the Work Queue atomically, then reports the event, task count, task IDs, and deadlines.

Complete each action with the requested resource type and proof. Then close the workflow:

```sh
npx filegrc complete-event OBLIGATION_EVENT_ID --completed-on YYYY-MM-DD --expected-revision REVISION
```

Read `REVISION` from `npx filegrc get OBLIGATION_EVENT_ID --mutation`. filegrc refuses to close an event with unfinished or unproved actions. Cancel an event only when the triggering event itself was entered in error or did not occur; explain the reason in related records or the commit message.
