import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { ACTIVE_MODEL_VERSION, loadModel, SUPPORTED_MODEL_VERSIONS } from "../model/index.js";
import { buildAgentGuide, findResourceReferences, listResourceTypes, scaffoldResourceMutation } from "./agent.js";
import { assessAuditPreparation, prepareAuditWorkspace } from "./audit-preparation.js";
import { createNextAuditCycle, planNextAuditCycle } from "./audit-transition.js";
import {
  applyApplicabilityReviewWithContext,
  planApplicabilityReview,
  scaffoldApplicabilityReview
} from "./batch-review.js";
import {
  applyCollectionReview,
  planCollectionReview,
  scaffoldCollectionReview
} from "./collection-review.js";
import { buildWorkspace } from "./build.js";
import {
  activateDocuments,
  activateGovernedContent,
  planDocumentActivation,
  planGovernedContentActivation,
  scaffoldDocumentActivation,
  scaffoldGovernedContentActivation
} from "./document-activation.js";
import { generateEvidencePacket, prepareEvidencePacket } from "./evidence-packet.js";
import {
  addEvidenceAttachment,
  createResource,
  deleteResource,
  removeEvidenceAttachment,
  updateResource
} from "./files.js";
import { generateModelDocumentation } from "./model-docs.js";
import { migrateModel, planModelMigration } from "./model-migration.js";
import { normalizeResourceMutation } from "./mutation.js";
import {
  completeObligationAction,
  completeObligationEvent,
  completeObligationOccurrence,
  createObligationEvent,
  planObligations,
  scaffoldObligationCompletion
} from "./obligations.js";
import {
  planExternalReviewerGovernance,
  scaffoldExternalReviewerGovernance,
  setupExternalReviewerGovernance
} from "./external-reviewer.js";
import { relativeToWorkspace, resolveDataPath } from "./paths.js";
import { activatePolicies, planPolicyActivation, scaffoldPolicyActivation } from "./policy-activation.js";
import { applyPolicyLibraryUpgrade, assessPolicyLibraryUpgrades } from "./policy-library.js";
import { buildAgentProgramPath } from "./program-path.js";
import { assessEvidenceMap, assessProgramReadiness } from "./program-readiness.js";
import { resolveProgram } from "./program.js";
import { applyReconciliation, planReconciliation } from "./reconciliation.js";
import { markdownEntries } from "./resource-markdown.js";
import { effectiveResourceStatus } from "./resource-status.js";
import { searchResources } from "./search.js";
import { serveWorkspace } from "./server.js";
import { planWorkspaceSetup, setupWorkspace, summarizeSetupResult } from "./setup.js";
import { printGithubStarMessage } from "./startup.js";
import { createAppState } from "./state.js";
import { currentCalendarDate } from "./time.js";
import { validateWorkspace } from "./validate.js";
import { loadWorkspace } from "./workspace.js";
import {
  assessWorkflow,
  buildWorkflowDelta,
  previewWorkflowMutation,
  workflowForResource
} from "./workflow.js";

const BOOLEAN_FLAGS = new Set([
  "allow-non-authoritative-writes",
  "apply",
  "check-docs",
  "complete",
  "current",
  "draft",
  "help",
  "json",
  "mutation",
  "next",
  "preview",
  "require-ready",
  "require-healthy",
  "scaffold",
  "summary",
  "workflow",
  "write-docs",
  "yes"
]);

export async function runCli(argv = process.argv.slice(2)) {
  const [command = "help", ...args] = argv;
  const { positionals, flags } = parseArgs(args);
  const root = flags.root ?? process.cwd();

  if (["help", "--help", "-h"].includes(command)) return printHelp();
  if (["version", "--version", "-v"].includes(command)) return printVersion();
  if (flags.help || args.includes("-h")) return printCommandHelp(command);

  if (command === "serve") {
    const result = await serveWorkspace(positionals[0] ?? root, {
      host: flags.host ?? process.env.FILEGRC_HOST,
      port: flags.port ?? process.env.FILEGRC_PORT,
      fallbackToAvailablePort: true,
      allowNonAuthoritativeWrites: flags["allow-non-authoritative-writes"] === true
    });
    const stopped = new Promise((resolvePromise) => {
      const stop = () => {
        process.removeListener("SIGINT", stop);
        process.removeListener("SIGTERM", stop);
        result.server.close(resolvePromise);
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    });
    if (result.usedFallbackPort) {
      console.log(`Port ${result.requestedPort} is already in use. Using ${result.address.port} instead.`);
    }
    console.log(`filegrc workspace: ${result.url}`);
    console.log(`Data: ${result.root}/data`);
    printGithubStarMessage();
    return await stopped;
  }
  if (command === "setup") {
    const payload = positionals[0] ? await readSetupPayload(positionals[0]) : {};
    const setupInput = await completeInteractiveSetup(root, {
      ...payload,
      ...(flags["service-name"] !== undefined ? { serviceName: flags["service-name"] } : {}),
      ...(flags.boundary !== undefined ? { boundary: flags.boundary } : {}),
      ...(flags.owner !== undefined ? { ownerId: flags.owner } : {}),
      ...(flags.criticality !== undefined ? { criticality: flags.criticality } : {}),
      ...(flags.classification !== undefined ? { classificationId: flags.classification } : {}),
      ...(flags["internet-exposed"] !== undefined ? { internetExposed: flags["internet-exposed"] } : {}),
      ...(flags["program-goal"] !== undefined ? { programGoal: flags["program-goal"] } : {}),
      ...(flags.draft ? { draft: true } : {})
    });
    const result = flags.preview
      ? await planWorkspaceSetup(root, setupInput)
      : await withWorkflowDelta(root, () => setupWorkspace(root, setupInput));
    const output = flags.summary && !flags.preview ? summarizeSetupResult(result) : result;
    if (flags.json) console.log(JSON.stringify(output, null, 2));
    else if (flags.preview) {
      console.log(`Setup preview: ${result.changes.system} System ${result.system.id}; update the assurance target to ${result.target.assuranceGoal}.`);
      console.log("No controls will be linked and no evidence records will be created.");
    }
    else {
      console.log(`${result.draft ? "Saved draft scope" : "Completed initial setup"} for ${result.system.title}.`);
      console.log(`System: ${result.system.id} (${result.system.status})`);
      if (result.draft) {
        console.log("Planned and in scope means selected for scope review, not approved or active.");
      }
      console.log(`Target: ${(result.program || result.workspace).assuranceGoal}`);
      console.log("Next: finish Step 1 by confirming people, criteria, commitments, bounded Systems, Components, and Vendors. Run npx filegrc program-path --next --json.");
    }
    return output;
  }
  if (command === "build") {
    const result = await buildWorkspace(positionals[0] ?? root, { output: flags.output });
    console.log(`Built read-only site at ${result.output}`);
    return;
  }
  if (command === "validate") {
    const result = await validateWorkspace(positionals[0] ?? root);
    if (flags.json) console.log(JSON.stringify({ ok: result.ok, counts: result.counts, diagnostics: result.diagnostics }, null, 2));
    else printValidation(result);
    if (!result.ok) process.exitCode = 1;
    return result;
  }
  if (command === "model") {
    const model = loadModel();
    const source = generateModelDocumentation(model);
    const path = resolve(String(flags.docs ?? "docs/data-model.md"));
    if (flags["write-docs"]) {
      await writeFile(path, source, "utf8");
      console.log(`Wrote ${path}`);
    } else if (flags["check-docs"]) {
      let existing = "";
      try { existing = await readFile(path, "utf8"); } catch {}
      if (existing !== source) {
        console.error(`${path} is not generated from model v${model.modelVersion}. Run filegrc model --write-docs.`);
        process.exitCode = 1;
      } else console.log(`${path} matches model v${model.modelVersion}.`);
    } else if (flags.json) console.log(JSON.stringify(model, null, 2));
    else console.log(source);
    return;
  }
  if (command === "migrate") {
    const targetModel = String(flags["to-model"] || "");
    if (!SUPPORTED_MODEL_VERSIONS.filter((version) => version !== "1").includes(targetModel)) {
      throw new Error(`Pass --to-model ${SUPPORTED_MODEL_VERSIONS.filter((version) => version !== "1").join(", --to-model ")}.`);
    }
    const migrationDecisions = flags.decisions
      ? JSON.parse(await readFile(resolve(String(flags.decisions)), "utf8"))
      : undefined;
    const options = {
      jobTitle: flags["job-title"],
      startsOn: flags["starts-on"],
      targetModelVersion: targetModel,
      systemDecisions: migrationDecisions?.systemDecisions || (targetModel === "4" ? migrationDecisions : undefined),
      documentScopes: migrationDecisions?.documentScopes || (targetModel === "5" ? migrationDecisions : undefined)
    };
    const plan = await planModelMigration(root, options);
    if (!flags.preview && plan.sourceModelVersion !== plan.targetModelVersion && !flags.yes) {
      throw new Error(`Review migrate --to-model ${targetModel} --preview --json, then pass --yes to apply the migration.`);
    }
    const result = flags.preview
      ? plan
      : plan.sourceModelVersion !== plan.targetModelVersion
        ? await migrateModel(root, options)
        : { ...plan, applied: false };
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else if (result.sourceModelVersion === result.targetModelVersion) {
      console.log(`Workspace already uses model v${result.targetModelVersion}.`);
    } else if (flags.preview) {
      console.log(`Model migration preview: create ${result.summary.create}; update ${result.summary.update}.`);
      console.log(result.ready
        ? "Ready to apply. Rerun with --yes."
        : `Needs review: ${result.missing.length} missing values, ${result.conflicts.length} conflicts, ${result.manualActions.length} manual actions.`);
    } else {
      console.log(`Migrated workspace from model v${result.sourceModelVersion} to v${result.targetModelVersion}.`);
      if (result.migrationReportPath) console.log(`Migration report: ${result.migrationReportPath}`);
    }
    return result;
  }
  if (command === "describe") {
    const loaded = await loadWorkspace(root);
    const type = positionals[0];
    const definition = loaded.model.resources[type];
    if (!definition) throw new Error(`Unknown resource type "${type}".`);
    console.log(JSON.stringify({ type, ...definition, commonFields: loaded.model.commonFields }, null, 2));
    return;
  }
  if (command === "types") {
    const loaded = await loadWorkspace(root);
    const types = listResourceTypes(loaded.model);
    if (flags.json) console.log(JSON.stringify(types, null, 2));
    else for (const item of types) console.log(`${item.type}\t${item.title}\t${item.purpose}`);
    return types;
  }
  if (command === "guide") {
    const loaded = await loadWorkspace(root);
    const type = positionals[0];
    if (!type) {
      const result = agentOverview(loaded.model);
      if (flags.json) console.log(JSON.stringify(result, null, 2));
      else printAgentOverview(result);
      return result;
    }
    const result = buildAgentGuide(loaded, type, { id: flags.id, programId: flags.program });
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else printAgentGuide(result);
    return result;
  }
  if (command === "program-path") {
    const loaded = await loadWorkspace(root);
    const auditId = positionals[0] || flags.audit;
    const audit = auditId ? loaded.resources.find(({ id, type }) => id === auditId && type === "audit") : null;
    const programId = flags.program || audit?.programId;
    const readiness = await assessProgramReadiness(loaded, { asOf: flags["as-of"], programId });
    const auditReadiness = auditId ? await assessAuditPreparation(loaded, {
      auditId,
      asOf: flags["as-of"]
    }) : null;
    const result = buildProgramPathResult(loaded.model, readiness, auditReadiness);
    const output = selectProgramPathOutput(result, flags);
    if (flags.json) console.log(JSON.stringify(output, null, 2));
    else printProgramPathOutput(output, flags);
    return output;
  }
  if (command === "workflow") {
    const result = await assessWorkflow(root, {
      auditId: positionals[0] || flags.audit,
      programId: flags.program,
      asOf: flags["as-of"],
      through: flags.through,
      includeComplete: Boolean(flags.complete)
    });
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else printWorkflow(result);
    if (flags["require-ready"] && result.assessments.evidenceReadiness.status !== "complete") {
      process.exitCode = 2;
    }
    return result;
  }
  if (command === "period-health") {
    const coverage = flags.start || flags.end
      ? { kind: "range", startsOn: flags.start, endsOn: flags.end }
      : undefined;
    const result = await assessWorkflow(root, {
      auditId: positionals[0] || flags.audit,
      programId: flags.program,
      asOf: flags["as-of"],
      through: flags.end || flags.through,
      coverage
    });
    const output = {
      contractVersion: result.contractVersion,
      dataModelVersion: result.dataModelVersion,
      evaluatedAt: result.evaluatedAt,
      input: result.input,
      assessment: result.assessments.periodHealth,
      findings: result.findings.filter(({ assessment }) => assessment === "period-health"),
      workItems: result.workItems.filter((item) => (
        ["overdue", "due", "scheduled", "blocked"].includes(item.state)
      )),
      recommended: result.recommended
    };
    if (flags.json) console.log(JSON.stringify(output, null, 2));
    else {
      console.log(`${output.assessment.status.toUpperCase()}: ${output.assessment.message}`);
      for (const finding of output.findings) {
        console.log(`${finding.state.toUpperCase()}\t${finding.title}\t${finding.message}`);
      }
    }
    if (flags["require-healthy"] && output.assessment.status !== "complete") process.exitCode = 2;
    return output;
  }
  if (command === "milestone-check") {
    const loaded = await loadWorkspace(root);
    const result = await assessWorkflow(loaded, { asOf: flags["as-of"], programId: flags.program });
    const program = resolveProgram(loaded, flags.program);
    const target = program?.assuranceGoal === "none"
      ? "structuralValidity"
      : program?.candidateCoverage
        ? "periodHealth"
        : "evidenceReadiness";
    const output = {
      milestone: target,
      assessment: result.assessments[target],
      findingKeys: result.assessments[target].findingKeys,
      evaluatedAt: result.evaluatedAt
    };
    if (flags.json) console.log(JSON.stringify(output, null, 2));
    else console.log(`${target}: ${output.assessment.status.toUpperCase()} · ${output.assessment.message}`);
    if (output.assessment.status !== "complete") process.exitCode = 2;
    return output;
  }
  if (command === "scaffold") {
    const loaded = await loadWorkspace(root);
    const type = positionals[0];
    const result = scaffoldResourceMutation(loaded, type, flags.title, { id: flags.id, programId: flags.program });
    console.log(JSON.stringify(result, null, 2));
    return result;
  }
  if (command === "list") {
    const loaded = await loadWorkspace(root);
    const type = positionals[0];
    if (type && !loaded.model.resources[type]) throw new Error(`Unknown resource type "${type}".`);
    const asOf = currentCalendarDate(loaded.workspace.timezone);
    const records = loaded.resources
      .filter((record) => !type || record.type === type)
      .sort((left, right) => `${left.type}:${left.title}:${left.id}`.localeCompare(`${right.type}:${right.title}:${right.id}`))
      .map((record) => {
        const effectiveStatus = effectiveResourceStatus(record, asOf);
        return effectiveStatus && effectiveStatus !== record.status
          ? { ...record, effectiveStatus }
          : record;
      });
    const output = flags.workflow
      ? {
          records,
          workflow: await assessWorkflow(loaded, { asOf, programId: flags.program })
        }
      : records;
    if (flags.json) console.log(JSON.stringify(output, null, 2));
    else for (const record of records) console.log(`${record.id}\t${record.type}\t${record.effectiveStatus ?? record.status ?? ""}\t${record.title}`);
    return output;
  }
  if (command === "search") {
    const loaded = await loadWorkspace(root);
    const query = positionals.join(" ");
    const results = searchResources(loaded.resources, loaded.model, { query, type: flags.type });
    if (flags.json) console.log(JSON.stringify(results, null, 2));
    else for (const resource of results) console.log(`${resource.id}\t${resource.type}\t${resource.title}`);
    return results;
  }
  if (command === "obligations") {
    const loaded = await loadWorkspace(root);
    const result = planObligations(loaded.resources, {
      asOf: flags["as-of"] ?? currentCalendarDate(loaded.workspace.timezone),
      from: flags.from,
      through: flags.through,
      now: flags.now,
      includeComplete: Boolean(flags.complete),
      model: loaded.model
    });
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`${result.counts.overdue} overdue, ${result.counts.blocked} blocked, ${result.counts.due} due, ${result.counts.upcoming} upcoming, ${result.counts.proposed} starter proposals`);
      for (const item of result.items) {
        const deadline = item.dueWindowEndAt || item.dueWindowEnd;
        if (!deadline) throw new Error(`Planned work "${item.title}" is missing a deadline.`);
        console.log([
          item.status.toUpperCase(),
          item.dueWindowStartAt || item.dueWindowStart,
          deadline,
          item.title,
          item.actionItemId || item.obligationId,
          item.actionItemId
            ? item.status === "blocked"
              ? `filegrc get ${item.actionItemId} --mutation`
              : `filegrc complete-action ${item.actionItemId} --scaffold --completed-on YYYY-MM-DD`
            : `filegrc complete ${item.obligationId} --scaffold --window-start ${item.dueWindowStart} --completed-on YYYY-MM-DD`
        ].join("\t"));
      }
      if (result.triggers.length) {
        console.log("\nPolicy Events:");
        for (const trigger of result.triggers) {
          console.log(`${trigger.programStatus.toUpperCase()}\t${trigger.title} (${trigger.eventType})\t${trigger.steps.length} Work Queue ${trigger.steps.length === 1 ? "task" : "tasks"}`);
          for (const step of trigger.steps) {
            const owners = step.ownerIds.length ? step.ownerIds.join(",") : "unassigned";
            const proof = step.completionResourceTypes.length ? step.completionResourceTypes.join("|") : "not specified";
            console.log(`  ${step.title}\t${eventWindowText(step.window)}\towner=${owners}\tproof=${proof}`);
          }
          if (trigger.programStatus !== "proposed") console.log(`  Trigger: filegrc trigger ${trigger.eventType} --occurred-on YYYY-MM-DD --subject RESOURCE_ID --json`);
        }
      }
    }
    return result;
  }
  if (command === "program-readiness") {
    const loaded = await loadWorkspace(root);
    const result = await assessProgramReadiness(loaded, { asOf: flags["as-of"], programId: flags.program });
    const output = flags.summary ? summarizeProgramReadiness(result) : result;
    if (flags.json) console.log(JSON.stringify(output, null, 2));
    else if (flags.summary) {
      console.log(`${result.status.toUpperCase()}: ${result.progress.complete} of ${result.progress.total} program items complete`);
      for (const stage of output.stages) {
        console.log(`${stage.status.toUpperCase()}\t${stage.title}\t${stage.counts.action} actions`);
      }
      if (output.firstAction) console.log(`Next: ${output.firstAction.title}\t${output.firstAction.message}`);
    }
    else {
      console.log(`${result.status.toUpperCase()}: ${result.progress.complete} of ${result.progress.total} program items complete`);
      console.log(
        `${result.target.label}`
        + (result.target.candidateCoverage?.kind === "range"
          ? `, candidate period starts ${result.target.candidateCoverage.startsOn}`
          : result.target.candidateCoverage?.kind === "as-of"
            ? `, candidate as-of date ${result.target.candidateCoverage.on}`
            : "")
      );
      for (const stage of result.stages) {
        console.log(`\n${stage.title}`);
        for (const item of stage.items) console.log(`${item.status.toUpperCase()}\t${item.title}\t${item.message}`);
      }
      if (result.policyActivations.length) {
        console.log("\nPolicy activation assessments");
        for (const policy of result.policyActivations) {
          console.log(`${policy.label.toUpperCase()}\t${policy.title}\t${policy.gapCount} implementation gaps`);
        }
      }
      if (result.canStartCandidatePeriod && !result.operating) {
        console.log(`\nEvidence Ready: management can start the candidate Type 2 period on or after ${result.suggestedCandidatePeriodStart || result.asOf}.`);
      }
    }
    if (flags["require-ready"] && !result.evidenceReady) process.exitCode = 2;
    return output;
  }
  if (command === "evidence-map") {
    const loaded = await loadWorkspace(root);
    const result = await assessEvidenceMap(loaded, { asOf: flags["as-of"], programId: flags.program });
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`${result.status.toUpperCase()}: ${result.counts.complete} mapped, ${result.counts.action} need action`);
      for (const item of result.items) {
        console.log(`${item.status.toUpperCase()}\t${item.title}\t${item.message}`);
        if (item.status !== "action") continue;
        if (item.sourceKinds?.length) console.log(`  Source role: ${item.sourceKinds.join(" or ")}`);
        for (const source of item.sourceComponentChecks || item.sourceSystemChecks || []) {
          const missing = Object.entries(source.checks)
            .filter(([, passed]) => !passed)
            .map(([name]) => evidenceSourceCheckName(name));
          if (missing.length) console.log(`  ${source.sourceComponentId || source.sourceSystemId}: ${missing.join(", ")}`);
        }
        if (item.commands?.length) console.log(`  Next: ${item.commands[0]}`);
      }
    }
    return result;
  }
  if (command === "audit-readiness") {
    const loaded = await loadWorkspace(root);
    const result = await assessAuditPreparation(loaded, {
      auditId: positionals[0] || flags.audit,
      asOf: flags["as-of"]
    });
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`${result.status.toUpperCase()}: ${result.progress.complete} of ${result.progress.total} management items complete`);
      for (const stage of result.stages) {
        console.log(`\n${stage.title}`);
        for (const item of stage.items) {
          console.log(`${item.status.toUpperCase()}\t${item.title}\t${item.message}`);
        }
      }
    }
    if (flags["require-ready"] && result.status !== "management-ready") process.exitCode = 2;
    return result;
  }
  if (command === "prepare-audit") {
    const auditId = positionals[0] || flags.audit;
    if (!auditId) throw new Error("An audit ID is required.");
    const result = await withWorkflowDelta(root, () => prepareAuditWorkspace(root, { auditId }));
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`Prepared ${result.auditId}: linked ${result.linkedDocumentIds.length} management documents and created ${result.createdPopulationIds.length} population records.`);
    return result;
  }
  if (command === "reconcile") {
    const result = flags.apply
      ? await withWorkflowDelta(root, () => applyReconciliation(root, {
        candidateId: flags.candidate,
        transitionFingerprint: flags.candidate,
        occurredOn: flags["occurred-on"],
        occurredAt: flags["occurred-at"],
        riskLevel: flags["risk-level"],
        title: flags.title,
        confirmed: flags.yes === true
      }))
      : await planReconciliation(root);
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else if (flags.apply) {
      console.log(`Reconciled ${result.candidate.eventType}: created ${result.event.id} and ${result.actions.length} linked tasks.`);
    } else if (!result.candidates.length) {
      console.log("No direct-file transitions need confirmation.");
    } else {
      for (const candidate of result.candidates) {
        console.log(`${candidate.id}\t${candidate.eventType}\t${candidate.subject.title}\t${candidate.message}`);
        console.log(`  ${candidate.action.command}`);
      }
    }
    return result;
  }
  if (command === "external-reviewer-setup") {
    if (flags.scaffold) {
      const result = await scaffoldExternalReviewerGovernance(root);
      console.log(JSON.stringify(result, null, 2));
      return result;
    }
    const payload = await readSetupPayload(positionals[0]);
    const options = {
      ...payload,
      confirmed: flags.yes === true
    };
    const result = flags.preview
      ? await planExternalReviewerGovernance(root, options)
      : await withWorkflowDelta(root, () => setupExternalReviewerGovernance(root, options));
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else if (flags.preview) {
      console.log(`External reviewer governance preview: ${result.changes.create.length} records to create and ${result.changes.update.length} to update.`);
    } else {
      console.log(`Assigned external reviewer ${result.reviewerId} through ${result.appointmentIds.length} active Appointments.`);
    }
    return result;
  }
  if (command === "next-audit-cycle") {
    const payload = await readSetupPayload(positionals[1]);
    const options = {
      ...payload,
      priorAuditId: positionals[0] || flags.audit || payload.priorAuditId,
      startsOn: flags.start || payload.startsOn,
      endsOn: flags.end || payload.endsOn,
      confirmed: flags.yes === true
    };
    const result = flags.preview
      ? await planNextAuditCycle(root, options)
      : await withWorkflowDelta(root, () => createNextAuditCycle(root, options));
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else if (flags.preview) {
      console.log(`${result.operation} preview: ${result.audit.title}, ${result.audit.coverage.startsOn} through ${result.audit.coverage.endsOn}.`);
    } else {
      console.log(`Created ${result.audit.id}. Review carried-forward scope and period continuity before fieldwork.`);
    }
    return result;
  }
  if (command === "review-applicability") {
    if (flags.scaffold) {
      const result = await scaffoldApplicabilityReview(root, { type: flags.type });
      console.log(JSON.stringify(result, null, 2));
      return result;
    }
    const payload = await readSetupPayload(positionals[0]);
    const options = { ...payload, confirmed: flags.yes === true };
    const result = flags.preview
      ? await planApplicabilityReview(root, options)
      : await applyApplicabilityReviewWithContext(root, options, { includeWorkflowDelta: true });
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else if (flags.preview) console.log(`Applicability preview: ${result.reviewedIds.length} decisions.`);
    else console.log(`Recorded ${result.reviewedIds.length} reviewed applicability decisions.`);
    return result;
  }
  if (command === "review-collection") {
    const resourceType = positionals[0] || flags.type;
    if (flags.scaffold) {
      const result = await scaffoldCollectionReview(root, { resourceType });
      console.log(JSON.stringify(result, null, 2));
      return result;
    }
    const payload = await readSetupPayload(positionals[1]);
    const options = {
      ...payload,
      resourceType: resourceType || payload.resourceType,
      confirmed: flags.yes === true
    };
    const result = flags.preview
      ? await planCollectionReview(root, options)
      : await withWorkflowDelta(root, () => applyCollectionReview(root, options));
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else if (flags.preview) console.log(`Collection review preview: ${result.assessment.configuration.title}.`);
    else console.log(`Confirmed ${result.assessment.configuration.title}.`);
    return result;
  }
  if (command === "activate-policies") {
    if (flags.scaffold) {
      const result = await scaffoldPolicyActivation(root, { programId: flags.program });
      console.log(JSON.stringify(result, null, 2));
      return result;
    }
    const payload = await readSetupPayload(positionals[0]);
    const options = {
      ...payload,
      policyIds: flags.policy ? String(flags.policy).split(",").filter(Boolean) : payload.policyIds,
      effectiveOn: flags["effective-on"] || payload.effectiveOn,
      confirmed: flags.yes === true
    };
    const result = flags.preview
      ? await planPolicyActivation(root, options)
      : await withWorkflowDelta(root, () => activatePolicies(root, options));
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else if (flags.preview) console.log(`Policy activation preview: ${result.policyIds.length} Policies effective ${result.effectiveOn}.`);
    else console.log(`Activated ${result.policyIds.length} Policies effective ${result.effectiveOn}.`);
    return result;
  }
  if (command === "activate-documents") {
    if (flags.scaffold) {
      const result = await scaffoldDocumentActivation(root, { programId: flags.program, auditId: flags.audit });
      console.log(JSON.stringify(result, null, 2));
      return result;
    }
    const payload = await readSetupPayload(positionals[0]);
    const options = {
      ...payload,
      documentIds: flags.document ? String(flags.document).split(",").filter(Boolean) : payload.documentIds,
      activatedByIds: flags["activated-by"] ? String(flags["activated-by"]).split(",").filter(Boolean) : payload.activatedByIds,
      activatedOn: flags["activated-on"] || payload.activatedOn,
      effectiveOn: flags["effective-on"] || payload.effectiveOn,
      programId: flags.program || payload.programId,
      auditId: flags.audit || payload.auditId,
      confirmed: flags.yes === true
    };
    const result = flags.preview
      ? await planDocumentActivation(root, options)
      : await withWorkflowDelta(root, () => activateDocuments(root, options));
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else if (flags.preview) console.log(`Document activation preview: ${result.documentIds.length} governed Documents effective ${result.effectiveOn}.`);
    else console.log(`Activated ${result.documentIds.length} governed Documents effective ${result.effectiveOn}.`);
    return result;
  }
  if (command === "activate-content") {
    if (flags.scaffold) {
      const result = await scaffoldGovernedContentActivation(root, { programId: flags.program });
      console.log(JSON.stringify(result, null, 2));
      return result;
    }
    const payload = await readSetupPayload(positionals[0]);
    const options = {
      ...payload,
      resourceIds: flags.resource ? String(flags.resource).split(",").filter(Boolean) : payload.resourceIds,
      activatedByIds: flags["activated-by"] ? String(flags["activated-by"]).split(",").filter(Boolean) : payload.activatedByIds,
      activatedOn: flags["activated-on"] || payload.activatedOn,
      effectiveOn: flags["effective-on"] || payload.effectiveOn,
      programId: flags.program || payload.programId,
      confirmed: flags.yes === true
    };
    const result = flags.preview
      ? await planGovernedContentActivation(root, options)
      : await withWorkflowDelta(root, () => activateGovernedContent(root, options));
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else if (flags.preview) console.log(`Governed-content activation preview: ${result.resourceIds.length} records effective ${result.effectiveOn}.`);
    else console.log(`Activated ${result.resourceIds.length} governed-content records effective ${result.effectiveOn}.`);
    return result;
  }
  if (command === "policy-library") {
    if (flags.yes && !flags.accept) {
      throw new Error("Pass --accept <proposal-id> with --yes after reviewing the policy-library diff.");
    }
    const result = flags.accept
      ? await withWorkflowDelta(root, () => applyPolicyLibraryUpgrade(root, String(flags.accept), {
          confirmed: flags.yes === true,
          proposalRevision: flags["proposal-revision"] ? String(flags["proposal-revision"]) : null
        }))
      : await assessPolicyLibraryUpgrades(root);
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else if (flags.accept) console.log(`Accepted policy-library proposal ${flags.accept}.`);
    else if (!result.proposals.length) console.log("No starter policy-library update applies. Existing content is unchanged.");
    else {
      for (const proposal of result.proposals) {
        console.log(`${proposal.title} (${proposal.id})`);
        console.log(proposal.message);
        for (const change of proposal.changes) console.log(`\n${change.diff}`);
        console.log(`\nAccept with: filegrc policy-library --accept ${proposal.id} --proposal-revision ${proposal.revision} --yes`);
      }
    }
    return result;
  }
  if (command === "trigger") {
    const result = await withWorkflowDelta(root, () => createObligationEvent(root, {
      eventType: positionals[0],
      occurredOn: flags["occurred-on"],
      occurredAt: flags["occurred-at"],
      riskLevel: flags["risk-level"],
      subjectResourceIds: String(flags.subject || "").split(",").map((value) => value.trim()).filter(Boolean),
      title: flags.title
    }));
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`Work added to the Work Queue: ${result.actions.length} ${result.actions.length === 1 ? "task" : "tasks"} created for ${result.event.title}.`);
      console.log(`Event: obligation-event/${result.event.id}`);
      for (const action of result.actions) {
        const deadline = action.completionWindow?.dueAt || action.completionWindow?.dueOn;
        console.log(`Task: action-item/${action.id}\t${action.title}\t${deadline}`);
      }
    }
    return result;
  }
  if (command === "evidence-packet") {
    const options = {
      start: flags.start,
      end: flags.end,
      auditId: flags.audit,
      output: flags.output
    };
    const generated = flags.preview
      ? { packet: await prepareEvidencePacket(root, options), output: null, files: [] }
      : await generateEvidencePacket(root, options);
    const packet = generated.packet;
    let output = null;
    let files = generated.files;
    if (!flags.preview) {
      output = relativeToWorkspace(root, generated.output);
    }
    const result = { packet, output, files };
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`${packet.readiness.status.toUpperCase()}: ${packet.summary.datedRecords} dated records, ${packet.summary.obligationOccurrences} obligation occurrences, ${packet.summary.evidence} evidence records, ${packet.summary.errors} errors, ${packet.summary.warnings} warnings`);
      console.log(flags.preview ? "Preview only; no files written." : `Wrote evidence packet to ${output}`);
    }
    if (flags["require-ready"] && packet.readiness.status !== "delivery-ready") process.exitCode = 2;
    return result;
  }
  if (command === "get") {
    const loaded = await loadWorkspace(root);
    const [first, second] = positionals;
    const type = second ? first : null;
    const id = second ?? first;
    if (!id) throw new Error("A resource ID is required.");
    const record = loaded.resources.find((item) => item.id === id && (!type || item.type === type));
    if (!record) throw new Error(`Resource "${type ? `${type}/` : ""}${id}" was not found.`);
    if (flags.mutation) {
      const state = await createAppState(root);
      const entry = state.resources.find((item) => item.record.id === record.id);
      const contentEntries = Object.entries(entry.content ?? {}).filter(([, content]) => content.source !== null);
      const mutation = {
        record,
        ...(contentEntries.length ? {
          content: Object.fromEntries(contentEntries.map(([name, content]) => [name, content.source])),
          contentRevisions: Object.fromEntries(contentEntries.map(([, content]) => [content.path, content.revision]))
        } : {}),
        revision: entry.revision
      };
      console.log(JSON.stringify(mutation, null, 2));
      return mutation;
    }
    const output = flags.workflow
      ? {
          record,
          workflow: workflowForResource(await assessWorkflow(loaded), record.type, record.id)
        }
      : record;
    console.log(JSON.stringify(output, null, 2));
    return output;
  }
  if (command === "references") {
    const loaded = await loadWorkspace(root);
    const result = findResourceReferences(loaded, positionals[0]);
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`${result.resource.type}/${result.resource.id} has ${result.references.length} inbound reference${result.references.length === 1 ? "" : "s"}.`);
      for (const reference of result.references) {
        console.log(`${reference.type}/${reference.id}\t${reference.field}\t${reference.title}`);
      }
    }
    return result;
  }
  if (command === "preview-mutation") {
    const payload = await readSetupPayload(positionals[0]);
    const result = await previewWorkflowMutation(root, payload);
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`${result.operation.toUpperCase()} preview for ${result.target.type}/${result.target.id}`);
      console.log(`${result.workflowDelta.findings.added.length} findings added, ${result.workflowDelta.findings.removed.length} resolved, ${result.workflowDelta.findings.changed.length} changed.`);
      if (result.workflow.recommended) console.log(`Next: ${result.workflow.recommended.title}`);
      console.log("No workspace files were changed.");
    }
    return result;
  }
  if (command === "create") {
    const mutation = await readMutation(positionals[0]);
    const result = await withWorkflowDelta(root, () => createResource(root, mutation.record, { content: mutation.content }));
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`Created ${result.record.type}/${result.record.id}`);
    return result;
  }
  if (command === "complete") {
    const [obligationId, file] = positionals;
    if (flags.scaffold) {
      const result = await scaffoldObligationCompletion(root, {
        obligationId,
        windowStart: flags["window-start"],
        completedOn: flags["completed-on"]
      });
      console.log(JSON.stringify(result, null, 2));
      return result;
    }
    const mutation = await readMutation(file);
    const result = await withWorkflowDelta(root, () => completeObligationOccurrence(root, {
      obligationId,
      record: mutation.record,
      content: mutation.content,
      expectedRevision: expectedRevision(flags, mutation, `obligation/${obligationId}`)
    }));
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`Created ${result.created.type}/${result.created.id} and linked it to obligation/${obligationId}`);
    return result;
  }
  if (command === "complete-action") {
    const [actionItemId, file] = positionals;
    if (flags.scaffold) {
      const result = await scaffoldObligationCompletion(root, {
        actionItemId,
        completedOn: flags["completed-on"]
      });
      console.log(JSON.stringify(result, null, 2));
      return result;
    }
    const mutation = await readMutation(file);
    const result = await withWorkflowDelta(root, () => completeObligationAction(root, {
      actionItemId,
      completedOn: flags["completed-on"],
      record: mutation.record,
      content: mutation.content,
      expectedRevision: expectedRevision(flags, mutation, `action-item/${actionItemId}`)
    }));
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`Created ${result.created.type}/${result.created.id}, linked it to action-item/${actionItemId}, and marked the action done.`);
    return result;
  }
  if (command === "complete-event") {
    const eventId = positionals[0];
    if (!eventId) throw new Error("A Policy Event ID is required.");
    const result = await withWorkflowDelta(root, () => completeObligationEvent(root, {
      eventId,
      completedOn: flags["completed-on"],
      expectedRevision: requireExpectedRevision(flags, `obligation-event/${eventId}`)
    }));
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`Marked obligation-event/${eventId} complete.`);
    return result;
  }
  if (command === "update") {
    const [type, id, file] = positionals;
    const mutation = await readMutation(file, { requireRevision: true });
    const result = await withWorkflowDelta(root, () => updateResource(root, type, id, mutation.record, {
      content: mutation.content,
      expectedRevision: mutation.revision,
      expectedContentRevisions: mutation.contentRevisions,
      requireExpectedContentRevisions: true
    }));
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`Updated ${result.record.type}/${result.record.id}`);
    return result;
  }
  if (command === "content") {
    const [type, id, requestedSlot] = positionals;
    if (!type || !id) throw new Error("A resource type and ID are required.");
    const loaded = await loadWorkspace(root);
    const record = loaded.resources.find((item) => item.type === type && item.id === id);
    if (!record) throw new Error(`Resource "${type}/${id}" was not found.`);
    const entries = markdownEntries(loaded.model, record);
    const slot = requestedSlot
      ? entries.find((item) => item.name === requestedSlot)
      : entries.find((item) => item.primary) ?? entries[0];
    if (!slot) throw new Error(`Markdown slot "${requestedSlot ?? ""}" was not found for ${type}/${id}.`);
    if (flags.write !== undefined) {
      const source = await readTextInput(flags.write);
      const state = await createAppState(root);
      const stateEntry = state.resources.find((item) => item.record.type === type && item.record.id === id);
      const existingContentRevision = stateEntry.content?.[slot.name]?.revision;
      const mutationResult = await withWorkflowDelta(root, () => updateResource(root, type, id, record, {
        content: { [slot.name]: source },
        expectedRevision: stateEntry.revision,
        expectedContentRevisions: existingContentRevision
          ? { [slot.path]: flags["expected-revision"] ?? existingContentRevision }
          : undefined
      }));
      const result = {
        type,
        id,
        slot: slot.name,
        path: `data/${slot.path}`,
        written: true,
        workflowDelta: mutationResult.workflowDelta
      };
      if (flags.json) console.log(JSON.stringify(result, null, 2));
      else console.log(`Updated ${result.path}`);
      return result;
    }
    let source = null;
    try {
      source = await readFile(resolveDataPath(root, slot.path), "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const result = { type, id, slot: slot.name, path: `data/${slot.path}`, exists: source !== null, source };
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else if (source !== null) process.stdout.write(source);
    else console.log(`No Markdown exists at ${result.path}.`);
    return result;
  }
  if (command === "attach") {
    const [evidenceId, sourcePath] = positionals;
    if (!evidenceId || !sourcePath) throw new Error("An evidence ID and source file are required.");
    const result = await withWorkflowDelta(root, () => addEvidenceAttachment(root, evidenceId, sourcePath, {
      name: flags.name,
      expectedRevision: requireExpectedRevision(flags, `evidence/${evidenceId}`)
    }));
    const output = {
      evidenceId,
      path: `data/${result.dataRelativePath}`,
      filePaths: result.record.filePaths,
      workflowDelta: result.workflowDelta
    };
    if (flags.json) console.log(JSON.stringify(output, null, 2));
    else console.log(`Attached ${output.path} to evidence/${evidenceId}`);
    return output;
  }
  if (command === "detach") {
    const [evidenceId, attachment] = positionals;
    if (!evidenceId || !attachment) throw new Error("An evidence ID and attachment name are required.");
    if (!flags.yes) throw new Error("Pass --yes to confirm attachment removal.");
    const result = await withWorkflowDelta(root, () => removeEvidenceAttachment(root, evidenceId, attachment, {
      expectedRevision: requireExpectedRevision(flags, `evidence/${evidenceId}`)
    }));
    const output = {
      evidenceId,
      removed: `data/${result.dataRelativePath}`,
      filePaths: result.record.filePaths ?? [],
      workflowDelta: result.workflowDelta
    };
    if (flags.json) console.log(JSON.stringify(output, null, 2));
    else console.log(`Detached and removed ${output.removed} from evidence/${evidenceId}`);
    return output;
  }
  if (command === "delete") {
    const [type, id] = positionals;
    if (!flags.yes) throw new Error("Pass --yes to confirm deletion. Preserve historical records unless this is a mistake or uncommitted draft.");
    const result = await withWorkflowDelta(root, () => deleteResource(root, type, id, {
      expectedRevision: requireExpectedRevision(flags, `${type}/${id}`)
    }));
    const output = { deleted: true, type, id, workflowDelta: result.workflowDelta };
    if (flags.json) console.log(JSON.stringify(output, null, 2));
    else console.log(`Deleted ${type}/${id}`);
    return output;
  }
  throw new Error(`Unknown command "${command}". Run filegrc help.`);
}

function parseArgs(args) {
  const positionals = [];
  const flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }
    const source = value.slice(2);
    const separator = source.indexOf("=");
    const name = separator === -1 ? source : source.slice(0, separator);
    const inline = separator === -1 ? undefined : source.slice(separator + 1);
    if (inline !== undefined) flags[name] = inline;
    else if (BOOLEAN_FLAGS.has(name)) flags[name] = true;
    else if (args[index + 1] && !args[index + 1].startsWith("--")) flags[name] = args[++index];
    else flags[name] = true;
  }
  return { positionals, flags };
}

async function withWorkflowDelta(root, task) {
  const before = await assessWorkflow(root);
  const result = await task();
  const after = await assessWorkflow(root);
  return {
    ...result,
    workflowDelta: buildWorkflowDelta(before, after)
  };
}

async function readMutation(path, options = {}) {
  if (!path) throw new Error("A JSON file path or - is required.");
  const source = path === "-" ? await readStdin() : await readFile(resolve(path), "utf8");
  return normalizeResourceMutation(JSON.parse(source), options);
}

function requireExpectedRevision(flags, target) {
  const revision = flags["expected-revision"];
  if (typeof revision !== "string" || revision.length === 0) {
    throw new Error(`--expected-revision is required when changing ${target}. Reload the resource and try again.`);
  }
  return revision;
}

function expectedRevision(flags, mutation, target) {
  const revision = flags["expected-revision"] || mutation.revision;
  if (typeof revision !== "string" || revision.length === 0) {
    throw new Error(`A mutation revision or --expected-revision is required when changing ${target}. Reload the resource and try again.`);
  }
  return revision;
}

async function readSetupPayload(path) {
  if (!path) return {};
  const source = path === "-" ? await readStdin() : await readFile(resolve(path), "utf8");
  const parsed = JSON.parse(source);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("Setup input must be a JSON object.");
  }
  return parsed;
}

async function completeInteractiveSetup(root, payload) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return payload;
  const loaded = await loadWorkspace(root);
  const activePeople = loaded.resources.filter(({ type, status }) => type === "person" && status === "active");
  if (!activePeople.length) throw new Error("Setup requires at least one active person who can own the service.");
  const classifications = Object.keys(loaded.workspace.classificationDefinitions || {});
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const result = { ...payload };
  const askRequired = async (label, defaultValue = "") => {
    const suffix = defaultValue ? ` [${defaultValue}]` : "";
    let value = "";
    while (!value) value = (await prompt.question(`${label}${suffix}: `)).trim() || defaultValue;
    return value;
  };
  const askChoice = async (label, choices, defaultValue = "") => {
    let value = "";
    while (!choices.includes(value)) {
      value = await askRequired(`${label} (${choices.join("/")})`, defaultValue);
    }
    return value;
  };
  try {
    result.serviceName ||= await askRequired(
      "Service name",
      loaded.workspace.organizationName ? `${loaded.workspace.organizationName} service` : ""
    );
    result.boundary ||= await askRequired("Service boundary");
    result.ownerId ||= await askChoice(
      "Service owner ID",
      activePeople.map(({ id }) => id),
      activePeople[0].id
    );
    result.criticality ||= await askChoice("Criticality", ["low", "medium", "high", "critical"], "high");
    result.classificationId ||= classifications.length
      ? await askChoice(
        "Data classification",
        classifications,
        classifications.includes("confidential") ? "confidential" : classifications[0]
      )
      : await askRequired("Data classification");
    if (result.internetExposed === undefined) {
      result.internetExposed = (await askChoice("Internet exposed", ["yes", "no"])) === "yes";
    }
    result.programGoal ||= await askChoice("Program goal", ["none", "readiness", "type-1", "type-2"]);
  } finally {
    prompt.close();
  }
  return result;
}

async function readTextInput(path) {
  if (path === true || !path) throw new Error("Pass --write <markdown-file|->.");
  return path === "-" ? readStdin() : readFile(resolve(String(path)), "utf8");
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function printValidation(result) {
  for (const item of result.diagnostics) console.log(`${item.severity.toUpperCase()} ${item.path}: ${item.message}`);
  console.log(`${result.counts.resources} resources, ${result.counts.errors} errors, ${result.counts.warnings} warnings`);
}

async function printVersion() {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  console.log(packageJson.version);
}

function printHelp() {
  console.log(`filegrc - Git-native GRC workspace

Usage:
  filegrc serve [root] [--host 127.0.0.1] [--port 8787] [--allow-non-authoritative-writes]
  filegrc setup [setup.json|-] [setup options] [--draft] [--preview] [--summary] [--json]
  filegrc build [root] [--output .filegrc/site]
  filegrc validate [root] [--json]
  filegrc model [--json|--write-docs|--check-docs]
  filegrc migrate --to-model <${SUPPORTED_MODEL_VERSIONS.join("|")}> [--preview] [--decisions path] [--job-title text] [--starts-on YYYY-MM-DD] [--yes] [--json]
  filegrc describe <resource-type>
  filegrc types [--json]
  filegrc guide [resource-type] [--id resource-id] [--program program-id] [--json]
  filegrc program-path [audit-id] [--as-of YYYY-MM-DD] [--summary|--next|--current] [--json]
  filegrc workflow [audit-id] [--as-of YYYY-MM-DD] [--through YYYY-MM-DD] [--complete] [--require-ready] [--json]
  filegrc period-health [audit-id] [--start YYYY-MM-DD --end YYYY-MM-DD] [--as-of YYYY-MM-DD] [--require-healthy] [--json]
  filegrc milestone-check [--as-of YYYY-MM-DD] [--json]
  filegrc scaffold <resource-type> --title text [--id resource-id] [--program program-id]
  filegrc list [resource-type] [--workflow] [--json]
  filegrc search <query> [--type resource-type] [--json]
  filegrc obligations [--as-of YYYY-MM-DD] [--from YYYY-MM-DD] [--through YYYY-MM-DD] [--now RFC3339] [--complete] [--json]
  filegrc program-readiness [--as-of YYYY-MM-DD] [--require-ready] [--summary] [--json]
  filegrc evidence-map [--as-of YYYY-MM-DD] [--json]
  filegrc audit-readiness [audit-id] [--as-of YYYY-MM-DD] [--require-ready] [--json]
  filegrc prepare-audit <audit-id> [--json]
  filegrc reconcile [--preview|--apply --candidate fingerprint (--occurred-on YYYY-MM-DD | --occurred-at RFC3339) --yes] [--risk-level normal|high] [--json]
  filegrc external-reviewer-setup --scaffold
  filegrc external-reviewer-setup <reviewer.json|-> [--preview|--yes] [--json]
  filegrc next-audit-cycle <prior-audit-id> [cycle.json|-] --start YYYY-MM-DD --end YYYY-MM-DD [--preview|--yes] [--json]
  filegrc review-applicability [--scaffold --type requirement|control|commitment|complementary-control] [decisions.json|-] [--preview|--yes] [--json]
  filegrc review-collection <resource-type> [--scaffold | review.json|-] [--preview|--yes] [--json]
  filegrc activate-policies [--scaffold | activation.json|-] [--effective-on YYYY-MM-DD] [--preview|--yes] [--json]
  filegrc activate-content [--scaffold | activation.json|-] [--program id] [--activated-by person-id] [--activated-on YYYY-MM-DD] [--effective-on YYYY-MM-DD] [--preview|--yes] [--json]
  filegrc activate-documents [--scaffold | activation.json|-] [--program id | --audit id] [--activated-by person-id] [--activated-on YYYY-MM-DD] [--effective-on YYYY-MM-DD] [--preview|--yes] [--json]
  filegrc policy-library [--json | --accept proposal-id --proposal-revision revision --yes]
  filegrc trigger <event-type> (--occurred-on YYYY-MM-DD | --occurred-at RFC3339) [--risk-level normal|high] [--subject resource-id[,resource-id]] [--title text] [--json]
  filegrc evidence-packet [--audit audit-id] [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--output .filegrc/path] [--preview] [--require-ready] [--json]
  filegrc get [resource-type] <id> [--mutation]
  filegrc references <id> [--json]
  filegrc preview-mutation <preview.json|-> [--json]
  filegrc create <mutation.json|-> [--json]
  filegrc complete <obligation-id> --scaffold --window-start YYYY-MM-DD [--completed-on YYYY-MM-DD]
  filegrc complete <obligation-id> <completion-record.json|-> [--expected-revision hash] [--json]
  filegrc complete-action <action-item-id> --scaffold [--completed-on YYYY-MM-DD]
  filegrc complete-action <action-item-id> <completion-record.json|-> --completed-on YYYY-MM-DD [--expected-revision hash] [--json]
  filegrc complete-event <obligation-event-id> --completed-on YYYY-MM-DD --expected-revision hash [--json]
  filegrc update <resource-type> <id> <mutation.json|-> [--json]
  filegrc content <resource-type> <id> [slot] [--write markdown-file|-] [--expected-revision hash] [--json]
  filegrc attach <evidence-id> <source-file> --expected-revision hash [--name file-name] [--json]
  filegrc detach <evidence-id> <attachment-name> --yes --expected-revision hash [--json]
  filegrc delete <resource-type> <id> --yes --expected-revision hash

All commands accept --root <workspace>. Writes never create Git commits.`);
}

function printCommandHelp(command) {
  if (command === "serve") {
    console.log(`Usage:
  filegrc serve [root] [--host address] [--port number] [--allow-non-authoritative-writes]

Options:
  --host <address>  Bind address. Defaults to FILEGRC_HOST or 127.0.0.1.
  --port <number>   Preferred port. Defaults to FILEGRC_PORT or 8787. If occupied,
                    the server uses an available port. Use 0 to choose one directly.
  --root <path>     Workspace path when no positional root is given.
  --allow-non-authoritative-writes
                     Allow local browser writes from a task checkout. This explicit
                     development override never commits or pushes.
  --help            Show this help without starting the server.

Safety:
  The editable server has no authentication and binds to loopback by default.
  Do not bind it to an untrusted network without trusted authentication.`);
    return;
  }
  if (command === "setup") {
    console.log(`Usage:
  filegrc setup [setup.json|-] [options]

Create or update the initial service boundary through the same validated operation
used by browser onboarding. Run without input in an interactive terminal for guided
setup. JSON keys use the camelCase forms shown below.

Options:
  --service-name <name>       serviceName
  --boundary <description>    boundary
  --owner <person-id>         ownerId
  --criticality <level>       low, medium, high, or critical
  --classification <level>    public, internal, confidential, or restricted
  --internet-exposed <bool>   true or false
  --program-goal <goal>       none, readiness, type-1, or type-2
  --draft                     Save the service boundary as planned
  --preview                   Validate and report planned writes without saving
  --summary                   Omit full workspace relationship arrays
  --json                      Print the result as JSON
  --root <path>               Workspace path
  --help                      Show this help`);
    return;
  }
  if (command === "migrate") {
    console.log(`Usage:
  filegrc migrate --to-model <${SUPPORTED_MODEL_VERSIONS.join("|")}> [options]

Upgrade a workspace through an explicit, reviewable model boundary. Model v1
workspaces migrate to v2 first. Continue one version at a time through v${ACTIVE_MODEL_VERSION}. v4 separates
the repository Workspace, management Program, bounded Systems, operational Components,
specific Assets, Vendors, normalized information, and Evidence Artifacts. Model v5 separates
Document approval from activation and records program-versus-engagement scope. Model v6 gives
Training the same approval and activation split and moves its schedule into Obligations. Model v7
keeps issued historical Documents neutral and requires a current activation for legacy Training. v3 migration
previews may require a decisions JSON file for ambiguous old Systems. v3 still creates planned
core Appointments, removal of obsolete manual page state, classified review work,
and dataModelVersion changed last. The command writes no Git commit.

Options:
  --to-model <version>  Required target model; migrations must run in order through ${SUPPORTED_MODEL_VERSIONS.join(", ")}
  --decisions <path>    JSON systemDecisions for v4 or documentScopes for ambiguous v5 Documents
  --preview             Show the complete atomic record plan without writing
  --job-title <title>   Actual job title for the former Policy Owner seed person
  --starts-on <date>    Effective date of a new Policy Owner Appointment
  --yes                 Apply the reviewed migration
  --json                Print the plan or result as JSON
  --root <path>         Workspace path
  --help                Show this help

Start with:
  npx filegrc guide --json
  # Use the next model version shown by the guide.`);
    return;
  }
  if (command === "program-readiness") {
    console.log(`Usage:
  filegrc program-readiness [options]

Report whether management has defined scope, activated policies, implemented
controls, and mapped every selected control to a configured authoritative evidence
source. No audit ID or CPA firm is required.

Options:
  --program <id>     Program to assess when more than one active Program exists
  --as-of <date>     Evaluate effective dates and obligations on YYYY-MM-DD
  --require-ready    Exit with code 2 unless the Evidence Ready gate passes
  --summary          Omit item details and print stage counts and next actions
  --json             Print the result as JSON
  --root <path>      Workspace path
  --help             Show this help`);
    return;
  }
  if (command === "workflow") {
    console.log(`Usage:
  filegrc workflow [audit-id] [options]

Return the shared assessment envelope used by browser, HTTP, CLI, static, and
agent workflows. Results include named assessments, normalized findings,
deterministic Work Items, and one recommended next action.

Options:
  --audit <id>       Limit audit assessments to one engagement
  --program <id>     Program to assess when no Audit supplies the Program
  --as-of <date>     Evaluate on YYYY-MM-DD
  --through <date>   Include scheduled work through YYYY-MM-DD
  --complete         Include completed Work Items
  --require-ready    Exit with code 2 unless Evidence Readiness passes
  --json             Print the versioned result envelope
  --root <path>      Workspace path
  --help             Show this help`);
    return;
  }
  if (command === "program-path") {
    console.log(`Usage:
  filegrc program-path [audit-id] [options]

Show the same five-step SOC 2 lifecycle used by the renderer. Each step includes
its exact page instructions, Use and Policy Basis context, resource commands,
and current readiness state. Pass an audit ID to include Step 5 status.

Options:
  --audit <id>       Audit record to use for Step 5
  --program <id>     Program to assess when no Audit supplies the Program
  --as-of <date>     Evaluate readiness on YYYY-MM-DD
  --summary          Print compact status and the first action for all five steps
  --next             Print only the current step and its first action
  --current          Print the full guide for the current step only
  --json             Print the selected path view as JSON
  --root <path>      Workspace path
  --help             Show this help`);
    return;
  }
  if (command === "activate-policies") {
    console.log(`Usage:
  filegrc activate-policies --scaffold [--program id]
  filegrc activate-policies <activation.json|-> [--effective-on YYYY-MM-DD] [--preview|--yes] [--json]

Review and atomically activate selected approved Policies at the end of Step 3.
The scaffold includes every required, approved, inactive Policy and its current
revision. A past effective date is rejected.

Options:
  --scaffold             Print a cutover payload without writing
  --program <id>         Program to assess when more than one active Program exists
  --effective-on <date>  Shared effective date for the selected Policies
  --preview              Validate and show the atomic updates without writing
  --yes                  Confirm and apply the reviewed cutover
  --json                 Print the result as JSON
  --root <path>          Workspace path
  --help                 Show this help`);
    return;
  }
  if (command === "activate-documents") {
    console.log(`Usage:
  filegrc activate-documents --scaffold [--program id | --audit id]
  filegrc activate-documents <activation.json|-> [--audit id] [--activated-by person-id] [--activated-on YYYY-MM-DD] [--effective-on YYYY-MM-DD] [--preview|--yes] [--json]

Activate required program Documents in Step 3 after their linked
Controls are implemented, or activate engagement Documents in Step 5 after
their audit-specific facts are complete. Approval, activation, and effective
dates remain separate, and activation binds its own exact Markdown revision.

Options:
  --scaffold             Print the ready activation payload without writing
  --program <id>         Program to assess when more than one active Program exists
  --audit <id>           Audit whose engagement Documents should be activated in Step 5
  --activated-by <id>    Active Person who performs the activation
  --activated-on <date>  Actual activation date, which must be today
  --effective-on <date>  Effective date on or after activation
  --preview              Validate and show the atomic updates without writing
  --yes                  Confirm and apply the reviewed activation
  --json                 Print the result as JSON
  --root <path>          Workspace path
  --help                 Show this help`);
    return;
  }
  if (command === "activate-content") {
    console.log(`Usage:
  filegrc activate-content --scaffold [--program id]
  filegrc activate-content <activation.json|-> [--resource id] [--activated-by person-id] [--activated-on YYYY-MM-DD] [--effective-on YYYY-MM-DD] [--preview|--yes] [--json]

Activate approved program Documents and Training in Step 3 after their linked
Controls are implemented and Training has an enabled assignment Obligation.
Approval, activation, and effective dates remain separate, and activation binds
the exact approved Markdown revision.

Options:
  --scaffold             Print the ready activation payload without writing
  --program <id>         Program to assess when more than one active Program exists
  --resource <id>        Comma-separated Document or Training IDs
  --activated-by <id>    Active Person who performs the activation
  --activated-on <date>  Actual activation date, which must be today
  --effective-on <date>  Effective date on or after activation
  --preview              Validate and show the atomic updates without writing
  --yes                  Confirm and apply the reviewed activation
  --json                 Print the result as JSON
  --root <path>          Workspace path
  --help                 Show this help`);
    return;
  }
  if (command === "policy-library") {
    console.log(`Usage:
  filegrc policy-library [--json]
  filegrc policy-library --accept <proposal-id> --proposal-revision <revision> --yes [--json]

Review optional starter-library updates for unchanged default Policy and Control
content. The review prints exact diffs. FileGRC skips customized or adopted Policy
content and writes nothing until you accept one named proposal revision with --yes.

Options:
  --accept <id>  Accept one proposal after reviewing its diff
  --proposal-revision <hash>  Confirm the exact reviewed proposal revision
  --yes          Confirm the named proposal write
  --json         Print the versioned proposal or acceptance result
  --root <path>  Workspace path
  --help         Show this help`);
    return;
  }
  if (command === "evidence-map") {
    console.log(`Usage:
  filegrc evidence-map [options]

Inspect the evidence-source checks included in Control implementation. Each item
reports the required source roles, linked Controls, authoritative source Components,
per-record checks, and exact edit commands. This diagnostic is read-only.

Options:
  --program <id>  Program to assess when more than one active Program exists
  --as-of <date>  Evaluate the map on YYYY-MM-DD
  --json          Print the map as JSON
  --root <path>   Workspace path
  --help         Show this help`);
    return;
  }
  printHelp();
}

function agentOverview(model) {
  const currentModelIndex = SUPPORTED_MODEL_VERSIONS.indexOf(String(model.modelVersion));
  const nextModelVersion = currentModelIndex >= 0 && currentModelIndex < SUPPORTED_MODEL_VERSIONS.length - 1
    ? SUPPORTED_MODEL_VERSIONS[currentModelIndex + 1]
    : ACTIVE_MODEL_VERSION;
  const commands = {
    help: "filegrc help",
    version: "filegrc version",
    serve: "filegrc serve [root]",
    setup: "filegrc setup [setup.json|-] [--draft] [--preview] [--summary] [--json]",
    build: "filegrc build [root]",
    validate: "filegrc validate [root] --json",
    model: "filegrc model --json",
    migrate: `filegrc migrate --to-model ${nextModelVersion} --preview --json`,
    describe: "filegrc describe <resource-type>",
    types: "filegrc types --json",
    guide: "filegrc guide [resource-type] --json",
    programPath: "filegrc program-path [audit-id] --next --json",
    workflow: "filegrc workflow [audit-id] --json",
    periodHealth: "filegrc period-health [audit-id] --require-healthy --json",
    milestoneCheck: "filegrc milestone-check --json",
    scaffold: "filegrc scaffold <resource-type> --title <name>",
    list: "filegrc list [resource-type] --json",
    search: "filegrc search <query> --json",
    obligations: "filegrc obligations --json",
    programReadiness: "filegrc program-readiness --json",
    evidenceMap: "filegrc evidence-map --json",
    auditReadiness: "filegrc audit-readiness <audit-id> --json",
    prepareAudit: "filegrc prepare-audit <audit-id>",
    reconcile: "filegrc reconcile --preview --json",
    externalReviewerSetup: "filegrc external-reviewer-setup [--scaffold | <reviewer.json|-> --preview] --json",
    policyActivation: "filegrc activate-policies [--scaffold | <activation.json|-> --preview] --json",
    documentActivation: "filegrc activate-documents [--scaffold | <activation.json|-> --preview] --json",
    governedContentActivation: "filegrc activate-content [--scaffold | <activation.json|-> --preview] --json",
    nextAuditCycle: "filegrc next-audit-cycle <prior-audit-id> --start <date> --end <date> --preview --json",
    reviewApplicability: "filegrc review-applicability <decisions.json|-> --preview --json",
    reviewCollection: "filegrc review-collection <resource-type> [--scaffold | <review.json|-> --preview] --json",
    trigger: "filegrc trigger <event-type> <date-or-time-and-subject-flags>",
    evidencePacket: "filegrc evidence-packet --audit <audit-id> --preview --json",
    get: "filegrc get <resource-id> [--mutation]",
    references: "filegrc references <resource-id> --json",
    previewMutation: "filegrc preview-mutation <preview.json> --json",
    create: "filegrc create <mutation.json>",
    complete: "filegrc complete <obligation-id> <completion-mutation.json>",
    completeAction: "filegrc complete-action <action-item-id> <completion-mutation.json> --completed-on <date>",
    completeEvent: "filegrc complete-event <obligation-event-id> --completed-on <date>",
    update: "filegrc update <resource-type> <id> <mutation.json>",
    content: "filegrc content <resource-type> <id> [slot] [--write <markdown-file|->]",
    attach: "filegrc attach <evidence-id> <source-file> [--name <file-name>]",
    detach: "filegrc detach <evidence-id> <attachment-name> --yes",
    delete: "filegrc delete <resource-type> <id> --yes",
    commit: "git diff --check && git diff && git add <reviewed-paths> && git commit -m <reason>"
  };
  return {
    rule: "Treat data/ as the source of truth. Run guide before creating an unfamiliar type, validate after every write, review the Git diff, then commit a focused change.",
    programPath: buildAgentProgramPath(model),
    actions: Object.fromEntries(Object.entries(commands).map(([name, command]) => [
      name,
      command.startsWith("filegrc ") ? `npx ${command}` : command
    ])),
    resourceTypes: listResourceTypes(model).map(({ type, title, group }) => ({ type, title, group }))
  };
}

function printAgentOverview(result) {
  console.log(result.rule);
  console.log("\nProgram path:");
  for (const stage of result.programPath) console.log(`${stage.number}. ${stage.title}\t${stage.summary}`);
  console.log("\nActions:");
  for (const [name, command] of Object.entries(result.actions)) console.log(`${name}\t${command}`);
  console.log("\nResource types:");
  for (const item of result.resourceTypes) console.log(`${item.type}\t${item.title}\t${item.group ?? ""}`);
}

function printAgentGuide(result) {
  console.log(`${result.title} (${result.type})`);
  if (result.programStep) {
    console.log(`Program step: ${result.programStep.order ? `Step ${result.programStep.order}` : `Step ${result.programStep.number}`} · ${result.programStep.title}`);
  }
  console.log(`Instructions: ${result.instructions}`);
  console.log(`Use: ${result.use}`);
  console.log(`Policy basis: ${result.policyBasis}`);
  console.log(`Timing: ${result.cadence}`);
  console.log(`JSON: ${result.location}`);
  if (result.reviewRequirements.collectionReview) {
    const review = result.reviewRequirements.collectionReview;
    console.log(`\nCollection review: ${review.title} (${review.status}, ${review.recordCount} ${review.recordCount === 1 ? "record" : "records"})`);
    console.log(review.description);
    for (const point of review.reviewPoints) console.log(`- ${point}`);
    console.log(`Action: ${review.command}`);
  }
  if (result.reviewRequirements.recordReviewPoints.length) {
    console.log("\nWhen reviewing each record:");
    for (const point of result.reviewRequirements.recordReviewPoints) console.log(`- ${point}`);
  }
  console.log("\nRequired fields:");
  for (const field of result.requiredAtCreation) console.log(formatGuideField(field));
  if (result.conditionalRequirements.length) {
    console.log("\nConditional fields:");
    for (const field of result.conditionalRequirements) console.log(formatGuideField(field));
  }
  if (result.optionalFields.length) {
    console.log("\nOptional fields:");
    for (const field of result.optionalFields) console.log(formatGuideField(field));
  }
  if (result.markdown.length) {
    console.log("\nMarkdown:");
    for (const slot of result.markdown) {
      console.log(`${slot.name}\t${slot.required ? "required" : slot.recommended ? "recommended" : "optional"}\t${slot.path}`);
    }
  }
  const relationshipFields = [
    ...result.requiredAtCreation,
    ...result.conditionalRequirements,
    ...result.optionalFields
  ].filter(({ relation }) => relation);
  if (relationshipFields.length) {
    console.log("\nRelationship candidates:");
    for (const field of relationshipFields) {
      const hasCandidates = field.relation.candidates.length > 0;
      const suffix = field.relation.truncated && hasCandidates
        ? `, … (${field.relation.candidateCount} total; use npx filegrc list)`
        : "";
      const candidates = hasCandidates
        ? field.relation.candidates.join(", ") + suffix
        : field.relation.candidateCount
          ? `use npx filegrc list (${field.relation.candidateCount} possible)`
          : "none";
      console.log(`${field.name}\t${field.relation.types.join("|")}\t${candidates}`);
    }
  }
  console.log("\nWorkflow:");
  result.workflow.forEach((step, index) => console.log(`${index + 1}. ${step}`));
  console.log("\nCompletion checks:");
  result.completionChecks.forEach((check) => console.log(`- ${check}`));
}

function buildProgramPathResult(model, readiness, auditReadiness) {
  const readinessById = new Map(readiness.stages.map((stage) => [stage.id, stage]));
  const stages = buildAgentProgramPath(model).map((stage) => {
    if (stage.id === "audit") {
      const auditAction = auditReadiness?.firstAction || (
        auditReadiness?.status === "not-started"
          ? {
              id: "create-audit",
              status: "action",
              title: "Create the planned CPA engagement",
              message: "Create a planned Audit from the current management scope, then replace the remaining scaffold values with the CPA firm and firm-agreed scope and dates.",
              resourceType: "audit",
              commands: [
                "npx filegrc guide audit --json",
                "npx filegrc scaffold audit --title \"YEAR SOC 2 TYPE\" > audit-mutation.json",
                "npx filegrc create audit-mutation.json --json",
                "npx filegrc prepare-audit AUDIT_ID --json"
              ]
            }
          : null
      );
      return {
        ...stage,
        status: auditReadiness?.status || "not-started",
        counts: auditReadiness?.counts || null,
        nextActions: auditAction ? [auditAction] : []
      };
    }
    const readinessId = stage.id === "run" ? "operation" : stage.id;
    const current = readinessById.get(readinessId);
    const status = stage.id === "run" && readiness.operating
      ? "operating"
      : current?.status || "not-started";
    return {
      ...stage,
      status,
      counts: current?.counts || null,
      nextActions: (current?.items || []).filter((item) => item.status === "action")
    };
  });
  const currentStep = stages.find((stage) => !["complete", "operating", "management-ready"].includes(stage.status)) || stages.at(-1);
  return {
    schemaVersion: 1,
    dataModelVersion: String(model.modelVersion),
    asOf: readiness.asOf,
    currentStep: { id: currentStep.id, number: currentStep.number, title: currentStep.title },
    evidenceReady: readiness.evidenceReady,
    operating: readiness.operating,
    policyActivations: readiness.policyActivations,
    documentActivations: readiness.documentActivations,
    trainingActivations: readiness.trainingActivations,
    policyLibraryProposals: readiness.policyLibraryProposals,
    stages
  };
}

function printProgramPath(result) {
  console.log(`Current: Step ${result.currentStep.number}, ${result.currentStep.title}`);
  console.log(`Evidence Ready: ${result.evidenceReady ? "yes" : "no"}; operating: ${result.operating ? "yes" : "no"}`);
  for (const stage of result.stages) {
    console.log(`\nStep ${stage.number}. ${stage.title} [${String(stage.status).toUpperCase()}]`);
    console.log(stage.summary);
    for (const page of stage.pages) {
      console.log(`${page.order ? `Step ${page.order}` : "Operating area"} · ${page.title} (${page.type || `utility:${page.utility}`})`);
      console.log(`  ${page.summary}`);
      if (page.guide) console.log(`  Details: ${page.guide}`);
    }
    if (stage.operatingRecords?.length) {
      console.log("Operating record guides:");
      for (const record of stage.operatingRecords) {
        console.log(`  ${record.type}\t${record.summary}\t${record.guide}`);
      }
    }
    console.log("Commands:");
    for (const command of stage.commands) console.log(`  ${command}`);
    for (const action of stage.nextActions) console.log(`Next: ${action.title} · ${action.message}`);
  }
}

function selectProgramPathOutput(result, flags) {
  const modes = ["summary", "next", "current"].filter((name) => flags[name]);
  if (modes.length > 1) throw new Error("Use only one of --summary, --next, or --current.");
  if (flags.summary) return summarizeProgramPath(result);
  if (flags.next) return nextProgramPath(result);
  if (flags.current) {
    const stage = result.stages.find(({ id }) => id === result.currentStep.id);
    return { ...result, stages: stage ? [stage] : [] };
  }
  return result;
}

function summarizeProgramPath(result) {
  return {
    schemaVersion: result.schemaVersion,
    dataModelVersion: result.dataModelVersion,
    asOf: result.asOf,
    currentStep: result.currentStep,
    evidenceReady: result.evidenceReady,
    operating: result.operating,
    policyActivations: result.policyActivations,
    policyLibraryProposals: result.policyLibraryProposals,
    stages: result.stages.map((stage) => ({
      id: stage.id,
      number: stage.number,
      title: stage.title,
      status: stage.status,
      counts: stage.counts,
      nextAction: summarizePathAction(stage.nextActions[0])
    }))
  };
}

function nextProgramPath(result) {
  const stage = result.stages.find(({ id }) => id === result.currentStep.id);
  const nextAction = stage?.nextActions[0];
  return {
    schemaVersion: result.schemaVersion,
    dataModelVersion: result.dataModelVersion,
    asOf: result.asOf,
    currentStep: result.currentStep,
    evidenceReady: result.evidenceReady,
    operating: result.operating,
    policyActivations: result.policyActivations,
    policyLibraryProposals: result.policyLibraryProposals,
    step: stage ? {
      id: stage.id,
      number: stage.number,
      title: stage.title,
      status: stage.status,
      summary: stage.summary,
      nextAction: summarizePathAction(nextAction),
      commands: nextActionCommands(stage, nextAction)
    } : null
  };
}

function summarizePathAction(action) {
  if (!action) return null;
  return {
    id: action.id,
    status: action.status,
    title: action.title,
    message: action.message,
    ...(action.resourceType ? { resourceType: action.resourceType } : {}),
    ...(action.resourceId ? { resourceId: action.resourceId } : {})
  };
}

function nextActionCommands(stage, action) {
  if (action?.commands?.length) return action.commands;
  if (!action?.resourceType) return stage.commands;
  const resourceType = shellArgument(action.resourceType);
  const commands = [`npx filegrc guide ${resourceType} --json`];
  if (action.resourceId) {
    const resourceId = shellArgument(action.resourceId);
    commands.push(`npx filegrc get ${resourceId} --mutation`);
    commands.push(`npx filegrc update ${resourceType} ${resourceId} MUTATION.json --json`);
  } else {
    commands.push(`npx filegrc list ${resourceType} --json`);
    commands.push(`npx filegrc scaffold ${resourceType} --title "NAME"`);
    commands.push("npx filegrc create MUTATION.json --json");
  }
  return commands;
}

function shellArgument(value) {
  const text = String(value);
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text)
    ? text
    : `'${text.replaceAll("'", "'\\''")}'`;
}

function evidenceSourceCheckName(name) {
  return ({
    active: "activate source",
    sourceRole: "add source role",
    accessOwners: "add access owner",
    retrievalInstructions: "add retrieval instructions"
  })[name] || name;
}

function printProgramPathOutput(result, flags) {
  if (flags.summary) {
    console.log(`Current: Step ${result.currentStep.number}, ${result.currentStep.title}`);
    for (const stage of result.stages) {
      console.log(`${String(stage.status).toUpperCase()}\tStep ${stage.number}\t${stage.title}`);
    }
    const current = result.stages.find(({ id }) => id === result.currentStep.id);
    if (current?.nextAction) console.log(`Next: ${current.nextAction.title} · ${current.nextAction.message}`);
    return;
  }
  if (flags.next) {
    console.log(`Current: Step ${result.currentStep.number}, ${result.currentStep.title}`);
    if (result.step?.nextAction) {
      console.log(`Next: ${result.step.nextAction.title} · ${result.step.nextAction.message}`);
    }
    for (const command of result.step?.commands || []) console.log(`  ${command}`);
    return;
  }
  printProgramPath(result);
}

function printWorkflow(result) {
  console.log(`Workflow contract v${result.contractVersion}, model v${result.dataModelVersion}`);
  for (const [name, assessment] of Object.entries(result.assessments)) {
    console.log(`${String(assessment.status).toUpperCase()}\t${name}\t${assessment.message}`);
  }
  console.log(`\n${result.counts.findings.ready || 0} ready findings, ${result.counts.workItems.overdue || 0} overdue Work Items`);
  if (result.recommended) {
    console.log(`Next: ${result.recommended.title}`);
    if (result.recommended.message) console.log(`  ${result.recommended.message}`);
    const command = result.recommended.nextAction?.command || result.recommended.actions?.[0]?.command;
    if (command) console.log(`  ${command}`);
  }
}

function summarizeProgramReadiness(result) {
  const ownership = result.stages
    .flatMap((stage) => stage.items)
    .find((item) => item.id === "program-ownership");
  const summarizeItem = (item, options = {}) => item ? {
    id: item.id,
    status: item.status,
    title: item.title,
    ...(options.message === false ? {} : { message: item.message }),
    ...(item.resourceType ? { resourceType: item.resourceType } : {}),
    ...(item.resourceId ? { resourceId: item.resourceId } : {})
  } : null;
  const unresolvedOwnership = ownership?.unresolvedAssignments || [];
  const ownershipReasons = unresolvedOwnership
    .flatMap((assignment) => assignment.reasons || [])
    .reduce((counts, { reason }) => ({ ...counts, [reason]: (counts[reason] || 0) + 1 }), {});
  return {
    schemaVersion: result.schemaVersion,
    generatedAt: result.generatedAt,
    asOf: result.asOf,
    status: result.status,
    evidenceReady: result.evidenceReady,
    operating: result.operating,
    canStartCandidatePeriod: result.canStartCandidatePeriod,
    suggestedCandidatePeriodStart: result.suggestedCandidatePeriodStart,
    target: result.target,
    progress: result.progress,
    counts: result.counts,
    scopeCounts: Object.fromEntries(
      Object.entries(result.scope).map(([name, ids]) => [name.replace(/Ids$/, ""), ids.length])
    ),
    policyActivations: result.policyActivations.map(({ policyId, title, state, label, gapCount }) => ({
      policyId,
      title,
      state,
      label,
      gapCount
    })),
    documentActivations: result.documentActivations.map(({ documentId, title, state, label, gapCount }) => ({
      documentId,
      title,
      state,
      label,
      gapCount
    })),
    trainingActivations: result.trainingActivations.map(({ trainingId, title, state, label, gapCount, assignmentScheduled }) => ({
      trainingId,
      title,
      state,
      label,
      gapCount,
      assignmentScheduled
    })),
    policyLibraryProposals: result.policyLibraryProposals,
    unresolvedOwnership: {
      count: unresolvedOwnership.length,
      byReason: ownershipReasons,
      resourceIds: unresolvedOwnership.map(({ resourceId }) => resourceId)
    },
    firstAction: summarizeItem(result.firstAction),
    stages: result.stages.map((stage) => ({
      id: stage.id,
      title: stage.title,
      status: stage.status,
      counts: stage.counts,
      firstAction: summarizeItem(stage.items.find(({ status }) => status === "action"), { message: false })
    }))
  };
}

function eventWindowText(window) {
  if (!Number.isInteger(window?.dueAfter)) return "deadline not configured";
  const unit = window.precision === "timestamp" ? "hour" : "day";
  if (window.dueAfter === 0) return window.precision === "timestamp" ? "due at event time" : "due on event date";
  return `due within ${window.dueAfter} ${unit}${window.dueAfter === 1 ? "" : "s"}`;
}

function formatGuideField(field) {
  const details = [
    field.values?.length ? `one of ${field.values.join("|")}` : field.type,
    field.requiredWhen ? `required when ${JSON.stringify(field.requiredWhen)}` : null,
    field.disjointFrom ? `must not overlap ${field.disjointFrom}` : null
  ].filter(Boolean).join("; ");
  return `${field.name}\t${details}`;
}
