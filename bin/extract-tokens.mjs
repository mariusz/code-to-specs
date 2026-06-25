#!/usr/bin/env node
// Extract design tokens from tokens.css into a DTCG-style foundations file.
//
//   node bin/extract-tokens.mjs   -> specs/foundations/tokens.json
//
// Keys are the exact CSS-var names (minus `--`) that the component specs emit as
// `{ $token: "<name>" }`, so the foundations file is a direct lookup table that
// makes those references resolve. `var(--x)` values become DTCG aliases `{x}`.
import fs from "node:fs";
import path from "node:path";
import { TOKENS_CSS, FOUNDATIONS_DIR } from "../config.mjs";

const css = fs.readFileSync(TOKENS_CSS, "utf8");

// --name: value;  (value may span lines: gradients, multi-layer shadows)
const raw = {}; // name -> raw value string (first occurrence wins; media overrides ignored)
const re = /--([\w-]+)\s*:\s*([^;]+);/gs;
let m;
while ((m = re.exec(css))) {
  const name = m[1];
  const value = m[2].replace(/\s+/g, " ").trim();
  if (!(name in raw)) raw[name] = value;
}

const HSL_TRIPLET = /^\d+(?:\.\d+)?\s+\d+(?:\.\d+)?%\s+\d+(?:\.\d+)?%(?:\s*\/\s*[\d.]+%?)?$/;
const DIMENSION = /^-?\d*\.?\d+(rem|px|em|vw|vh|dvw|dvh|%|s|ms)$/;
const NUMBER = /^-?\d*\.?\d+$/;
const aliasTarget = (v) => {
  const a = v.match(/^var\(--([\w-]+)\)$/);
  return a ? a[1] : null;
};

// Classify a token to a DTCG $type, resolving aliases through `raw`.
function typeOf(name, value, seen = new Set()) {
  if (seen.has(name)) return "string";
  seen.add(name);

  const alias = aliasTarget(value);
  if (alias) return alias in raw ? typeOf(alias, raw[alias], seen) : "string";

  // value-driven detection is authoritative (a `gradient-*`-named token can
  // actually hold a plain colour triplet, e.g. --gradient-sunrise-start)
  if (/gradient\(/.test(value)) return "gradient";
  if (HSL_TRIPLET.test(value) || /^(hsl|hsla|rgb|rgba|oklch|oklab)\(/.test(value) || /^#[0-9a-fA-F]{3,8}$/.test(value))
    return "color";
  if (/^cubic-bezier\(/.test(value)) return "cubicBezier";

  // name-driven hints, only for values with no intrinsic keyword
  if (/^shadow-/.test(name) || name === "glass-shadow") return "shadow";
  if (/^gradient-/.test(name)) return "gradient";
  if (/^ease-/.test(name)) return "cubicBezier";
  if (/^transition-/.test(name)) return "duration";
  if (/^font-family-/.test(name)) return "fontFamily";

  if (DIMENSION.test(value)) return "dimension";
  if (NUMBER.test(value)) return "number";
  return "string";
}

// Produce the DTCG $value: alias -> {target}; HSL triplet -> hsl(...); else raw.
function valueOf(value, type) {
  const alias = aliasTarget(value);
  if (alias) return `{${alias}}`;
  if (type === "color" && HSL_TRIPLET.test(value)) return `hsl(${value})`;
  return value;
}

const tokens = {
  $description:
    "Design tokens extracted from src/styles/tokens.css. DTCG-style; keys match the $token names emitted in specs/components/*.json so references resolve by direct lookup. var(--x) values are DTCG aliases {x}.",
};

const byType = {};
for (const [name, value] of Object.entries(raw)) {
  const $type = typeOf(name, value);
  tokens[name] = { $type, $value: valueOf(value, $type) };
  byType[$type] = (byType[$type] || 0) + 1;
}

fs.mkdirSync(FOUNDATIONS_DIR, { recursive: true });
const outPath = path.join(FOUNDATIONS_DIR, "tokens.json");
fs.writeFileSync(outPath, JSON.stringify(tokens, null, 2) + "\n");

console.log(`✔ wrote ${path.relative(process.cwd(), outPath)}`);
console.log(`  ${Object.keys(raw).length} tokens`);
console.log(`  by type: ${Object.entries(byType).map(([t, n]) => `${t}(${n})`).join(", ")}`);
