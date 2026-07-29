import { readFileSync } from "node:fs";

export const FAVICON_PNG = readFileSync(new URL("./favicon.png", import.meta.url));
export const LOGO_MARK_PNG = readFileSync(new URL("./logo-mark-white.png", import.meta.url));
