#!/usr/bin/env node
// Reverse-engineer a CVA/shadcn component (.tsx) into a Specs component.schema.json.
//
//   node bin/cva-to-spec.mjs --component button
//   node bin/cva-to-spec.mjs --file /abs/path/to/foo.tsx
//
// Strategy: parse the real AST (not regex), pull the cva() base + variant groups
// + defaultVariants, map Tailwind classes to Specs Styles/TokenReferences, and
// emit a schema-valid Component. Figma-only provenance (metadata.source) is
// omitted — it isn't required by the schema for code-origin specs.
import fs from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
import { UI_DIR, OUT_DIR } from "../config.mjs";
import { twToStyles } from "../lib/tw-map.mjs";

const traverse = _traverse.default || _traverse;

// ── args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const compArg = getArg("--component");
const fileArg = getArg("--file");
const file = fileArg || (compArg && path.join(UI_DIR, `${compArg}.tsx`));
if (!file) {
  console.error("usage: cva-to-spec.mjs --component <name> | --file <path>");
  process.exit(2);
}
const source = fs.readFileSync(file, "utf8");

// ── parse ─────────────────────────────────────────────────────────────
const ast = parse(source, {
  sourceType: "module",
  plugins: ["typescript", "jsx"],
});

// Pull out the first cva(base, config) call and the most-relevant Props interface.
let cvaBase = null;
let cvaConfig = null;
const booleanProps = {}; // name -> default
let hasChildren = true; // shadcn primitives forward children by default

const strOf = (node) => (node && node.type === "StringLiteral" ? node.value : null);
const objToMap = (objExpr) => {
  const out = {};
  for (const p of objExpr.properties) {
    if (p.type !== "ObjectProperty") continue;
    const key = p.key.name ?? p.key.value;
    out[key] = p.value;
  }
  return out;
};

traverse(ast, {
  CallExpression(p) {
    const callee = p.node.callee;
    if (callee.type === "Identifier" && callee.name === "cva") {
      cvaBase = strOf(p.node.arguments[0]) ?? "";
      const cfg = p.node.arguments[1];
      if (cfg && cfg.type === "ObjectExpression") cvaConfig = cfg;
    }
  },
  TSInterfaceBody(p) {
    for (const m of p.node.body) {
      if (m.type !== "TSPropertySignature" || !m.key) continue;
      const name = m.key.name;
      const t = m.typeAnnotation?.typeAnnotation?.type;
      if (t === "TSBooleanKeyword") booleanProps[name] = false;
    }
  },
});

if (!cvaBase && !cvaConfig) {
  console.error(`No cva() call found in ${file}. This generator targets CVA components.`);
  process.exit(1);
}

// ── extract variant groups + defaults ─────────────────────────────────
const cfgMap = cvaConfig ? objToMap(cvaConfig) : {};
const variantGroups = {}; // group -> { value -> classString }
if (cfgMap.variants && cfgMap.variants.type === "ObjectExpression") {
  for (const [group, valuesNode] of Object.entries(objToMap(cfgMap.variants))) {
    if (valuesNode.type !== "ObjectExpression") continue;
    variantGroups[group] = {};
    for (const [value, classNode] of Object.entries(objToMap(valuesNode))) {
      variantGroups[group][value] = strOf(classNode) ?? "";
    }
  }
}
const defaults = {};
if (cfgMap.defaultVariants && cfgMap.defaultVariants.type === "ObjectExpression") {
  for (const [group, valNode] of Object.entries(objToMap(cfgMap.defaultVariants))) {
    defaults[group] = strOf(valNode);
  }
}

const title = (compArg || path.basename(file, ".tsx")).replace(/(^|[-_])(\w)/g, (_, __, c) =>
  c.toUpperCase(),
);

// ── build props ───────────────────────────────────────────────────────
const props = {};
for (const [group, values] of Object.entries(variantGroups)) {
  props[group] = {
    type: "string",
    enum: Object.keys(values),
    default: defaults[group] ?? Object.keys(values)[0],
  };
}
for (const [name, def] of Object.entries(booleanProps)) {
  props[name] = { type: "boolean", default: def };
}
if (hasChildren) props.children = { type: "slot", default: null };

// ── styles helpers ─────────────────────────────────────────────────────
// Compute root+label Styles for a set of class strings (base + chosen values).
function stylesFor(...classStrings) {
  const root = {};
  const label = {};
  const unmapped = [];
  const skipped = [];
  for (const cs of classStrings) {
    if (!cs) continue;
    const r = twToStyles(cs);
    Object.assign(root, r.root);
    Object.assign(label, r.label);
    // typography needs deep-merge
    if (r.label.typography)
      label.typography = { ...(label.typography || {}), ...r.label.typography };
    unmapped.push(...r.unmapped);
    skipped.push(...r.skippedState);
  }
  return { root, label, unmapped, skipped };
}

// ── anatomy ─────────────────────────────────────────────────────────────
const anatomy = {
  root: { type: "container" },
  label: { type: "slot" },
};

// ── default variant (base + each group's default value) ─────────────────
const defaultClassStrings = [cvaBase];
for (const [group, values] of Object.entries(variantGroups)) {
  const dv = defaults[group] ?? Object.keys(values)[0];
  if (values[dv] != null) defaultClassStrings.push(values[dv]);
}
const def = stylesFor(...defaultClassStrings);

const defaultVariant = {
  configuration: Object.fromEntries(
    Object.keys(variantGroups).map((g) => [g, props[g].default]),
  ),
  layout: [{ root: ["label"] }],
  elements: {
    root: { children: ["label"], styles: def.root },
    label: {
      children: { $binding: "#/props/children" },
      ...(Object.keys(def.label).length ? { styles: def.label } : {}),
    },
  },
};

// ── non-default variants (deltas only) ──────────────────────────────────
const variants = [];
const allUnmapped = new Set(def.unmapped);
for (const [group, values] of Object.entries(variantGroups)) {
  const dv = props[group].default;
  for (const [value, classString] of Object.entries(values)) {
    if (value === dv) continue;
    const s = stylesFor(classString);
    s.unmapped.forEach((u) => allUnmapped.add(u));
    const elements = {};
    if (Object.keys(s.root).length) elements.root = { styles: s.root };
    if (Object.keys(s.label).length)
      elements.label = { styles: s.label };
    variants.push({
      configuration: { [group]: value },
      ...(Object.keys(elements).length ? { elements } : {}),
    });
  }
}

// ── assemble component ──────────────────────────────────────────────────
const component = {
  title,
  anatomy,
  props,
  default: defaultVariant,
  variants,
};

fs.mkdirSync(OUT_DIR, { recursive: true });
const outPath = path.join(OUT_DIR, `${(compArg || path.basename(file, ".tsx")).toLowerCase()}.json`);
fs.writeFileSync(outPath, JSON.stringify(component, null, 2) + "\n");

console.log(`✔ wrote ${path.relative(process.cwd(), outPath)}`);
console.log(`  title: ${title}`);
console.log(`  props: ${Object.keys(props).join(", ")}`);
console.log(`  variant groups: ${Object.keys(variantGroups).map((g) => `${g}(${Object.keys(variantGroups[g]).length})`).join(", ")}`);
console.log(`  variant deltas: ${variants.length}`);
if (allUnmapped.size)
  console.log(`  ⚠ unmapped classes (${allUnmapped.size}): ${[...allUnmapped].join(", ")}`);
