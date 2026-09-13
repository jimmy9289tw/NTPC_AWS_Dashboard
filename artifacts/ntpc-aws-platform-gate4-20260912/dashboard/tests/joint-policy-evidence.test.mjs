import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { higherEducationMarriedShare } from "../app/joint-education-marriage.ts";

async function payload(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), "utf8"));
}

test("higher-education married-share policy evidence uses the disclosed joint denominator", async () => {
  const city = await payload("../public/data/joint-education-marriage.json");
  const tamsui = await payload("../public/data/joint-education-marriage-districts/65000100.json");
  const cityEstimate = higherEducationMarriedShare(city, 114, "18-35", "合計");
  const tamsuiEstimate = higherEducationMarriedShare(tamsui, 114, "18-35", "合計");

  assert.ok(cityEstimate);
  assert.ok(tamsuiEstimate);
  assert.equal(Number(cityEstimate.value.toFixed(2)), 18.58);
  assert.equal(Number(tamsuiEstimate.value.toFixed(2)), 21.07);
  assert.ok(tamsuiEstimate.value > cityEstimate.value, "淡水不可誤標成低於全市");
  assert.match(tamsuiEstimate.origin, /模型估計/);
});

test("a district pilot can trigger only when the model-envelope direction is consistent", async () => {
  const city = await payload("../public/data/joint-education-marriage.json");
  const pingxi = await payload("../public/data/joint-education-marriage-districts/65000240.json");
  const cityEstimate = higherEducationMarriedShare(city, 114, "18-35", "合計");
  const pingxiEstimate = higherEducationMarriedShare(pingxi, 114, "18-35", "合計");

  assert.ok(cityEstimate);
  assert.ok(pingxiEstimate);
  assert.equal(Number(pingxiEstimate.value.toFixed(2)), 10.72);
  assert.ok(cityEstimate.low - pingxiEstimate.high > 0);
});
