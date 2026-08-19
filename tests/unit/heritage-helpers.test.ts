import { describe, expect, it } from "vitest";
import { formatUsd, isTenantId } from "../../apps/heritage-core/data.js";
import { escapeHtml } from "../../apps/heritage-core/render.js";

describe("Heritage Core helpers", () => {
  it("formats USD the way the CIF screen prints it", () => {
    expect(formatUsd(4250.18)).toBe("$4,250.18");
    expect(formatUsd(890)).toBe("$890.00");
  });

  it("accepts only the two configured institution ids", () => {
    expect(isTenantId("first-federal")).toBe(true);
    expect(isTenantId("riverside")).toBe(true);
    expect(isTenantId("heritage-core")).toBe(false);
  });

  it("escapes host-provided strings before they hit HTML templates", () => {
    expect(escapeHtml(`<script>"x"'&`)).toBe("&lt;script&gt;&quot;x&quot;&#39;&amp;");
  });
});
