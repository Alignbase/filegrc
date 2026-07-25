export function searchResources(resources, model, options = {}) {
  const query = String(options.query ?? "").trim().toLowerCase();
  const filters = options.filters ?? {};
  return resources.filter((resource) => {
    if (options.type && resource.type !== options.type) return false;
    for (const [field, expected] of Object.entries(filters)) {
      if (expected === undefined || expected === "") continue;
      const value = resource[field];
      if (Array.isArray(value) ? !value.includes(expected) : String(value ?? "") !== String(expected)) return false;
    }
    if (!query) return true;
    return searchableValues(resource, model).some((value) => value.includes(query));
  });
}

export function searchableValues(resource, model) {
  const definition = model.resources[resource.type];
  if (!definition) return [resource.id, resource.type].map((value) => String(value ?? "").toLowerCase());
  const fields = { ...model.commonFields, ...definition.fields };
  const values = [resource.id, resource.type];
  for (const [name, field] of Object.entries(fields)) {
    if (!field.search || resource[name] === undefined) continue;
    const value = resource[name];
    values.push(...(Array.isArray(value) ? value : [value]));
  }
  return values.map((value) => String(value).toLowerCase());
}
