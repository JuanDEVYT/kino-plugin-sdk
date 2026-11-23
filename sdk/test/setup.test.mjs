// node --test plugins/sdk/test/setup.test.mjs   (Node 18+)
// Plugin setup (apiVersion 30): the manifest's "setup" block (contract.manifest.setup's rules and words), the required exports
// setupStatus and setupRun, and kino.plugins.setup / setupStatus in the kit (order of refusals, apiVersion gating, signing lane, jobs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contract, requiredExports, validateManifest } from "../contract.mjs";
import { createKino, signingLane } from "../kino-shim.mjs";
import { jobBudget, jobKino } from "../job.mjs";
import { validate } from "../validate.mjs";

const S = () => contract.manifest.setup;
const settings = [
  { key: "audio", type: "select", label: "Audio", options: [{ value: "E", label: "Espanol" }, { value: "L", label: "Latino" }, { value: "S", label: "Subtitulado" }], default: "E" },
  { key: "auto", type: "toggle", label: "Automatico", default: false },
  { key: "nick", type: "text", label: "Apodo" },
  { key: "pass", type: "password", label: "Clave" },
];
const base = (api = 30, extra = {}) => ({
  id: "setup-demo", name: "Setup demo", version: "1.0.0", apiVersion: api, entry: "plugin.js",
  hosts: ["example.com"], capabilities: ["search", "resolve", "screen"], screen: { label: "Inicio", labelEn: "Home" }, settings, ...extra,
});
const check = (m) => validateManifest(JSON.stringify(m));
const refused = (m, message) => { const r = check(m); assert.equal(r.ok, false, JSON.stringify(m.setup)); assert.equal(r.field, "setup"); assert.equal(r.message, message); };

test("the contract's setup block: apiVersion 30, the exports and the words", () => {
  assert.equal(S().apiVersion, 30);
  assert.equal(S().field, "setup");
  assert.deepEqual(S().exports, { status: "setupStatus", run: "setupRun" });
  assert.deepEqual(S().inputTypes, ["select", "toggle", "text"]);
  assert.equal(contract.protocol.setup.apiVersion, 30);
  assert.deepEqual(contract.protocol.setup.errorCodes, ["not_installed", "no_setup", "bad_request", "refused", "permission_denied", "busy", "rate_limited", "timeout"]);
  // setupStatus answers { ready, running, progress?, label? }: running only while Kino's own loop for the target runs.
  assert.deepEqual(contract.protocol.setup.statusFields, ["ready", "running", "progress", "label"]);
  // The person's own calls but never a setupRun step (identity and the vault still answer there).
  assert.deepEqual(contract.protocol.setup.fromFunctions, ["screen", "screenEvent", "panelAction"]);
  assert.ok(!contract.protocol.setup.fromFunctions.includes(S().exports.run));
});

test("a setup block is parsed: route and inputs", () => {
  const r = check(base(30, { setup: { route: "setup", inputs: { audio: { type: "select", options: ["L", "E"] }, auto: { type: "toggle" }, nick: { type: "text" } } } }));
  assert.equal(r.ok, true, r.message);
  assert.equal(r.manifest.setup.route, "setup");
  assert.deepEqual(r.manifest.setup.inputs.audio, { key: "audio", type: "select", options: ["L", "E"] });
  assert.deepEqual(r.manifest.setup.inputs.auto, { key: "auto", type: "toggle", options: [] });
  // An empty block is fine (Kino's generic sheet, nothing settable); no block is null.
  assert.deepEqual(check(base(30, { setup: {} })).manifest.setup, { route: null, inputs: {} });
  assert.equal(check(base()).manifest.setup, null);
});

test("setup needs apiVersion 30 at the top level, and is accepted inside enhancements 30", () => {
  refused(base(29, { setup: {} }), S().needsApiMessage);
  const e = check(base(28, { enhancements: { 30: { setup: { inputs: { auto: { type: "toggle" } } } } } }));
  assert.equal(e.ok, true, e.message);
  assert.deepEqual(Object.keys(e.manifest.setup.inputs), ["auto"]);
  assert.ok(e.manifest.enhancementsApplied.includes(30));
});

test("setup must be an object", () => {
  for (const v of [null, [], "x", 3, true]) refused(base(30, { setup: v }), S().notObjectMessage);
});

test("setup.route needs the screen capability and a screen route name", () => {
  const { screen, ...noScreen } = base(30, { capabilities: ["search", "resolve"], setup: { route: "setup" } });
  refused(noScreen, S().needsScreenMessage);
  for (const route of ["", "a b", "r".repeat(65), 7, null]) refused(base(30, { setup: { route } }), S().badRouteMessage);
});

test("setup.inputs: own select, toggle or text settings, the same type, a select's options a subset", () => {
  const bad = [
    null, [], "x",
    { ghost: { type: "toggle" } },                                  // not a setting of the plugin
    { pass: { type: "password" } },                                 // never a password
    { audio: "select" }, { audio: null },                           // not an object
    { auto: { type: "text" } },                                     // another type than the setting's
    { audio: { type: "select" } },                                  // a select lists options
    { audio: { type: "select", options: [] } },
    { audio: { type: "select", options: ["L", "L"] } },             // no duplicates
    { audio: { type: "select", options: ["L", "X"] } },             // one the setting does not have
    { audio: { type: "select", options: ["L", 3] } },
    { auto: { type: "toggle", options: ["a"] } },                   // only a select has options
  ];
  for (const inputs of bad) refused(base(30, { setup: { inputs } }), S().badInputsMessage);
});

test("the exports: a manifest with setup requires setupStatus and setupRun", async () => {
  assert.deepEqual(requiredExports(["search"], [], { setup: { route: null, inputs: {} } }).filter((e) => e.startsWith("setup")), ["setupStatus", "setupRun"]);
  assert.deepEqual(requiredExports(["search"], [], {}).filter((e) => e.startsWith("setup")), []);
  const SCRIPT = (extra) => "export async function search(){ return [] }\nexport async function resolve(){ return null }\nexport async function screen(){ return { type: 'text', text: 'x' } }\nexport async function screenEvent(){ return null }\n" + extra;
  const run = async (script) => {
    const dir = mkdtempSync(join(tmpdir(), "kino-setup-"));
    try {
      writeFileSync(join(dir, "kino-plugin.json"), JSON.stringify(base(30, { setup: {} })));
      writeFileSync(join(dir, "plugin.js"), script);
      return await validate(dir);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  const none = await run(SCRIPT(""));
  assert.equal(none.ok, false);
  assert.ok(none.problems.some((p) => /setupRun/.test(p) && /setupStatus/.test(p)), none.problems.join("\n"));
  const half = await run(SCRIPT("export async function setupStatus(){ return { ready: true } }\n"));
  assert.ok(half.problems.some((p) => /setupRun/.test(p)), half.problems.join("\n"));
  const both = await run(SCRIPT("export async function setupStatus(){ return { ready: true } }\nexport async function setupRun(){ return { done: true } }\n"));
  assert.ok(!both.problems.some((p) => /setup(Status|Run)/.test(p)), both.problems.join("\n"));
});

test("enhancements may carry setup (contract field) and an enhancement missing the exports is dropped, not refused", () => {
  assert.ok(contract.manifest.enhancements.fields.includes("setup"));
  const withExports = validateManifest(JSON.stringify(base(28, { enhancements: { 30: { setup: {} } } })), { exports: ["search", "resolve", "screen", "screenEvent", "setupStatus", "setupRun"] });
  assert.equal(withExports.ok, true);
  assert.deepEqual(withExports.manifest.enhancementsDropped, []);
  const without = validateManifest(JSON.stringify(base(28, { enhancements: { 30: { setup: {} } } })), { exports: ["search", "resolve", "screen", "screenEvent"] });
  assert.equal(without.ok, true);
  assert.equal(without.manifest.setup, null);
  assert.ok(without.manifest.enhancementsDropped.some((d) => /setupRun, setupStatus/.test(d)), without.manifest.enhancementsDropped.join("\n"));
});

// --- kino.plugins.setup / setupStatus in the kit ---
const kinoAt = (api) => createKino(base(api)).kino;
const code = (p) => p.then(() => null, (e) => e.code);

test("kino.plugins.setup and setupStatus exist from apiVersion 30 only (call stays from 20)", () => {
  const k30 = kinoAt(30);
  assert.equal(typeof k30.plugins.setup, "function");
  assert.equal(typeof k30.plugins.setupStatus, "function");
  const k28 = kinoAt(28);
  assert.equal(typeof k28.plugins.call, "function");
  assert.equal(k28.plugins.setup, undefined);
  assert.equal(k28.plugins.setupStatus, undefined);
});

test("setup answers as the app does: bad_request first (repo, then inputs), then not_installed", async () => {
  const { setup, setupStatus } = kinoAt(30).plugins;
  for (const repo of [undefined, null, 5, "", "no-slash", "a/b/c", "a b/c"]) {
    assert.equal(await code(setup(repo)), "bad_request", String(repo));
    assert.equal(await code(setupStatus(repo)), "bad_request", String(repo));
  }
  for (const inputs of [null, [], "x", 3]) assert.equal(await code(setup("someone/kino-plugin-x", inputs)), "bad_request");
  assert.equal(await code(setup("someone/kino-plugin-x")), "not_installed");
  assert.equal(await code(setup("someone/kino-plugin-x", { auto: true })), "not_installed");
  assert.equal(await code(setupStatus("someone/kino-plugin-x")), "not_installed");
});

test("sign() cannot use kino.plugins.setup: the signing lane refuses both", async () => {
  const lane = signingLane(kinoAt(30));
  assert.equal(typeof lane.plugins.setup, "function");
  assert.equal(await code(lane.plugins.setup("someone/kino-plugin-x")), "not_allowed");
  assert.equal(await code(lane.plugins.setupStatus("someone/kino-plugin-x")), "not_allowed");
  assert.equal(await code(lane.plugins.call("a", "b")), "not_allowed");
  // Below 30 the lane never grows them.
  assert.equal(signingLane(kinoAt(28)).plugins.setup, undefined);
});

test("a scheduled job cannot use kino.plugins.setup or setupStatus", async () => {
  const job = jobKino(kinoAt(30), jobBudget());
  assert.equal(await code(job.plugins.setup("someone/kino-plugin-x")), "not_allowed");
  assert.equal(await code(job.plugins.setupStatus("someone/kino-plugin-x")), "not_allowed");
});
