import { describe, it, expect } from "vitest";
import { escapeHtml } from "./escapeHtml";

describe("escapeHtml", () => {
  it("escapes all five HTML metacharacters", () => {
    expect(escapeHtml(`& < > " '`)).toBe(`&amp; &lt; &gt; &quot; &#39;`);
  });

  it("escapes ampersands first so pre-existing entities are not double-encoded", () => {
    expect(escapeHtml("&amp;")).toBe("&amp;amp;");
  });

  it("neutralizes a script-tag / title breakout payload", () => {
    expect(escapeHtml(`</title><script>alert(1)</script>`)).toBe(
      `&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;`
    );
  });

  it("leaves plain text and safe punctuation unchanged", () => {
    expect(escapeHtml("Juan Dela Cruz, Grade 11")).toBe("Juan Dela Cruz, Grade 11");
  });

  it("handles empty string", () => {
    expect(escapeHtml("")).toBe("");
  });
});