import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { createFilegrc } from "../../create-filegrc/src/index.js";
import { hostedAutomationRecommendation, OPERATING_HOSTED_AUTOMATION } from "../src/hosted-automation.js";
import { APP_SCRIPT } from "../src/web.js";
import { assessWorkflow } from "../src/workflow.js";
import { assessProgramReadiness } from "../src/program-readiness.js";
import { makeComprehensiveWorkspace } from "./fixtures.js";
import { runCli } from "../src/cli.js";
import { executeCli } from "./helpers.js";

test("hosted follow-up appears after implementation and review, before cutover, without a completion claim", () => {
  const assess = (implementationReady, oversightCurrent, cutoverComplete) => hostedAutomationRecommendation({ implementationReady, oversightCurrent, cutoverComplete });
  assert.equal(assess(false, false, false).status, "later");
  assert.equal(assess(true, false, false).status, "later");
  const ready = assess(true, true, false);
  assert.equal(ready.status, "recommended");
  assert.equal(ready.optional, true);
  assert.equal(ready.priority, "primary");
  assert.equal(ready.continueWithout.priority, "secondary");
  assert.equal(ready.requiredForReadiness, false);
  assert.equal(ready.setupVerified, false);
  assert.deepEqual(ready.continueWithout.commands, ["npx filegrc activate-content --scaffold", "npx filegrc activate-policies --scaffold"]);
  assert.equal(assess(true, true, true).status, "available");
  assert.equal(hostedAutomationRecommendation({ implementationReady: true, oversightCurrent: true, missingContactIds: ["person-missing-contact"] }).status, "later");
});

test("renderer consumes shared placement and offers setup and direct cutover without mutating files", () => {
  const source = APP_SCRIPT.slice(APP_SCRIPT.indexOf("function renderHostedAutomation"), APP_SCRIPT.indexOf("function renderFinishStepThree"));
  const state = { programReadiness: { hostedAutomation: hostedAutomationRecommendation({ implementationReady: false }) } };
  const render = vm.runInNewContext(source + "\nrenderHostedAutomation", { state, esc: String });
  assert.equal(render(), "");
  state.programReadiness.hostedAutomation = hostedAutomationRecommendation({ implementationReady: true, oversightCurrent: true });
  const html = render();
  assert.match(html, /https:\/\/app.filegrc.com\/guide/);
  assert.match(html, /Continue to content activation without automation/);
  assert.match(html, /href="#program-content-cutover"/);
  assert.match(html, /\$19.99/);
  assert.match(html, /USD \/ repo \/ month/);
  assert.match(html, /optional Slack escalation/);
  assert.doesNotMatch(html, /Operated by|Opening setup|production approval/);
  assert.ok(APP_SCRIPT.indexOf('return renderHostedAutomation()') < APP_SCRIPT.indexOf('id="program-content-cutover"'));
  assert.match(APP_SCRIPT, /event.preventDefault\(\);\n    main.querySelector\("#program-content-cutover"\)/);
  state.programReadiness.hostedAutomation.status = "available";
  assert.equal(render(), "");
  const operating = render("run");
  assert.match(operating, /Automate your repo/);
  assert.match(operating, /local app is closed/);
  assert.doesNotMatch(operating, /program-content-cutover|activate approved/);
  assert.match(operating, /hosted-automation-hero/);
});

test("hosted policy files do not change local readiness; CLI exposes the same optional recommendation offline", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "filegrc-hosted-optional-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  const before = await assessProgramReadiness(root, { asOf: "2026-10-07" });
  await mkdir(join(root, ".filegrc"), { recursive: true });
  await writeFile(join(root, ".filegrc", "hosted-notifications.json"), '{"version":1,"channels":[{"kind":"email"}],"upcomingDays":[7]}');
  const after = await assessProgramReadiness(root, { asOf: "2026-10-07" });
  assert.deepEqual(after.counts, before.counts);
  assert.equal(after.evidenceReady, before.evidenceReady);
  assert.deepEqual(after.policyActivations, before.policyActivations);
  assert.deepEqual(after.hostedAutomation, before.hostedAutomation);
  assert.ok(after.stages.every(stage => stage.items.every(item => item.id !== "hosted-automation")));
  const workflow = await assessWorkflow(root, { asOf: "2026-10-07" });
  assert.deepEqual(workflow.recommendations, [after.hostedAutomation, OPERATING_HOSTED_AUTOMATION]);
  assert.ok(!workflow.findings.some(({ key }) => key.includes("hosted-automation")));
  const cli = new URL("../bin/filegrc.js", import.meta.url).pathname;
  for (const args of [["program-path", "--next"], ["program-path", "--summary"], ["program-readiness", "--summary"]]) {
    const result = await executeCli(runCli, process.execPath, [cli, ...args, "--root", root, "--as-of", "2026-10-07", "--json"]);
    assert.equal(result.exitCode || 0, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).hostedAutomation, before.hostedAutomation);
  }
  for (const command of ["obligations", "workflow"]) {
    const text = await executeCli(runCli, process.execPath, [cli, command, "--root", root, "--as-of", "2026-10-07"]);
    assert.match(text.stdout, /Recommended next action \(optional\): Automate your repo/);
    assert.match(text.stdout, /Start with email/);
    assert.match(text.stdout, /https:\/\/app.filegrc.com\/guide/);
    assert.match(text.stdout, /Keep managing follow-up locally/);
    const json = JSON.parse((await executeCli(runCli, process.execPath, [cli, command, "--root", root, "--as-of", "2026-10-07", "--json"])).stdout);
    assert.deepEqual(json.recommendations.find(({ stage }) => stage === "run"), OPERATING_HOSTED_AUTOMATION);
  }
});

test("template introduction and agent instructions preserve email-first optional setup and Git boundaries", async () => {
  for (const name of ["README.md", "AGENTS.md"]) {
    const text = await readFile(new URL("../../create-filegrc/template/" + name, import.meta.url), "utf8");
    assert.match(text, /\$19.99 USD/);
    assert.match(text, /app.filegrc.com\/guide/);
    assert.match(text, /without automation/);
    assert.match(text, /hosted-notifications.json/);
    assert.match(text, /notifications.json/);
    assert.match(text, /credentials/);
  }
});

test("fresh consumer includes optional setup docs without seeded hosted settings", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "filegrc-hosted-consumer-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, "workspace");
  await createFilegrc({ target: root, yes: true, install: false, filegrcVersion: "0.16.26", policyOwnerEmail: "security@example.com" });
  for (const name of ["README.md", "AGENTS.md"]) {
    assert.match(await readFile(join(root, name), "utf8"), /Continue to content activation without automation/);
  }
  for (const name of ["notifications.json", "hosted-notifications.json"]) {
    await assert.rejects(readFile(join(root, ".filegrc", name)), { code: "ENOENT" });
  }
});

test("program-path next promotes optional cutover guidance and preserves activation context", async () => {
  const cliSource = await readFile(new URL("../src/cli.js", import.meta.url), "utf8");
  const source = cliSource.slice(cliSource.indexOf("function nextProgramPath("), cliSource.indexOf("function shellArgument("));
  const { programPathRecommendation } = await import("../src/hosted-automation.js");
  const next = vm.runInNewContext(source + "\nnextProgramPath", {
    programPathRecommendation,
    buildActionContext: () => ({ workPhase: "setup" })
  });
  const activation = { id: "policy-activation-policy-example", status: "action", title: "Activate approved Policies", message: "Activate the reviewed revision.", commands: ["npx filegrc activate-policies --scaffold"] };
  const result = {
    currentStep: { id: "controls", number: 3 },
    hostedAutomation: hostedAutomationRecommendation({ implementationReady: true, oversightCurrent: true }),
    stages: [{ id: "controls", number: 3, nextActions: [activation], commands: activation.commands }]
  };
  const output = next(result, {});
  assert.equal(output.primaryRecommendation.title, "Automate your repo");
  assert.equal(output.step.nextAction.id, "hosted-automation");
  assert.equal(output.primaryRecommendation.requiredForReadiness, false);
  assert.equal(output.secondaryAction.title, "Continue to content activation without automation");
  assert.equal(output.secondaryAction.nextAction.id, activation.id);
  assert.equal(output.secondaryAction.nextAction.context.workPhase, "setup");
  assert.deepEqual(Array.from(output.secondaryAction.commands), ["npx filegrc activate-content --scaffold", "npx filegrc activate-policies --scaffold"]);
  result.hostedAutomation.status = "later";
  assert.equal(next(result, {}).primaryRecommendation, null);
  assert.equal(next(result, {}).step.nextAction.id, activation.id);
  result.currentStep.id = "run";
  result.stages[0].id = "run";
  const operating = next(result, {});
  assert.equal(operating.primaryRecommendation.stage, "run");
  assert.equal(operating.secondaryAction.title, "Keep managing follow-up locally");
  assert.equal(operating.step.nextAction.id, activation.id);
});
