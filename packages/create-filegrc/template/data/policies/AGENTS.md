# Policy Instructions

A Policy says what the company commits to do by the date it takes effect. Approval means the company accepts those commitments. It does not prove the work is done. Controls and operating records describe how the company meets them and provide the proof.

FileGRC does not infer technical implementation from Policy prose. Put configuration facts in Controls, Components, Systems, governed schedules, and Evidence.

Keep durable mandatory outcomes in Policy prose. Put adjustable values such as retention periods, scan cadence, recovery frequency, and review windows in the linked Control, System, Document schedule, or Obligation. Starter values are proposals: management must confirm or replace each value before it counts as configured.

Use the `content` Markdown slot for the policy text. Keep ownership and approval metadata in JSON. The approver must be separate from the owner, including through team membership. The reviewer will usually be another leader or manager in the organization, but may be external.

Keep a Policy `draft` until its text, owner, scope, related Requirements and Controls, review Obligation, and acknowledgement requirement are ready for independent review. Move it to `approved` when management accepts the exact content revision. Approval does not require every linked Control to be implemented and does not make the Policy effective.

The Security starter contains one consolidated Information Security Policy. Its section headings use common policy-family names so a customer, auditor, or questionnaire reviewer can locate topics such as access control, personnel security, vulnerability management, incident response, continuity, and Vendor risk. Cite the consolidated Policy and exact section when that accurately answers a request. Do not claim that each section is a separate document, that the heading proves implementation, or that FileGRC supplies a certification.

Add another Policy only when management expands the program scope or has a distinct approval audience, owner, or legal requirement.

During Step 3, implement Controls while the governing Policy is approved but inactive. Configure and enable its schedules, which remain dormant. Use the Controls-page cutover or `activate-policies --scaffold` to review the approved Policy. Before selecting it for activation:

1. Review the per-Policy activation assessment.
2. Review linked Controls that are planned or partial, missing Components or evidence sources, missing schedules, and unresolved Exceptions.
3. Confirm required governed plans and schedules have independent Step 2 approval, implement their linked requirements, and activate their exact approved revisions separately in Step 3.
4. Set the real effective date and change the approved Policy to `active` at implementation cutover.
5. If management activates with a known gap, document the decision, follow-up, and any time-bound Exception. Activation does not mark a Control implemented, and Evidence Readiness still requires active and operating Policies.

The independent Policy approver is a management reviewer, not the CPA auditor. Appoint the reviewer during Policy approval. Enabled recurring and event Obligations remain dormant until every governing Policy is active and effective and, when they name Controls, at least one linked Control is implemented.

If a proposed effective date has passed, choose a current or future activation date. Never backdate adoption.

For a material revision, preserve Git history, obtain a new approval, and require a new acknowledgement when the audience’s responsibilities changed. Do not reuse the audit firm as a management approver without confirming independence.

After updating the `filegrc` package, run `npx filegrc policy-library` to review optional starter updates. The command prints exact diffs and skips customized or adopted Policy content. It writes only after you accept the named proposal and exact revision with the printed `--accept`, `--proposal-revision`, and `--yes` command. Acceptance fails if the proposal changed after review. It does not approve the Policy or mark a linked Control implemented.
