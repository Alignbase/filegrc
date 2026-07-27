import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function makeWorkspace(root) {
  await mkdir(join(root, "data", "people"), { recursive: true });
  await writeJson(join(root, "data", "workspace.json"), {
    schemaVersion: 1,
    dataModelVersion: "1",
    id: "workspace",
    type: "workspace",
    title: "Test SOC 2 Program",
    organizationName: "Test Organization",
    timezone: "UTC"
  });
  await writeJson(join(root, "data", "people", "person-owner.json"), {
    schemaVersion: 1,
    id: "person-owner",
    type: "person",
    title: "Program Owner",
    status: "active",
    email: "security@example.com"
  });
  await writeJson(join(root, "data", "people", "person-approver.json"), {
    schemaVersion: 1,
    id: "person-approver",
    type: "person",
    title: "Independent Approver",
    status: "external",
    email: "approver@example.com"
  });
}

export async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
