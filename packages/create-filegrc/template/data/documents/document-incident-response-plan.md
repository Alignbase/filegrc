# Incident Response Plan

## Purpose

This plan defines how {{company_name}} identifies, declares, contains, investigates, communicates, recovers from, and learns from security incidents.

## Scope

This plan applies to suspected or confirmed events affecting company or customer systems, data, identities, devices, facilities, vendors, or business operations. Availability disruptions may also activate the Business Continuity and Disaster Recovery Plan.

Questions and incident reports should be sent immediately to {{security_contact_email}}. If that route is unavailable or may be compromised, contact {{policy_owner_name}} through a known alternate channel.

## Definitions

A **security event** is an observable occurrence that may affect the confidentiality, integrity, or availability of systems or information.

A **security incident** is a security event that requires coordinated investigation, containment, recovery, or communication.

A **material incident** is an incident that:

- Causes or is reasonably likely to cause significant harm to customers, workers, operations, systems, or data
- Causes a significant failure to meet a service commitment or system requirement
- Results from a material control failure
- Requires notice to a customer, regulator, insurer, or another outside party
- Is designated material by the incident lead or executive sponsor based on the known facts

Critical and High incidents are material unless the incident lead records why they are not. A lower-severity incident may still be material.

## Severity

The incident lead assigns an initial severity during triage and updates it as facts change.

| Severity | General criteria | Response posture |
| --- | --- | --- |
| Critical | Active or widespread compromise, severe customer or operational harm, major Restricted-data exposure, or an urgent external-notification duty | Immediate executive and technical coordination with continuous ownership until contained |
| High | Confirmed unauthorized access, material production or security-control impact, significant Confidential-data exposure, or likely material incident | Immediate coordinated response and frequent leadership updates |
| Medium | Confirmed incident with limited scope or impact that can be contained through normal response procedures | Assigned incident lead, documented response, and escalation if impact grows |
| Low | Security event requiring investigation or corrective work with little realized impact | Assigned owner, documented resolution, and trend review where useful |

Severity considers affected data, systems, customers, privileges, duration, spread, exploitability, business impact, and notification duties. Every severity change records the reason and time.

## Roles and authority

### Reporter

Anyone may report a suspected incident. Reporters preserve available evidence, stop unsafe activity when they can do so safely, and follow response instructions. They do not need proof before reporting.

### Incident lead

The incident lead declares the incident, assigns severity, coordinates work, maintains the incident record, approves status changes, and decides when the incident is contained and closed. {{policy_owner_name}} acts as incident lead until another qualified person is assigned.

### Technical responders

Technical responders investigate, contain, preserve evidence, remove the cause, restore service, and validate affected systems under the incident lead's direction.

### System and process owners

Owners explain business impact, dependencies, data, customer commitments, and recovery needs. They approve restored operation and remaining risk within their authority.

### Executive sponsor

The executive sponsor makes decisions beyond the incident lead's authority, accepts material residual risk, and approves material external communications.

### Legal, privacy, insurance, and communications owners

The responsible owners assess notification duties, preserve privilege where applicable, coordinate required third parties, and approve communications within their authority.

## Reporting and declaration

Report suspected phishing, malware, unauthorized access, credential exposure, data loss, unintended disclosure, security-control failure, or other security harm immediately.

The incident lead records:

- The report, detection time, and known occurrence time
- Affected systems, identities, data, customers, locations, and vendors
- Initial impact, severity, and materiality decision
- Response participants and assigned owners
- Evidence sources and preservation actions
- Decisions, actions, communications, and timestamps
- Required notifications and their owners and deadlines
- Recovery status, remaining risk, and follow-up work

An event becomes an incident when the incident lead determines that coordinated response is needed. Uncertainty is not a reason to delay containment or escalation.

## Response

The incident lead coordinates these activities in the order appropriate to the incident:

1. Validate the report and assign an initial severity.
2. Protect people and contain continuing harm.
3. Preserve evidence and establish a reliable incident timeline.
4. Identify affected systems, data, identities, customers, and dependencies.
5. Remove the cause and close the path used by the incident.
6. Recover systems and data through approved procedures.
7. Validate security, integrity, monitoring, and expected operation.
8. Complete required internal and external communications.
9. Monitor for recurrence.
10. Close the incident after owners accept the restored state and remaining risk.

Responders may take emergency action needed to contain harm. Emergency changes must be recorded and reviewed through the normal change process after service is stable.

## Evidence and investigation

Responders preserve relevant messages, logs, alerts, files, system images, access records, configuration, and communications. Evidence records identify the collector, source, collection time, affected system, handling method, and integrity information available from the source.

Access to incident evidence is limited to people with a response, legal, privacy, insurance, or audit need. Do not put credentials, active session material, regulated personal data, or confidential third-party reports in this repository unless its access and retention rules permit them.

## Communications and notification

Only authorized people communicate externally on behalf of {{company_name}}. The incident lead coordinates internal updates so responders, owners, and leadership receive the facts and decisions they need.

For each potential external notice, the responsible owner records:

- The triggering law, contract, policy, or commitment
- The affected audience and known facts
- The decision-maker and communication owner
- The deadline and the event that started the deadline
- The decision, approval, delivery time, and retained evidence

Communications distinguish confirmed facts from estimates, avoid unsupported claims, and preserve confidentiality.

## Recovery and closure

Recovery follows approved system objectives and the Business Continuity and Disaster Recovery Plan when coordinated continuity work is needed. Systems do not return to service until the incident lead and system owner accept their security, integrity, monitoring, and remaining risk.

Closure requires a final severity and materiality decision, an incident summary, disposition of notification duties, linked evidence, and assigned follow-up work.

## Review and exercises

Material incidents receive a root-cause and lessons review within one week. The review records contributing conditions, control failures, recovery results, communications, corrective actions, owners, and due dates.

{{company_name}} tests this plan at least annually. Exercises cover declaration, roles, escalation, evidence, communications, recovery coordination, and lessons.

The policy owner reviews this plan at least annually and after a material incident or material change to systems, risks, contacts, or notification duties. Git history records approvals and changes.
