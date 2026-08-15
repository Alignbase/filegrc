# Upgrade to data model v4

Model v4 separates repository identity, assurance Programs, bounded Systems, operational Components, provider relationships, Assets, and Evidence Artifacts. The migration is explicit because a v3 System may represent either a complete service boundary or one technical or external building block.

## Preview first

Run the preview from the workspace root:

```sh
npx filegrc migrate --to-model 4 --preview --json
```

The preview does not write files. It reports every proposed file creation, update, type and path change, and Markdown move. Each item is classified as:

- `automatic`, when the v3 facts determine the v4 result without a management decision.
- `review-required`, when FileGRC can preserve the source fact but management must confirm the new boundary, role, rationale, information use, or applicability context.
- `unsupported`, when applying would require FileGRC to invent a fact. The migration cannot run while any unsupported item remains.

## Classify ambiguous v3 Systems

Create a decisions file when the preview cannot determine whether a v3 System is a bounded System or a Component:

```json
{
  "systemDecisions": {
    "system-customer-service": {
      "kind": "system"
    },
    "system-production-database": {
      "kind": "component",
      "systemUses": [
        {
          "systemId": "system-customer-service",
          "roles": ["service-delivery", "control-support", "evidence-source"],
          "rationale": "Stores production service data and produces the access and backup records used by the selected Controls."
        }
      ]
    }
  }
}
```

Pass the completed file to both preview and apply:

```sh
npx filegrc migrate --to-model 4 --decisions v4-decisions.json --preview --json
npx filegrc migrate --to-model 4 --decisions v4-decisions.json --yes --json
```

Use `kind: "system"` only for the complete bounded service or product management governs or the CPA firm will examine. Use `kind: "component"` for applications, infrastructure, platforms, repositories, external services, evidence sources, interconnections, and other material building blocks. Every Component use needs a bounded System, one or more controlled roles, and a concrete rationale.

## What the migration changes

The migration creates one Program from v3 Workspace assurance facts. Workspace keeps organization and repository settings. Requirement applicability moves from catalog Requirements to `program.requirementApplicability`, so different Programs can reach different reviewed decisions without changing shared criterion text.

The migration also:

- keeps classified root services as bounded Systems and converts classified building blocks to Components;
- moves converted System Markdown from `data/systems/` to `data/components/`;
- replaces Control evidence-source System links with `evidenceSourceComponentIds` and preserves bounded `systemIds` separately;
- rewrites source relationships on Evidence Artifacts, populations, access records, source coverage, collection reviews, and operating records;
- removes provider capability, subprocessoring, and backup-provider facts from Vendor records, retaining legacy source facts under `extensions` when no safe v4 destination exists;
- creates first-class Classification and Information Type records from the v3 Workspace definitions and free-text data categories;
- adds `programId` and component-specific subservice treatments to Audits where the source facts support them.

The migration never infers an approval, reviewer, date, audit treatment, bounded System, Component relationship, or evidence conclusion when the v3 files do not establish it.

## Review after applying

Inspect the complete Git diff before committing. Confirm:

1. Every Program selects the intended bounded Systems, Frameworks, Requirements, and Controls.
2. Every bounded System states its purpose, services, boundary, exclusions, information scope, owners, and continuity objectives.
3. Every Component exists for a material reason and has the correct System roles and rationale. A Vendor may have no Component, one Component, or several Components.
4. Control `componentIds` describe where the activity operates, while `evidenceSourceComponentIds` describe where authoritative Evidence comes from.
5. Assets point to Components, and Evidence Artifacts and audit populations name their actual source Components.
6. Classifications and Information Types preserve the source meaning without duplicates.
7. Audit subservice treatments are engagement-specific and identify the exact supplied Components covered by each treatment.

Then run:

```sh
npm run validate
npx filegrc program-readiness --json
npx filegrc workflow --json
```

Commit the migration and reviewed corrections together only after the workspace validates and the diff matches management’s intended scope.
