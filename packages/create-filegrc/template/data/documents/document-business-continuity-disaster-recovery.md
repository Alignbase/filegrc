# Business Continuity and Disaster Recovery Plan

## Purpose

This plan describes how {{company_name}} will respond to a disruption, continue its most important work, recover systems and data, and return to normal operations.

## Scope

This plan applies to the people, systems, facilities, vendors, and business processes needed to deliver {{company_name}} products and services. It covers events that materially affect availability, including:

- Cloud or hosting failures
- Software defects and failed deployments
- Cybersecurity incidents
- Loss of data or access to data
- Utility, network, or workplace outages
- Unavailability of a key vendor or workforce member
- Natural disasters and other regional events

Security incidents follow the incident response requirements in the Information Security Policy. A single event may activate both processes.

## Objectives

During a disruption, {{company_name}} will:

1. Protect people.
2. Limit harm to customers, systems, and data.
3. Maintain or restore critical work within approved recovery targets.
4. Communicate accurate information to affected parties.
5. Preserve evidence needed for investigation and review.
6. Record lessons and assign follow-up work.

## Roles

### Policy owner

The current Policy Owner owns this plan and keeps it current. The Policy Owner may delegate response duties but remains accountable for the plan.

### Security and risk oversight

The security and risk oversight group reviews the plan, material disruptions, annual exercise results, and unresolved continuity risks. Its review is recorded in formal meeting minutes.

### Incident lead

The incident lead coordinates the response, assigns work, maintains the incident record, approves status changes, and decides when normal operations have resumed. The policy owner acts as incident lead until another qualified person is assigned.

### Executive sponsor

The executive sponsor makes business-priority decisions that exceed the incident lead's authority and approves material external communications.

### Technical recovery lead

The technical recovery lead coordinates system restoration, data recovery, technical validation, and vendor escalation.

### System and process owners

Owners assess impact, recover their systems or processes, validate restored service, and keep recovery instructions current.

### Continuity team

The continuity team carries out assigned business, technical, customer, vendor, and communications tasks. Membership may change with the event.

### Workforce members

Employees and contractors must report suspected disruptions promptly, follow response instructions, and avoid uncoordinated changes that could make recovery harder.

## Activation

Anyone may report a disruption to {{security_contact_email}}. The policy owner or incident lead activates this plan when normal operating procedures cannot restore an important service within its expected time or when coordinated business action is needed.

The incident lead records:

- What happened and when it was detected
- Affected services, data, customers, locations, and vendors
- Current business and security impact
- Response owner and participants
- Decisions, actions, communications, and timestamps
- Recovery status and remaining risks

## Recovery priorities and objectives

System and process owners define recovery objectives from business impact rather than assigning a universal target to a severity label. Each important system or process records:

- Its business priority and maximum tolerable downtime
- Its recovery time objective
- Its recovery point objective
- The people, systems, vendors, facilities, and data it depends on
- Minimum staffing, access, and communications needed for recovery
- Available manual workarounds or alternate services
- The owner responsible for validating recovery

The incident lead normally restores Critical work before High, Medium, and Low work. The incident lead may change that order to protect people, contain security harm, preserve data integrity, meet a legal or contractual deadline, or unblock another recovery.

The approved objective recorded for each affected system or process is the recovery target. If no approved objective exists, the incident lead sets and records an interim target based on business impact and dependencies. The owner must formalize the missing objective as follow-up work.

Recovery timing starts when the disruption began when that time is known. If it is not known, the incident record uses the earliest confirmed time and states that limitation.

## Response and recovery

The incident lead coordinates these steps in the order appropriate to the event:

1. Confirm the event and protect people.
2. Identify affected systems, data, processes, and dependencies.
3. Contain the cause and prevent additional harm.
4. Activate manual procedures, alternate services, or remote work when available.
5. Recover systems and data in priority order.
6. Validate security, integrity, and expected operation before resuming normal use.
7. Communicate status to affected parties.
8. Monitor the recovered service for recurrence.
9. Close the event after owners accept the restored state and remaining risk.

Responders must record material decisions and actions as they occur. Emergency changes must be reviewed through the normal change process after service is stable.

## Communication

The incident lead chooses the audience, channel, and frequency based on impact.

Internal updates should state what is known, what remains uncertain, who is responsible, and when the next update is expected. Only authorized people may communicate externally on behalf of {{company_name}}.

When customers are affected, the incident lead identifies the applicable contractual commitments, legal duties, and approved communications plan, then records the audience, owner, and deadline for the initial update. When no fixed deadline applies, {{company_name}} communicates promptly after confirming enough facts to provide an accurate and useful update.

Customer, regulator, insurer, or law-enforcement notifications must be reviewed by the people responsible for legal, contractual, privacy, and communications obligations. Notifications must meet applicable deadlines and avoid unsupported claims.

Employees receive the disruption status, work instructions, available recovery estimate, and next expected update through one or more approved channels. The continuity team keeps an alternate contact method for use when ordinary company communications are unavailable.

Owners of affected vendor relationships contact the vendor through the fastest available approved channel, coordinate restoration steps, and record material commitments and updates.

## Data backup and restoration

Owners of systems that store important data must:

- Define backup scope and frequency that meet the system recovery point objective.
- Protect backups from unauthorized access and changes.
- Keep recovery access separate from ordinary user access where practical.
- Monitor backup jobs and address failures.
- Test restoration at least annually.
- Record the test date, scope, result, evidence, and follow-up work.

A successful backup job is not proof of recoverability. Restore tests must confirm that data can be retrieved and used.

During recovery, people take priority over data or equipment. When it is safe to proceed, authorized responders assess the integrity and usability of available electronic and paper records. They may restore approved backups, use intact replicas, rebuild from reviewed configuration or source, use an approved alternate service, or recover other safeguarded copies. The restored environment must receive the same backup and security protections required for normal operation.

## Specific disruption procedures

### Hosted service or vendor outage

The owner confirms vendor status, opens a support case when appropriate, assesses alternate service options, and tracks contractual notification and recovery commitments.

### Failed deployment or software defect

The owner stops further deployment, rolls back or applies an approved corrective change, validates data integrity, and monitors the restored version.

### Loss of workplace access

Workers use approved remote-work procedures or an approved alternate location. The incident lead confirms access to required systems, contact methods, and records.

### Loss of a key workforce member

The responsible manager reassigns urgent duties, obtains access through approved recovery procedures, and records any missing documentation or concentration risk as follow-up work.

### Cybersecurity event

Responders protect evidence and coordinate containment with recovery. Systems must not return to service until the incident lead and system owner accept the security risk.

## Plan access

The current plan is stored in this repository. The policy owner must ensure that people who may lead recovery can access an approved copy when the primary systems or identity provider are unavailable. Emergency contacts and access instructions must be stored in an approved protected location and must not be committed to this repository if they contain secrets.

The policy owner reviews the emergency contact list at least annually and after a material personnel or vendor change.

Employees receive this plan after approval and after a material update. Suppliers, customers, and other parties receive the parts needed to coordinate recovery when appropriate.

## Exercises and maintenance

{{company_name}} tests this plan at least annually and after a material change when the existing test no longer represents the environment. An exercise may be a tabletop scenario, technical recovery test, communication test, or combined exercise.

Each exercise records:

- Scenario and scope
- Participants and roles
- Systems and processes tested
- Recovery objectives evaluated
- Expected and actual results
- Evidence
- Findings, owners, and due dates

The security and risk oversight group reviews the annual exercise and records its conclusions in meeting minutes.

After this plan is activated for a real disruption, the incident lead completes a root-cause and lessons review within one week. The review identifies follow-up work, owners, and due dates.

The policy owner reviews this plan at least annually and after a major disruption. Git history records approvals and changes.
