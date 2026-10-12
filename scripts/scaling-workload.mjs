// Deterministic generic scope records. Programs contain at most 64 services.
export function createScalingWorkload(recordCount, density = 1) {
  const groups = Math.max(1, Math.floor(recordCount / 9));
  const resources = [];
  const controls = [];
  const programs = [];
  for (let position = 0; position < groups; position += 1) {
    const id = (type, offset = 0) => `${type}-${(position + offset) % groups}`;
    const links = (type) => Array.from({ length: Math.min(density, groups) }, (_, offset) => id(type, offset));
    const control = { id: id("control"), type: "control", title: "Review access", status: "implemented",
      statement: "Review access to the service", systemIds: links("system"), requirementIds: links("requirement"),
      policyIds: [id("policy")], componentIds: links("component") };
    controls.push(control);
    resources.push(
      { id: id("system"), type: "system", purpose: "Process service requests", servicesProvided: ["Processing"] },
      { id: id("framework"), type: "framework", version: "1", status: "active" },
      { id: id("requirement"), type: "requirement", frameworkId: id("framework"), description: "Review access" },
      control,
      { id: id("policy"), type: "policy", status: "active", requirementIds: links("requirement") },
      { id: id("component"), type: "component", status: "active", vendorId: id("vendor"),
        systemUses: links("system").map((systemId) => ({ systemId })), description: "Service runtime" },
      { id: id("vendor"), type: "vendor", status: "active", description: "Service provider" },
      { id: id("commitment"), type: "commitment", status: "active", statement: "Protect service data",
        systemIds: links("system"), controlIds: links("control") }
    );
  }
  for (let start = 0; start < groups; start += 64) {
    const end = Math.min(groups, start + 64);
    const ids = (type) => Array.from({ length: end - start }, (_, offset) => `${type}-${start + offset}`);
    const program = { id: `program-${start}`, type: "program", assuranceGoal: "soc-2-type-2",
      systemIds: ids("system"), frameworkIds: ids("framework"), requirementIds: ids("requirement"), controlIds: ids("control") };
    programs.push(program);
    resources.push(program);
  }
  while (resources.length < recordCount) resources.push({ id: `evidence-${resources.length}`, type: "evidence", title: "Operating evidence" });
  return { resources, controls, programs, programFor: (position) => programs[Math.floor(position / 64)] };
}
