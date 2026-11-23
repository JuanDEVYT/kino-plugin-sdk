// go.relinkTelegram (apiVersion 29, the nineteenth go shape): opens Kino's own "Reautenticar Telegram" screen, for an identity
// plugin whose kino.identity answered not_available. Mirrors ScreenGoRelinkTelegramTest in the app.
import assert from "node:assert/strict";
import test from "node:test";
import { contract } from "../contract.mjs";
import { checkScreenAnswer, checkScreenTree } from "../screen.mjs";
import { TABLES } from "../guide-tables.mjs";

const API = contract.manifest.screen.goRelinkTelegram.apiVersion;
const goOf = (go, apiVersion = API) => {
  const r = checkScreenAnswer({ go }, "es", { apiVersion });
  return { go: r.answer?.go, dropped: r.dropped };
};

test("contract: relinkTelegram is the nineteenth shape, apiVersion 29, identity only, on a press", () => {
  const shapes = contract.manifest.screen.goShapes;
  assert.equal(shapes.length, 19);
  assert.equal(shapes[18], "relinkTelegram");
  const R = contract.manifest.screen.goRelinkTelegram;
  assert.equal(R.apiVersion, 29);
  assert.equal(R.value, true);
  assert.equal(R.needsCapability, "identity");
  assert.equal(R.notIdentityLog, "not_identity");
  assert.deepEqual(R.fromTriggers, ["press", "submit"]);
  assert.ok(contract.maxApiVersion >= R.apiVersion);
  assert.equal(contract.apiVersionFromApp[String(R.apiVersion)], "0.9.91");
});

test("an answer's go.relinkTelegram is kept only as true, from apiVersion 29", () => {
  assert.deepEqual(goOf({ relinkTelegram: true }).go, { relinkTelegram: true });
  for (const bad of [false, "yes", 1, {}, null]) {
    const r = goOf({ relinkTelegram: bad });
    assert.equal(r.go ?? null, null, JSON.stringify(bad));
    assert.ok(r.dropped.some((d) => d.includes("go.relinkTelegram") && d.includes("must be true")), JSON.stringify(bad));
  }
  // An older Kino (and a plugin below apiVersion 29) drops it, as the app does.
  const old = goOf({ relinkTelegram: true }, API - 1);
  assert.equal(old.go ?? null, null);
  assert.ok(old.dropped.some((d) => d.includes("go.relinkTelegram needs apiVersion 29")), old.dropped.join("\n"));
});

test("a node's onPressed go.relinkTelegram is kept in the tree at apiVersion 29", () => {
  const tree = { type: "ElevatedButton", key: "relink", labelText: "Validar mi Telegram", onPressed: { go: { relinkTelegram: true } } };
  const r = checkScreenTree(tree, "es", undefined, { apiVersion: API });
  assert.deepEqual(r.dropped, []);
  assert.deepEqual(r.tree.onTap.go, { relinkTelegram: true });
});

test("go.relinkTelegram takes no other key beside it", () => {
  const r = goOf({ relinkTelegram: true, close: true });
  assert.equal(r.go ?? null, null);
  assert.ok(r.dropped.some((d) => d.includes("exactly one of") && d.includes("relinkTelegram")));
});

test("the guide's go table lists relinkTelegram, from apiVersion 29", () => {
  assert.match(TABLES.screenGo(), /\| `relinkTelegram` \|.*apiVersion 29/);
});
