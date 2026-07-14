import { describe, it, expect } from "vitest";
import { loadSchemas, checkVersionCompat } from "../../src/protocol/schema-loader.js";
import { PROTOCOL_VERSION } from "../../src/protocol/versions.js";

describe("schema loader", () => {
  it("compiles delegation-spec and attempt-result validators", () => {
    const v = loadSchemas();
    expect(typeof v.delegationSpec).toBe("function");
    expect(v.delegationSpec({ specVersion: "1" })).toBe(false); // missing required fields
  });
});

describe("checkVersionCompat", () => {
  it("reports ok for a matching protocol version", () => {
    const result = checkVersionCompat(PROTOCOL_VERSION);
    expect(result).toEqual({ ok: true });
  });

  it("reports a diagnostic for a mismatched protocol version", () => {
    const result = checkVersionCompat("0.0.1");
    expect(result.ok).toBe(false);
    expect(typeof result.diagnostic).toBe("string");
    expect((result.diagnostic as string).length).toBeGreaterThan(0);
  });
});
