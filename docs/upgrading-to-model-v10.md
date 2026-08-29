# Upgrading to model v10

Model v10 replaces separate primary and alternate Reporting Route records with one Reporting Channel Set per Program and stable purpose. A reporting channel is an email address, phone number, web form, in-person contact, or other destination people use to raise a concern. The set keeps the normal channel and its fallback together. It keeps model v9 Obligation rules, rolled-up occurrences, and temporal Collection Reviews unchanged.

Preview and apply one model step at a time:

```sh
npx filegrc migrate --to-model 10 --preview --json
npx filegrc migrate --to-model 10 --yes --json
```

The migration keeps committed model v9 Reporting Routes and their legacy Attestation bindings unchanged so Git and the current files continue to explain prior delivery facts. It marks only unfinished planned routes as deprecated drafts. Existing active and retired routes remain legacy records; they do not satisfy a model v10 Reporting Channel Set requirement. Future delivery proof must bind a committed Route Set revision.

The migration does not infer a Program, purpose pairing, approval Appointment, ongoing authority kind, actual approval time, timezone, or evidence conclusion. Review those facts and create the current Route Set through the normal workflow:

```sh
npx filegrc reporting-route-sets --json
npx filegrc scaffold reporting-route-set --title "Security reporting channels"
npx filegrc create route-set-mutation.json --json
npx filegrc reporting-route-set propose REPORTING_ROUTE_SET_ID --json
git add data/reporting-route-sets
git commit -m "Propose security reporting routes"
npx filegrc reporting-route-set scaffold approve --id REPORTING_ROUTE_SET_ID > approval.json
# Fill the current revisions, exact times, Appointment, and verified fixed Evidence IDs.
npx filegrc reporting-route-set approve approval.json --json
git add data/reporting-route-sets
git commit -m "Approve security reporting routes"
```

For a stopped channel set, generate a cancellation payload with `reporting-route-set scaffold cancel --id REPORTING_ROUTE_SET_ID`. When a new revision replaces an approved set, use `reporting-route-set scaffold successor --id SUCCESSOR_ROUTE_SET_ID`. The successor payload records its approval and the predecessor cancellation together, with separate Evidence and current revisions for both records. Inspect the current records with `get --workflow --json` and replace every scaffold prompt before running the managed action.

Browser saves perform the same managed actions. In the default trunk mode, the browser creates and pushes each focused proposal or approval commit. A local development override writes files without committing, so approval remains unavailable until the proposal is committed through Git.

Policies, Documents, Commitments, and Risk decisions can state structured route requirements. Concurrent requirements combine: an alternate lane, distinct channel, or independent dependency rule applies when any effective source requires it. Route destinations and current Appointment holders stay in the Route Set and Appointment records, not in policy prose.

Evidence packets include effective Route Set snapshots, sources, lineage, approval and cancellation facts, authority Appointments, Exceptions, commit IDs, and file history. Git-recording timing states only whether the event first appeared in authoritative Git history within one day of its stated time or later. It is not a trusted timestamp. Management and the engagement team still decide whether the evidence is sufficient and appropriate.
