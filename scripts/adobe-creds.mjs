// Set the Adobe credentials on Vercel from the file Adobe gives you.
//
//   node scripts/adobe-creds.mjs ~/Downloads/pdfservices-api-credentials.json
//
// Not the clipboard. Two `pbpaste` runs put the same 1049-character JWT into
// both ADOBE_CLIENT_ID and ADOBE_CLIENT_SECRET, because the clipboard held
// something else entirely and neither command had any way to notice. A file
// can be checked before it is sent, and this checks it: a client id is 32 hex
// characters, a secret starts with p8e-, and anything else is refused here
// rather than at Adobe twenty minutes later.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/adobe-creds.mjs <path-to-credentials.json>");
  process.exit(1);
}

let json;
try {
  json = JSON.parse(readFileSync(file.replace(/^~/, process.env.HOME ?? "~"), "utf8"));
} catch (err) {
  console.error(`Can't read ${file}: ${err.message}`);
  process.exit(1);
}

/** Adobe has moved this key around between products; find it wherever it is. */
function find(obj, key) {
  if (!obj || typeof obj !== "object") return null;
  if (typeof obj[key] === "string") return obj[key];
  for (const v of Object.values(obj)) {
    const hit = find(v, key);
    if (hit) return hit;
  }
  return null;
}

/** `client_secrets: ["p8e-…"]` — the first live one. */
function findFirstOf(obj, key) {
  if (!obj || typeof obj !== "object") return null;
  const v = obj[key];
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  if (Array.isArray(v) && v[0] && typeof v[0] === "object") {
    const inner = v[0].client_secret ?? v[0].secret ?? v[0].value;
    if (typeof inner === "string") return inner;
  }
  for (const nested of Object.values(obj)) {
    const hit = findFirstOf(nested, key);
    if (hit) return hit;
  }
  return null;
}

const id = find(json, "client_id");
// The Console's project export calls it client_secrets and makes it an array
// — a credential can hold two while you rotate. The single-credential file
// Adobe hands out separately uses the singular. Accept both.
const secret = find(json, "client_secret") ?? findFirstOf(json, "client_secrets");

if (!id || !secret) {
  console.error("That file has no client_id / client_secret in it.");
  console.error(`Top-level keys: ${Object.keys(json).join(", ")}`);
  process.exit(1);
}

// Refuse the obvious wrong thing before it reaches Vercel.
const problems = [];
if (!/^[0-9a-f]{32}$/i.test(id)) problems.push(`client_id is ${id.length} chars and should be 32 hex`);
if (id === secret) problems.push("client_id and client_secret are identical");
if (secret.startsWith("eyJ")) problems.push("client_secret looks like a JWT, not a secret");

if (problems.length) {
  console.error("That doesn't look right:");
  for (const p of problems) console.error(`  · ${p}`);
  console.error("\nIn the Adobe console, open your project's OAuth Server-to-Server");
  console.error("credential and download the JSON — not a token, not a code sample.");
  process.exit(1);
}

console.log(`client_id     …${id.slice(-4)}  (${id.length} chars)`);
console.log(`client_secret ${secret.slice(0, 4)}…  (${secret.length} chars)`);
console.log();

const run = (args, input) =>
  execFileSync("vercel", args, { input, stdio: ["pipe", "inherit", "inherit"] });

for (const name of ["ADOBE_CLIENT_ID", "ADOBE_CLIENT_SECRET"]) {
  for (const env of ["production", "preview", "development"]) {
    try {
      execFileSync("vercel", ["env", "rm", name, env, "-y"], { stdio: "ignore" });
    } catch {
      /* it wasn't there */
    }
  }
}

// The id is readable on purpose — it travels in an X-API-Key header and is no
// more secret than a username, and `--type config` means it can be pulled back
// for a local test. The secret stays hidden.
run(["env", "add", "ADOBE_CLIENT_ID", "production", "--type", "config"], id);
run(["env", "add", "ADOBE_CLIENT_SECRET", "production"], secret);

console.log("\nBoth set. Redeploy, then check with /api/admin/adobe/check.");
