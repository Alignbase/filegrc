import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { loadModel } from "../model/index.js";
import { buildAgentGuide, findResourceReferences, listResourceTypes, scaffoldResourceMutation } from "./agent.js";
import { assessAuditPreparation, prepareAuditWorkspace } from "./audit-preparation.js";
import { buildWorkspace } from "./build.js";
import { generateEvidencePacket, prepareEvidencePacket } from "./evidence-packet.js";
import { ensureEvidenceTestDrafts, previewEvidenceTestDrafts } from "./evidence-tests.js";
import {
  addEvidenceAttachment,
  createResource,
  deleteResource,
  removeEvidenceAttachment,
  updateResource
} from "./files.js";
import { generateModelDocumentation } from "./model-docs.js";
import {
  completeObligationAction,
  completeObligationEvent,
  completeObligationOccurrence,
  createObligationEvent,
  planObligations
} from "./obligations.js";
import { relativeToWorkspace, resolveDataPath } from "./paths.js";
import { buildAgentProgramPath, policyEventName } from "./program-path.js";
import { assessProgramReadiness } from "./program-readiness.js";
import { markdownEntries } from "./resource-markdown.js";
import { searchResources } from "./search.js";
import { serveWorkspace } from "./server.js";
import { planWorkspaceSetup, setupWorkspace, summarizeSetupResult } from "./setup.js";
import { printGithubStarMessage } from "./startup.js";
import { createAppState } from "./state.js";
import { currentCalendarDate } from "./time.js";
import { validateWorkspace } from "./validate.js";
import { loadWorkspace } from "./workspace.js";

const BOOLEAN_FLAGS = new Set([
  "allow-non-authoritative-writes",
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
  "summary",
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
      ...(flags.classification !== undefined ? { dataClassification: flags.classification } : {}),
      ...(flags["internet-exposed"] !== undefined ? { internetExposed: flags["internet-exposed"] } : {}),
      ...(flags["program-goal"] !== undefined ? { programGoal: flags["program-goal"] } : {}),
      ...(flags.draft ? { draft: true } : {})
    });
    const result = flags.preview
      ? await planWorkspaceSetup(root, setupInput)
      : await setupWorkspace(root, setupInput);
    const output = flags.summary && !flags.preview ? summarizeSetupResult(result) : result;
    if (flags.json) console.log(JSON.stringify(output, null, 2));
    else if (flags.preview) {
      console.log(`Setup preview: ${result.changes.system} system ${result.system.id}; update workspace target to ${result.target.assuranceGoal}.`);
      console.log("No controls will be linked and no evidence drafts will be created.");
    }
    else {
      console.log(`${result.draft ? "Saved draft scope" : "Completed initial setup"} for ${result.system.title}.`);
      console.log(`System: ${result.system.id} (${result.system.status})`);
      if (result.draft) {
        console.log("Planned and in scope means selected for scope review, not approved or active.");
      }
      console.log(`Target: ${result.workspace.assuranceGoal}`);
      console.log("Next: finish Step 1 by confirming people, criteria, commitments, vendors, and in-scope systems. Run npx filegrc program-path --next --json.");
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
    const result = buildAgentGuide(loaded, type, { id: flags.id });
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else printAgentGuide(result);
    return result;
  }
  if (command === "program-path") {
    const loaded = await loadWorkspace(root);
    const readiness = await assessProgramReadiness(loaded, { asOf: flags["as-of"] });
    const auditId = positionals[0] || flags.audit;
    const auditReadiness = auditId ? await assessAuditPreparation(loaded, { auditId }) : null;
    const result = buildProgramPathResult(loaded.model, readiness, auditReadiness);
    const output = selectProgramPathOutput(result, flags);
    if (flags.json) console.log(JSON.stringify(output, null, 2));
    else printProgramPathOutput(output, flags);
    return output;
  }
  if (command === "scaffold") {
    const loaded = await loadWorkspace(root);
    const type = positionals[0];
    const result = scaffoldResourceMutation(loaded, type, flags.title, { id: flags.id });
    console.log(JSON.stringify(result, null, 2));
    return result;
  }
  if (command === "list") {
    const loaded = await loadWorkspace(root);
    const type = positionals[0];
    if (type && !loaded.model.resources[type]) throw new Error(`Unknown resource type "${type}".`);
    const records = loaded.resources
      .filter((record) => !type || record.type === type)
      .sort((left, right) => `${left.type}:${left.title}:${left.id}`.localeCompare(`${right.type}:${right.title}:${right.id}`));
    if (flags.json) console.log(JSON.stringify(records, null, 2));
    else for (const record of records) console.log(`${record.id}\t${record.type}\t${record.status ?? ""}\t${record.title}`);
    return records;
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
      includeComplete: Boolean(flags.complete)
    });
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`${result.counts.overdue} overdue, ${result.counts.due} due, ${result.counts.upcoming} upcoming, ${result.counts.proposed} starter proposals`);
      for (const item of result.items) {
        const deadline = item.dueWindowEndAt || item.dueWindowEnd;
        if (!deadline) throw new Error(`Planned work "${item.title}" is missing a deadline.`);
        console.log([
          item.status.toUpperCase(),
          item.dueWindowStartAt || item.dueWindowStart,
          deadline,
          item.title,
          item.actionItemId || item.obligationId
        ].join("\t"));
      }
      if (result.triggers.length) {
        console.log("\nPolicy Events:");
        for (const trigger of result.triggers) {
          console.log(`${trigger.programStatus.toUpperCase()}\t${policyEventName(trigger.eventType)} (${trigger.eventType})\t${trigger.steps.length} Work Queue ${trigger.steps.length === 1 ? "task" : "tasks"}`);
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
    const result = await assessProgramReadiness(loaded, { asOf: flags["as-of"] });
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
      console.log(`${result.target.label}${result.target.candidatePeriodStart ? `, candidate period starts ${result.target.candidatePeriodStart}` : ""}`);
      for (const stage of result.stages) {
        console.log(`\n${stage.title}`);
        for (const item of stage.items) console.log(`${item.status.toUpperCase()}\t${item.title}\t${item.message}`);
      }
      if (result.canStartCandidatePeriod && !result.operating) {
        console.log(`\nEvidence Ready: management can start the candidate Type 2 period on or after ${result.suggestedCandidatePeriodStart || result.asOf}.`);
      }
    }
    if (flags["require-ready"] && !result.evidenceReady) process.exitCode = 2;
    return output;
  }
  if (command === "evidence-test-drafts") {
    if (flags.preview) {
      const loaded = await loadWorkspace(root);
      const result = previewEvidenceTestDrafts(loaded);
      if (flags.json) console.log(JSON.stringify(result, null, 2));
      else console.log(`Evidence draft preview: create ${result.create.length}; preserve ${result.existing.length}.`);
      return result;
    }
    const result = await ensureEvidenceTestDrafts(root);
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`Created ${result.created.length} External Evidence test ${result.created.length === 1 ? "draft" : "drafts"}; ${result.total} required families are represented.`);
    return result;
  }
  if (command === "audit-readiness") {
    const loaded = await loadWorkspace(root);
    const result = await assessAuditPreparation(loaded, { auditId: positionals[0] || flags.audit });
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
    const result = await prepareAuditWorkspace(root, { auditId });
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`Prepared ${result.auditId}: linked ${result.linkedDocumentIds.length} management documents and created ${result.createdPopulationIds.length} population records.`);
    return result;
  }
  if (command === "trigger") {
    const result = await createObligationEvent(root, {
      eventType: positionals[0],
      occurredOn: flags["occurred-on"],
      occurredAt: flags["occurred-at"],
      subjectResourceIds: String(flags.subject || "").split(",").map((value) => value.trim()).filter(Boolean),
      title: flags.title
    });
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`Work added to the Work Queue: ${result.actions.length} ${result.actions.length === 1 ? "task" : "tasks"} created for ${result.event.title}.`);
      console.log(`Event: obligation-event/${result.event.id}`);
      for (const action of result.actions) console.log(`Task: action-item/${action.id}\t${action.title}\t${action.dueWindowEndAt || action.dueWindowEnd || action.overdueAt || action.overdueOn}`);
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
    console.log(JSON.stringify(record, null, 2));
    return record;
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
  if (command === "create") {
    const mutation = await readMutation(positionals[0]);
    const result = await createResource(root, mutation.record, { content: mutation.content });
    if (flags.json) console.log(JSON.stringify({ record: result.record }, null, 2));
    else console.log(`Created ${result.record.type}/${result.record.id}`);
    return result;
  }
  if (command === "complete") {
    const [obligationId, file] = positionals;
    const mutation = await readMutation(file);
    const result = await completeObligationOccurrence(root, {
      obligationId,
      record: mutation.record,
      content: mutation.content,
      expectedRevision: flags["expected-revision"]
    });
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`Created ${result.created.type}/${result.created.id} and linked it to obligation/${obligationId}`);
    return result;
  }
  if (command === "complete-action") {
    const [actionItemId, file] = positionals;
    const mutation = await readMutation(file);
    const result = await completeObligationAction(root, {
      actionItemId,
      completedOn: flags["completed-on"],
      record: mutation.record,
      content: mutation.content,
      expectedRevision: flags["expected-revision"]
    });
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`Created ${result.created.type}/${result.created.id}, linked it to action-item/${actionItemId}, and marked the action done.`);
    return result;
  }
  if (command === "complete-event") {
    const eventId = positionals[0];
    if (!eventId) throw new Error("A Policy Event ID is required.");
    const result = await completeObligationEvent(root, {
      eventId,
      completedOn: flags["completed-on"],
      expectedRevision: flags["expected-revision"]
    });
    if (flags.json) console.log(JSON.stringify({ record: result.record }, null, 2));
    else console.log(`Marked obligation-event/${eventId} complete.`);
    return result;
  }
  if (command === "update") {
    const [type, id, file] = positionals;
    const mutation = await readMutation(file);
    const result = await updateResource(root, type, id, mutation.record, {
      content: mutation.content,
      expectedRevision: mutation.revision,
      expectedContentRevisions: mutation.contentRevisions
    });
    if (flags.json) console.log(JSON.stringify({ record: result.record }, null, 2));
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
      await updateResource(root, type, id, record, {
        content: { [slot.name]: source },
        expectedRevision: stateEntry.revision,
        expectedContentRevisions: existingContentRevision
          ? { [slot.path]: flags["expected-revision"] ?? existingContentRevision }
          : undefined
      });
      const result = { type, id, slot: slot.name, path: `data/${slot.path}`, written: true };
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
    const result = await addEvidenceAttachment(root, evidenceId, sourcePath, {
      name: flags.name,
      expectedRevision: flags["expected-revision"]
    });
    const output = {
      evidenceId,
      path: `data/${result.dataRelativePath}`,
      filePaths: result.record.filePaths
    };
    if (flags.json) console.log(JSON.stringify(output, null, 2));
    else console.log(`Attached ${output.path} to evidence/${evidenceId}`);
    return output;
  }
  if (command === "detach") {
    const [evidenceId, attachment] = positionals;
    if (!evidenceId || !attachment) throw new Error("An evidence ID and attachment name are required.");
    if (!flags.yes) throw new Error("Pass --yes to confirm attachment removal.");
    const result = await removeEvidenceAttachment(root, evidenceId, attachment, {
      expectedRevision: flags["expected-revision"]
    });
    const output = {
      evidenceId,
      removed: `data/${result.dataRelativePath}`,
      filePaths: result.record.filePaths ?? []
    };
    if (flags.json) console.log(JSON.stringify(output, null, 2));
    else console.log(`Detached and removed ${output.removed} from evidence/${evidenceId}`);
    return output;
  }
  if (command === "delete") {
    const [type, id] = positionals;
    if (!flags.yes) throw new Error("Pass --yes to confirm deletion. Preserve historical records unless this is a mistake or uncommitted draft.");
    await deleteResource(root, type, id, { expectedRevision: flags["expected-revision"] });
    console.log(`Deleted ${type}/${id}`);
    return;
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

async function readMutation(path) {
  if (!path) throw new Error("A JSON file path or - is required.");
  const source = path === "-" ? await readStdin() : await readFile(resolve(path), "utf8");
  const parsed = JSON.parse(source);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("A resource record or { record, content } mutation object is required.");
  }
  if (!Object.hasOwn(parsed, "record")) {
    return { record: parsed, content: undefined, revision: undefined, contentRevisions: undefined };
  }
  if (!parsed.record || Array.isArray(parsed.record) || typeof parsed.record !== "object") {
    throw new Error("Mutation record must be a JSON object.");
  }
  if (parsed.content !== undefined && (Array.isArray(parsed.content) || typeof parsed.content !== "object" || parsed.content === null)) {
    throw new Error("Mutation content must be an object keyed by Markdown slot.");
  }
  if (parsed.revision !== undefined && typeof parsed.revision !== "string") {
    throw new Error("Mutation revision must be a string.");
  }
  if (
    parsed.contentRevisions !== undefined
    && (Array.isArray(parsed.contentRevisions) || typeof parsed.contentRevisions !== "object" || parsed.contentRevisions === null)
  ) {
    throw new Error("Mutation contentRevisions must be an object keyed by data-relative Markdown path.");
  }
  return {
    record: parsed.record,
    content: parsed.content,
    revision: parsed.revision,
    contentRevisions: parsed.contentRevisions
  };
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
    result.dataClassification ||= classifications.length
      ? await askChoice(
        "Data classification",
        classifications,
        classifications.includes("Confidential") ? "Confidential" : classifications[0]
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
  filegrc describe <resource-type>
  filegrc types [--json]
  filegrc guide [resource-type] [--id resource-id] [--json]
  filegrc program-path [audit-id] [--as-of YYYY-MM-DD] [--summary|--next|--current] [--json]
  filegrc scaffold <resource-type> --title text [--id resource-id]
  filegrc list [resource-type] [--json]
  filegrc search <query> [--type resource-type] [--json]
  filegrc obligations [--as-of YYYY-MM-DD] [--from YYYY-MM-DD] [--through YYYY-MM-DD] [--now RFC3339] [--complete] [--json]
  filegrc program-readiness [--as-of YYYY-MM-DD] [--require-ready] [--summary] [--json]
  filegrc evidence-test-drafts [--preview] [--json]
  filegrc audit-readiness [audit-id] [--require-ready] [--json]
  filegrc prepare-audit <audit-id> [--json]
  filegrc trigger <event-type> (--occurred-on YYYY-MM-DD | --occurred-at RFC3339) [--subject resource-id[,resource-id]] [--title text] [--json]
  filegrc evidence-packet [--audit audit-id] [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--output .filegrc/path] [--preview] [--require-ready] [--json]
  filegrc get [resource-type] <id> [--mutation]
  filegrc references <id> [--json]
  filegrc create <record-or-mutation.json|-> [--json]
  filegrc complete <obligation-id> <completion-record.json|-> [--expected-revision hash] [--json]
  filegrc complete-action <action-item-id> <completion-record.json|-> --completed-on YYYY-MM-DD [--expected-revision hash] [--json]
  filegrc complete-event <obligation-event-id> --completed-on YYYY-MM-DD [--expected-revision hash] [--json]
  filegrc update <resource-type> <id> <record-or-mutation.json|-> [--json]
  filegrc content <resource-type> <id> [slot] [--write markdown-file|-] [--expected-revision hash] [--json]
  filegrc attach <evidence-id> <source-file> [--name file-name] [--expected-revision hash] [--json]
  filegrc detach <evidence-id> <attachment-name> --yes [--expected-revision hash] [--json]
  filegrc delete <resource-type> <id> --yes [--expected-revision hash]

All commands accept --root <workspace>. Writes never create Git commits.`);
}

function printCommandHelp(command) {
  if (command === "serve") {
    console.log(`Usage:
  filegrc serve [root] [--host address] [--port number] [--allow-non-authoritative-writes]

Options:
  --host <address>  Bind address. Defaults to FILEGRC_HOST or 127.0.0.1.
  --port <number>   Port. Defaults to FILEGRC_PORT or 8787. Use 0 for an available port.
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
  --classification <name>     dataClassification
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
  if (command === "program-readiness") {
    console.log(`Usage:
  filegrc program-readiness [options]

Report whether management has defined scope, activated policies, implemented
controls, configured authoritative evidence sources, and verified test collection
for external evidence without a dedicated Step 5 record. No audit ID or CPA firm
is required.

Options:
  --as-of <date>     Evaluate effective dates and obligations on YYYY-MM-DD
  --require-ready    Exit with code 2 unless the Evidence Ready gate passes
  --summary          Omit item details and print stage counts and next actions
  --json             Print the result as JSON
  --root <path>      Workspace path
  --help             Show this help`);
    return;
  }
  if (command === "program-path") {
    console.log(`Usage:
  filegrc program-path [audit-id] [options]

Show the same six-step SOC 2 lifecycle used by the renderer. Each step includes
its exact page instructions, Use and Policy Basis context, resource commands,
and current readiness state. Pass an audit ID to include Step 6 status.

Options:
  --audit <id>       Audit record to use for Step 6
  --as-of <date>     Evaluate readiness on YYYY-MM-DD
  --summary          Print compact status and the first action for all six steps
  --next             Print only the current step and its first action
  --current          Print the full guide for the current step only
  --json             Print the selected path view as JSON
  --root <path>      Workspace path
  --help             Show this help`);
    return;
  }
  if (command === "evidence-test-drafts") {
    console.log(`Usage:
  filegrc evidence-test-drafts [options]

Preview or create missing draft External Evidence records for collection that
does not already have a dedicated Step 5 operating record. Existing tests are
preserved. Run after confirming applicable controls and source systems. Preview
the proposed family, evidence kind, collection prompt, and linked controls first,
then run the command without --preview to create the missing drafts.

Options:
  --preview      Report proposed drafts without creating them
  --json         Print created and existing records as JSON
  --root <path>  Workspace path
  --help         Show this help`);
    return;
  }
  printHelp();
}

function agentOverview(model) {
  const commands = {
    help: "filegrc help",
    version: "filegrc version",
    serve: "filegrc serve [root]",
    setup: "filegrc setup [setup.json|-] [--draft] [--preview] [--summary] [--json]",
    build: "filegrc build [root]",
    validate: "filegrc validate [root] --json",
    model: "filegrc model --json",
    describe: "filegrc describe <resource-type>",
    types: "filegrc types --json",
    guide: "filegrc guide [resource-type] --json",
    programPath: "filegrc program-path [audit-id] --next --json",
    scaffold: "filegrc scaffold <resource-type> --title <name>",
    list: "filegrc list [resource-type] --json",
    search: "filegrc search <query> --json",
    obligations: "filegrc obligations --json",
    programReadiness: "filegrc program-readiness --json",
    evidenceTestDrafts: "filegrc evidence-test-drafts [--preview] [--json]",
    auditReadiness: "filegrc audit-readiness <audit-id> --json",
    prepareAudit: "filegrc prepare-audit <audit-id>",
    trigger: "filegrc trigger <event-type> <date-or-time-and-subject-flags>",
    evidencePacket: "filegrc evidence-packet --audit <audit-id> --preview --json",
    get: "filegrc get <resource-id> [--mutation]",
    references: "filegrc references <resource-id> --json",
    create: "filegrc create <record-or-mutation.json>",
    complete: "filegrc complete <obligation-id> <completion-mutation.json>",
    completeAction: "filegrc complete-action <action-item-id> <completion-mutation.json> --completed-on <date>",
    completeEvent: "filegrc complete-event <obligation-event-id> --completed-on <date>",
    update: "filegrc update <resource-type> <id> <record-or-mutation.json>",
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
}

function buildProgramPathResult(model, readiness, auditReadiness) {
  const readinessById = new Map(readiness.stages.map((stage) => [stage.id, stage]));
  const stages = buildAgentProgramPath(model).map((stage) => {
    if (stage.id === "audit") {
      return {
        ...stage,
        status: auditReadiness?.status || "not-started",
        counts: auditReadiness?.counts || null,
        nextActions: auditReadiness?.firstAction ? [auditReadiness.firstAction] : []
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
    asOf: readiness.asOf,
    currentStep: { id: currentStep.id, number: currentStep.number, title: currentStep.title },
    evidenceReady: readiness.evidenceReady,
    operating: readiness.operating,
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
      console.log(`  Instructions: ${page.instructions}`);
      console.log(`  Use: ${page.use}`);
      console.log(`  Policy basis: ${page.policyBasis}`);
    }
    if (stage.operatingRecords?.length) {
      console.log("Operating record guides:");
      for (const record of stage.operatingRecords) {
        console.log(`  ${record.type}\t${record.instructions}\t${record.guide}`);
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
    asOf: result.asOf,
    currentStep: result.currentStep,
    evidenceReady: result.evidenceReady,
    operating: result.operating,
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
    asOf: result.asOf,
    currentStep: result.currentStep,
    evidenceReady: result.evidenceReady,
    operating: result.operating,
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
  if (Number.isInteger(window?.endOffsetHours)) {
    return window.endOffsetHours === 0 ? "due at event time" : `due within ${window.endOffsetHours} hours`;
  }
  if (Number.isInteger(window?.endOffsetDays)) {
    return window.endOffsetDays === 0 ? "due on event date" : `due within ${window.endOffsetDays} days`;
  }
  return "due within 30 days";
}

function formatGuideField(field) {
  const details = [
    field.values?.length ? `one of ${field.values.join("|")}` : field.type,
    field.requiredWhen ? `required when ${JSON.stringify(field.requiredWhen)}` : null,
    field.disjointFrom ? `must not overlap ${field.disjointFrom}` : null
  ].filter(Boolean).join("; ");
  return `${field.name}\t${details}`;
}
