import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalValue, computeCheckDigit, isValidCode } from "./checksum.ts";

test("valid codes", () => {
  assert.ok(isValidCode("4006381333931", "ean13"));
  assert.ok(isValidCode("036000291452", "upca"));
  assert.ok(isValidCode("96385074", "ean8"));
});

test("rejects bad check digit, wrong length, non-digits", () => {
  assert.equal(isValidCode("4006381333932", "ean13"), false);
  assert.equal(isValidCode("400638133393", "ean13"), false);
  assert.equal(isValidCode("40063813339X1", "ean13"), false);
  assert.equal(isValidCode("036000291452", "ean13"), false);
});

test("check digit", () => {
  assert.equal(computeCheckDigit("400638133393"), 1);
  assert.throws(() => computeCheckDigit("12a"));
});

test("canonicalisation: UPC-A gets one leading zero, others unchanged", () => {
  assert.equal(canonicalValue("036000291452", "upca"), "0036000291452");
  assert.equal(canonicalValue("4006381333931", "ean13"), "4006381333931");
  assert.equal(canonicalValue("96385074", "ean8"), "96385074");
  assert.ok(isValidCode(canonicalValue("036000291452", "upca"), "ean13"));
});
