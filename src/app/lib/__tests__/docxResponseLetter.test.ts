import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { Packer } from "docx";
import { buildResponseLetter, saveResponseLetter } from "../docxResponseLetter";

async function extractBodyXml(doc: Parameters<typeof buildResponseLetter>[0]): Promise<string> {
  const blob = await Packer.toBlob(buildResponseLetter(doc));
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) throw new Error("missing word/document.xml in packed docx");
  return xml;
}

describe("buildResponseLetter", () => {
  it("returns a packed Blob containing the letterhead and decision text", async () => {
    const xml = await extractBodyXml({
      studentName: "Juan Dela Cruz",
      subject: "Vote buying",
      status: "accepted",
    });
    expect(xml).toContain("CAMARINES NORTE NATIONAL HIGH SCHOOL");
    expect(xml).toContain("COMMUNICATION FOR RESPONDENT");
    expect(xml).toContain("ACCEPTED");
    expect(xml).toContain("Vote buying");
    expect(xml).toContain("Juan Dela Cruz");
  });

  it("embeds a rejection reason when the complaint is rejected", async () => {
    const xml = await extractBodyXml({
      studentName: "Maria Santos",
      subject: "Harassment",
      status: "rejected",
      rejectionReason: "Insufficient evidence",
    });
    expect(xml).toContain("REJECTED");
    expect(xml).toContain("Insufficient evidence");
  });

  it("does NOT run escapeHtml on text (D-14): malicious string is docx-escaped as literal text, no &amp; baked in", async () => {
    const xml = await extractBodyXml({
      studentName: "<script>alert(1)</script>",
      subject: "Bribe & lost ballot \"quote\"",
      status: "rejected",
      rejectionReason: "Unverifiable & vague",
    });
    // docx escapes < as &lt; — the raw angle brackets must NOT survive as markup
    expect(xml).not.toContain("<script>");
    // literal text survives through docx's own escaping (the & of an escapeHtml
    // output would appear as &amp;lt;… — escapeHtml must NOT be applied here)
    expect(xml).toContain("&lt;script&gt;");
    expect(xml).not.toContain("&amp;lt;");
    // raw & in user text is fine — docx XML-escapes it once as &amp; (single pass)
    expect(xml).not.toContain("Bribe &amp;amp;");
  });
});

describe("saveResponseLetter", () => {
  it("triggers a browser download with the given filename", async () => {
    const originalCreate = URL.createObjectURL;
    (URL as any).createObjectURL = () => "blob:mock";
    const originalRevoke = URL.revokeObjectURL;
    (URL as any).revokeObjectURL = () => {};
    const originalClick = HTMLAnchorElement.prototype.click;
    let clicked = false;
    HTMLAnchorElement.prototype.click = function () { clicked = true; };
    try {
      const anchor = document.createElement("a") as HTMLAnchorElement;
      const spy = new Proxy(anchor, {
        get(target, prop, receiver) {
          if (prop === "click") return () => { clicked = true; };
          return Reflect.get(target, prop, receiver);
        },
        set(target, prop, value, receiver) {
          if (prop === "href" || prop === "download") {
            (target as any)[prop] = value;
            return true;
          }
          return Reflect.set(target, prop, value, receiver);
        },
      });
      const originalCreateElement = document.createElement.bind(document);
      document.createElement = (tag: string) => (tag === "a" ? (spy as unknown as HTMLElement) : originalCreateElement(tag));
      try {
        await saveResponseLetter(
          { studentName: "A", subject: "S", status: "accepted" },
          "response-letter.docx"
        );
        expect(spy.download).toBe("response-letter.docx");
        expect(clicked).toBe(true);
      } finally {
        document.createElement = originalCreateElement;
      }
    } finally {
      HTMLAnchorElement.prototype.click = originalClick;
      (URL as any).createObjectURL = originalCreate;
      (URL as any).revokeObjectURL = originalRevoke;
    }
  });
});