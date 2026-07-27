# Policy Event Instructions

Do not create an `obligation-event` or its action items by hand. Start the configured checklist:

```sh
npx filegrc obligations --json
npx filegrc trigger EVENT_TYPE --occurred-on YYYY-MM-DD --subject RESOURCE_ID --json
```

Use `--occurred-at` with an RFC 3339 timestamp when any action has an hour-based deadline. The command creates the event and full action checklist atomically.

Complete each action with the requested resource type and proof. Then close the workflow:

```sh
npx filegrc complete-event OBLIGATION_EVENT_ID --completed-on YYYY-MM-DD
```

FileGRC refuses to close an event with unfinished or unproved actions. Cancel an event only when the triggering event itself was entered in error or did not occur; explain the reason in related records or the commit message.
