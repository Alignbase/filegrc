# Security Incident and Recovery Plan

## Purpose

This plan coordinates reporting, response, recovery, and continuity when a security event or disruption affects {{company_name}} or an in-scope service. Controls, Components, Systems, Obligations, and Evidence hold the actual technical configuration and proof of operation.

## Reporting routes

The primary reporting route is {{security_contact_email}}.

[Complete before activation: Name a usable alternate reporting route, its owner, protected location, and how workers can find it when the primary email, identity, or collaboration System is unavailable, compromised, or involved in the concern. Do not put secrets in this plan.]

Reports may describe suspected unauthorized access, malware, data loss, credential exposure, security-Control failure, service disruption, fraud affecting the service, or another policy violation. The recipient records the report, protects confidentiality, preserves relevant information, and assigns an initial owner.

## Roles and authority

The Policy Owner maintains this plan and ensures that the organization assigns these duties before activation:

- Incident lead with authority to declare, coordinate, escalate, and close an incident
- Technical recovery lead for containment, restoration, validation, and rollback
- System owners for impact assessment, dependencies, and recovery priorities
- Executive decision-maker for major business, customer, insurance, or legal decisions
- Communication owner for workforce, customer, Vendor, and public messages

If an incident raises a legal, privacy, or insurance question, the incident lead gets suitable advice at that time. FileGRC does not require pre-arranged counsel, in-house counsel, or a standing legal retainer.

[Complete before activation: Record the emergency contact arrangement, its owner, alternate communication channel, protected storage location, and review schedule.]

## Assessment and declaration

The incident lead records the affected service, Systems, Components, data, customers, Vendors, known timeline, current impact, likely impact, and available Evidence. Severity and declaration use the approved criteria in the Incident Response Control.

A material incident includes one that causes or is likely to cause significant failure of a service commitment or System requirement, material unauthorized access or disclosure, sustained loss of an important service, or a notification duty requiring leadership review.

## Response

The incident team:

1. Records and assesses the report.
2. Contains the event while preserving Evidence.
3. Removes or isolates the cause.
4. Restores affected service through approved recovery procedures.
5. Validates security and service behavior before normal operation resumes.
6. Coordinates any legal, contractual, privacy, insurance, customer, or regulatory review the incident actually requires.
7. Communicates through authorized primary or alternate channels.
8. Records decisions, Exceptions, remaining risk, lessons, and follow-up work.

The team does not destroy Evidence, promise external notification, or make public statements without the assigned authority. The notification decision records the triggering law, contract, Policy, commitment, or management decision and the facts used.

## Recovery priorities and procedures

[Complete before activation: Link every important System and record its approved recovery time objective, recovery point objective, maximum tolerable downtime, dependencies, owner, and critical customer commitments in the System record.]

For each important System, the applicable Control, Component, System, and Obligation records must identify:

- The backup or alternate recovery approach
- Scope, frequency, retention, monitoring, and failure response
- Recovery and restoration procedure
- People who can access the procedure and required Systems
- Restore-validation method and governed schedule
- Dependencies, fallback paths, and validation steps

[Confirm or replace before activation: The starter proposal for important production data is a daily backup, 30-day retention period, and annual restore validation. Record the approved choice for every important System in its Control, Component, System, Retention Schedule, and Obligation records.]

If no approved objective or procedure exists during an event, the incident lead records an interim decision based on customer impact, data risk, and dependencies, then assigns the missing permanent decision as follow-up work.

## Alternate plan access

[Complete before activation: Record the protected alternate location and access method responders will use when the primary identity, source-control, or collaboration Systems are unavailable. Confirm that authorized responders can retrieve the plan without exposing secrets.]

## Closure and follow-up

The incident lead closes the incident only after affected Systems are stable, security validation is complete, Evidence is preserved, required communication decisions are recorded, and remaining work has owners and deadlines. Material incidents receive a retrospective within the approved event window.

## Exercises and maintenance

Management tests a representative security alert from generation through receipt, acknowledgement, escalation, and fallback on the approved governed schedule. It also exercises incident coordination, alternate plan access, emergency contacts, and recovery of selected important Systems on their approved schedules.

Each exercise records scope, participants, objectives, result, Evidence, Exceptions, findings, and follow-up. The owner reviews this plan after a material incident, failed exercise, important System change, or reporting-path change and on the approved Policy-review schedule.
