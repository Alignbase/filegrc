import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadModel } from "../model/index.js";
import { buildWorkspace } from "./build.js";
import { prepareEvidencePacket, writeEvidencePacket } from "./evidence-packet.js";
import { createResource, createResourceAndLink, deleteResource, updateResource } from "./files.js";
import { generateModelDocumentation } from "./model-docs.js";
import { createObligationEvent, planObligations } from "./obligations.js";
import { relativeToWorkspace } from "./paths.js";
import { searchResources } from "./search.js";
import { serveWorkspace } from "./server.js";
import { currentCalendarDate } from "./time.js";
import { validateWorkspace } from "./validate.js";
import { loadWorkspace } from "./workspace.js";

export async function runCli(argv = process.argv.slice(2)) {
  const [command = "help", ...args] = argv;
  const { positionals, flags } = parseArgs(args);
  const root = flags.root ?? process.cwd();

  if (["help", "--help", "-h"].includes(command)) return printHelp();
  if (["version", "--version", "-v"].includes(command)) return printVersion();

  if (command === "serve") {
    const result = await serveWorkspace(positionals[0] ?? root, { host: flags.host, port: flags.port });
    console.log(`FileGRC workspace: ${result.url}`);
    console.log(`Data: ${result.root}/data`);
    return await new Promise((resolvePromise) => {
      const stop = () => result.server.close(resolvePromise);
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    });
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
    const model = loadModel(String(flags.version ?? "1"));
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
  if (command === "search") {
    const loaded = await loadWorkspace(root);
    const query = positionals.join(" ");
    const results = searchResources(loaded.resources, loaded.model, { query, type: flags.type });
    if (flags.json) console.log(JSON.stringify(results, null, 2));
    else for (const resource of results) console.log(`${resource.id}\t${resource.type}\t${resource.title}`);
    return;
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
      console.log(`${result.counts.overdue} overdue, ${result.counts.due} due, ${result.counts.upcoming} upcoming`);
      for (const item of result.items) {
        console.log([
          item.status.toUpperCase(),
          item.dueWindowStartAt || item.dueWindowStart,
          item.dueWindowEndAt || item.dueWindowEnd || "no fixed cutoff",
          item.title,
          item.actionItemId || item.obligationId
        ].join("\t"));
      }
      if (result.triggers.length) {
        console.log("\nEvent reminders:");
        for (const trigger of result.triggers) console.log(`${trigger.eventType}\t${trigger.prompt}\t${trigger.steps.length} actions`);
      }
    }
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
    else console.log(`Created ${result.event.id} with ${result.actions.length} action items.`);
    return result;
  }
  if (command === "evidence-packet") {
    const packet = await prepareEvidencePacket(root, {
      start: flags.start,
      end: flags.end,
      auditId: flags.audit
    });
    let output = null;
    let files = [];
    if (!flags.preview) {
      const written = await writeEvidencePacket(root, packet, { output: flags.output });
      output = relativeToWorkspace(root, written.output);
      files = written.files;
    }
    const result = { packet, output, files };
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`${packet.summary.datedRecords} dated records, ${packet.summary.obligationOccurrences} obligation occurrences, ${packet.summary.evidence} evidence records, ${packet.summary.gaps} gaps`);
      console.log(flags.preview ? "Preview only; no files written." : `Wrote evidence packet to ${output}`);
    }
    return result;
  }
  if (command === "get") {
    const loaded = await loadWorkspace(root);
    const [type, id] = positionals;
    const record = loaded.resources.find((item) => item.type === type && item.id === id);
    if (!record) throw new Error(`Resource "${type}/${id}" was not found.`);
    console.log(JSON.stringify(record, null, 2));
    return;
  }
  if (command === "create") {
    const record = await readRecord(positionals[0]);
    const result = await createResource(root, record);
    console.log(`Created ${result.record.type}/${result.record.id}`);
    return;
  }
  if (command === "complete") {
    const [obligationId, file] = positionals;
    const record = await readRecord(file);
    const result = await createResourceAndLink(root, record, {
      type: "obligation",
      id: obligationId,
      field: "completionResourceIds"
    });
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`Created ${result.created.type}/${result.created.id} and linked it to obligation/${obligationId}`);
    return result;
  }
  if (command === "update") {
    const [type, id, file] = positionals;
    const record = await readRecord(file);
    const result = await updateResource(root, type, id, record);
    console.log(`Updated ${result.record.type}/${result.record.id}`);
    return;
  }
  if (command === "delete") {
    const [type, id] = positionals;
    if (!flags.yes) throw new Error("Pass --yes to confirm deletion. Preserve historical records unless this is a mistake or uncommitted draft.");
    await deleteResource(root, type, id);
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
    else if (args[index + 1] && !args[index + 1].startsWith("-")) flags[name] = args[++index];
    else flags[name] = true;
  }
  return { positionals, flags };
}

async function readRecord(path) {
  if (!path) throw new Error("A JSON file path or - is required.");
  const source = path === "-" ? await readStdin() : await readFile(resolve(path), "utf8");
  return JSON.parse(source);
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
  filegrc serve [root] [--host 127.0.0.1] [--port 8787]
  filegrc build [root] [--output .filegrc/site]
  filegrc validate [root] [--json]
  filegrc model [--version 1] [--json|--write-docs|--check-docs]
  filegrc describe <resource-type>
  filegrc search <query> [--type resource-type] [--json]
  filegrc obligations [--as-of YYYY-MM-DD] [--from YYYY-MM-DD] [--through YYYY-MM-DD] [--now RFC3339] [--complete] [--json]
  filegrc trigger <event-type> (--occurred-on YYYY-MM-DD | --occurred-at RFC3339) [--subject resource-id[,resource-id]] [--title text] [--json]
  filegrc evidence-packet --start YYYY-MM-DD --end YYYY-MM-DD [--audit audit-id] [--output .filegrc/path] [--preview] [--json]
  filegrc get <resource-type> <id>
  filegrc create <record.json|->
  filegrc complete <obligation-id> <completion-record.json|-> [--json]
  filegrc update <resource-type> <id> <record.json|->
  filegrc delete <resource-type> <id> --yes

All commands accept --root <workspace>. Writes never create Git commits.`);
}
