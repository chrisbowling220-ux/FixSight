import { readFile, writeFile } from "node:fs/promises";

const source = new URL("../src/diagnosis-wire.ts", import.meta.url);
const target = new URL("../apps/mobile/src/lib/diagnosis-wire.ts", import.meta.url);
const header = "// Generated from src/diagnosis-wire.ts by npm run sync:contract. Do not edit.\n";
await writeFile(target, header + await readFile(source, "utf8"));

const requestSource = new URL("../src/request-wire.ts", import.meta.url);
const requestTarget = new URL("../apps/mobile/src/lib/request-wire.ts", import.meta.url);
await writeFile(requestTarget, "// Generated from src/request-wire.ts by npm run sync:contract. Do not edit.\n" + await readFile(requestSource, "utf8"));
