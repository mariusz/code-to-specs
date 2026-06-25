#!/usr/bin/env node
// Verify every $token referenced in the component specs resolves to a token in
// the foundations file. Closes the loop: specs reference tokens, foundations
// define them.
//
//   node bin/check-refs.mjs
import fs from "node:fs";
import path from "node:path";
import { OUT_DIR, FOUNDATIONS_DIR } from "../config.mjs";

const foundations = JSON.parse(
  fs.readFileSync(path.join(FOUNDATIONS_DIR, "tokens.json"), "utf8"),
);
const defined = new Set(Object.keys(foundations).filter((k) => !k.startsWith("$")));

// Walk a spec collecting every { $token: "name" } reference.
function collectTokens(node, acc) {
  if (Array.isArray(node)) node.forEach((n) => collectTokens(n, acc));
  else if (node && typeof node === "object") {
    if (typeof node.$token === "string") acc.add(node.$token);
    for (const v of Object.values(node)) collectTokens(v, acc);
  }
}

const files = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith(".json"));
const used = new Set();
for (const f of files) {
  collectTokens(JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), "utf8")), used);
}

const unresolved = [...used].filter((t) => !defined.has(t)).sort();
console.log(`tokens referenced by specs: ${used.size}`);
console.log(`tokens defined in foundations: ${defined.size}`);
if (unresolved.length) {
  console.log(`�’ unresolved (${unresolved.length}): ${unresolved.join(", ")}`);
  process.exit(1);
}
console.log(`✔ all ${used.size} references resolve`);
