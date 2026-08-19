import { describe, expect, it } from "vitest";
import { classifyText } from "../../src/surface/classify.js";

describe("page signature classifier", () => {
  it("maps Heritage Core host banners to error classes", () => {
    expect(classifyText("Record not found\nNo CIF record matches")).toEqual(["not_found"]);
    expect(classifyText("Validation error\nEnter a 5-digit identifier")).toEqual(["validation_error"]);
    expect(classifyText("Permission denied")).toEqual(["permission_denied"]);
    expect(classifyText("Session expired — please log in")).toEqual(["session_expired"]);
    expect(classifyText("System Notice\nScheduled maintenance window")).toEqual(["unexpected_dialog"]);
  });

  it("returns no signature on a happy-path CIF screen", () => {
    expect(classifyText("CIF record\nShare Balance\n$4,250.18")).toEqual([]);
  });
});
