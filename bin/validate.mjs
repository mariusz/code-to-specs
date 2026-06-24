#!/usr/bin/env node
// Validate generated specs against the installed Specs JSON Schema.
//   node bin/validate.mjs [file.json ...]   (defaults to specs/components/*.json)
import fs from "node:fs";
import path from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { SCHEMA_DIR, OUT_DIR } from "../config.mjs";

const load = (f) => JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, f), "utf8"));

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

// Register referenced schemas under the $id the component schema uses ($ref by filename).
for (const f of ["styles.schema.json", "workspace.schema.json"]) {
  try {
    ajv.addSchema(load(f), f);
  } catch {
    /* workspace may not be needed; ignore if absent */
  }
}
const validate = ajv.compile(load("component.schema.json"));

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(OUT_DIR).filter((f) => f.endsWith(".json")).map((f) => path.join(OUT_DIR, f));

let ok = true;
for (const f of files) {
  const data = JSON.parse(fs.readFileSync(f, "utf8"));
  const valid = validate(data);
  if (valid) {
    console.log(`✔ valid  ${path.relative(process.cwd(), f)}`);
  } else {
    ok = false;
    console.log(`�’ INVALID ${path.relative(process.cwd(), f)}`);
    for (const e of validate.errors) console.log(`   ${e.instancePath || "/"} ${e.message}`);
  }
}
process.exit(ok ? 0 : 1);
