# Policy Instructions

Policies state required behavior. Controls, obligations, training, attestations, and evidence show how the organization applies that behavior.

Use the `content` Markdown slot for the policy text. Keep ownership and approval metadata in JSON. The approver must be separate from the owner, including through team membership, and must not operate the controls they review.

Keep a policy `draft` until its text, owner, scope, related requirements and controls, approval, effective date, review cadence, and acknowledgement requirement match actual practice. When activating it:

1. Record the real approver and approval date.
2. Set the effective date.
3. Link the controls and requirements it supports.
4. Update or create its recurring and event obligations.
5. Assign training or attestations when the policy requires them.

The independent policy approver is a management reviewer, not the CPA auditor. Appoint the reviewer during policy adoption. Recurring and event obligations linked to the policy remain proposals until the policy is active and its effective date has arrived.

For a material revision, preserve Git history, obtain a new approval, and require a new acknowledgement when the audience’s responsibilities changed. Do not reuse the audit firm as a management approver without confirming independence.
