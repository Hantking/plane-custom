import assert from "node:assert/strict";
import { test } from "node:test";
import { phoneDisplay, plainNumber, safeSite } from "../../apps/web/core/components/custom-fields/text-values";

test("decimal display removes storage padding without grouping or losing precision", () => {
  assert.equal(plainNumber("99999999999999.123456"), "99999999999999.123456");
  assert.equal(plainNumber("1000.000000"), "1000");
  assert.equal(plainNumber("-12.125000"), "-12.125");
  assert.equal(plainNumber("0.000001"), "0.000001");
  assert.equal(plainNumber(null), "");
});

test("Brazilian mobile and landline numbers retain all local digits", () => {
  assert.equal(phoneDisplay("21933238159"), "(21) 93323-8159");
  assert.equal(phoneDisplay("2133238159"), "(21) 3323-8159");
  assert.equal(phoneDisplay("+55 (21) 93323-8159"), "(21) 93323-8159");
  assert.equal(phoneDisplay("123"), "123");
});

test("site links default to HTTPS and reject executable protocols", () => {
  assert.equal(safeSite("example.com/path?q=1"), "https://example.com/path?q=1");
  assert.equal(safeSite("http://example.com"), "http://example.com/");
  for (const value of ["javascript:alert(1)", "data:text/html,test", "ftp://example.com", "", null])
    assert.equal(safeSite(value), undefined);
});
