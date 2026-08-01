export function isSafeGitName(value) {
  const segments = value.split("/");
  return Boolean(value)
    && value !== "@"
    && value !== "HEAD"
    && !value.startsWith("-")
    && !value.includes("..")
    && !value.includes("@{")
    && !/[\s~^:?*[\]\\\u0000-\u001f\u007f]/.test(value)
    && segments.every((segment) => (
      segment
      && !segment.startsWith(".")
      && !segment.endsWith(".")
      && !segment.endsWith(".lock")
    ));
}
