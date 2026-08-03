import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function makeWorkspace(root) {
  await mkdir(join(root, "data", "people"), { recursive: true });
  await writeJson(join(root, "data", "workspace.json"), {
    dataModelVersion: "2",
    id: "workspace",
    type: "workspace",
    title: "Test SOC 2 Program",
    organizationName: "Test Organization",
    timezone: "UTC",
    classificationDefinitions: {
      public: "Approved for public release.",
      internal: "Internal business information.",
      confidential: "Sensitive business or customer information.",
      restricted: "Highly sensitive information."
    }
  });
  await writeJson(join(root, "data", "people", "person-owner.json"), {
    id: "person-owner",
    type: "person",
    title: "Program Owner",
    status: "active",
    affiliation: "internal",
    email: "security@example.com",
    jobTitle: "Chief Executive Officer"
  });
  await writeJson(join(root, "data", "people", "person-approver.json"), {
    id: "person-approver",
    type: "person",
    title: "Internal Reviewer",
    status: "active",
    affiliation: "internal",
    email: "approver@example.com",
    jobTitle: "Chief Operating Officer"
  });
}

export async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
