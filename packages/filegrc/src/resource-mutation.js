import { readFile } from "node:fs/promises";
import { contentRevision } from "./files.js";
import { resolveDataPath } from "./paths.js";
import { markdownEntries } from "./resource-markdown.js";
import { loadWorkspace } from "./workspace.js";

// Read only the target's editable source. Exporting an edit does not require
// rendering, workflow assessment, validation or unrelated record histories.
export async function readResourceMutation(input, type, id) {
  const loaded = input?.entries && input?.root ? input : await loadWorkspace(input);
  const entry = loaded.entries.find(({ record }) => record.id === id && (!type || record.type === type));
  if (!entry) throw new Error(`Resource "${type ? `${type}/` : ""}${id}" was not found.`);
  const content = await readResourceContent(loaded, entry.record);
  const contentEntries = Object.entries(content);
  return {
    record: structuredClone(entry.record),
    ...(contentEntries.length ? {
      content: Object.fromEntries(contentEntries.map(([name, item]) => [name, item.source])),
      contentRevisions: Object.fromEntries(contentEntries.map(([, item]) => [item.path, item.revision]))
    } : {}),
    revision: contentRevision(entry.source)
  };
}

export async function readResourceContent(loaded, record) {
  const content = {};
  if (!loaded.model.resources[record.type]) return content;
  for (const item of markdownEntries(loaded.model, record)) {
    try {
      const source = await readFile(resolveDataPath(loaded.root, item.path), "utf8");
      content[item.name] = { source, path: item.path, revision: contentRevision(source) };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      // An absent optional companion is not an editable source file.
    }
  }
  return content;
}
