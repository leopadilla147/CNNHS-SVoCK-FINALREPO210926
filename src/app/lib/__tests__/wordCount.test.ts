import { describe, it, expect } from "vitest";
import {
  MIN_WORDS,
  countWords,
  hasMeaningfulText,
  meaningfulTextError,
  minWordCountError,
  wordCountError,
} from "../wordCount";

describe("countWords", () => {
  it("counts simple space-separated words", () => {
    expect(countWords("one two three")).toBe(3);
  });

  it("returns 0 for empty or whitespace-only input", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
    expect(countWords("\n\t ")).toBe(0);
  });

  it("collapses multiple / mixed whitespace runs (word-boundary counting)", () => {
    expect(countWords("one   two\t\tthree\nfour")).toBe(4);
  });

  it("ignores leading and trailing whitespace", () => {
    expect(countWords("  one two  ")).toBe(2);
  });
});

describe("validWordCount / canonical threshold (VALID-01)", () => {
  it("exposes the canonical constant of 50 per the recorded 04-07 decision", () => {
    expect(MIN_WORDS).toBe(50);
  });

  it("accepts text that meets the minimum exactly (50 words)", () => {
    const text = Array.from({ length: 50 }, (_, i) => `w${i}`).join(" ");
    expect(wordCountError(text, "Essay")).toBeNull();
  });

  it("rejects text below the minimum and reports the deficit", () => {
    const text = Array.from({ length: 49 }, (_, i) => `w${i}`).join(" ");
    expect(wordCountError(text, "Essay")).toBe("Essay must be at least 50 words (49/50).");
  });

  it("rejects empty text", () => {
    expect(wordCountError("", "Vision")).toMatch(/at least 50 words/);
  });
});

describe("countWords — junk guard (punctuation-only tokens)", () => {
  it("does not count tokens made only of punctuation and/or symbols", () => {
    expect(countWords(". . . . .")).toBe(0);
    expect(countWords("... !!! ???")).toBe(0);
    expect(countWords("- – — /")).toBe(0);
  });

  it("counts only the real words in mixed input", () => {
    expect(countWords(". . lead . . serve")).toBe(2);
    expect(countWords("w1 . w2 ? w3")).toBe(3);
  });

  it("counts accented and non-ASCII letters as words", () => {
    expect(countWords("ñ")).toBe(1);
    expect(countWords("MAKA-DIYOS")).toBe(1);
  });
});

describe("hasMeaningfulText / meaningfulTextError", () => {
  it("detects whether any letter or digit exists at all", () => {
    expect(hasMeaningfulText("Outreach Program")).toBe(true);
    expect(hasMeaningfulText("123")).toBe(true);
    expect(hasMeaningfulText(". . .")).toBe(false);
    expect(hasMeaningfulText("   ")).toBe(false);
  });

  it("requires non-empty input", () => {
    expect(meaningfulTextError("", "Description")).toBe("Description is required.");
    expect(meaningfulTextError("   ", "Description")).toBe("Description is required.");
  });

  it("rejects the '.'-and-spaces-only answer with a junk-specific message", () => {
    expect(meaningfulTextError(".", "Description")).toBe(
      "Description must contain actual words — punctuation and spaces alone are not allowed."
    );
    expect(meaningfulTextError(". . . ?", "Description")).toMatch(/actual words/);
  });

  it("accepts any text that carries a letter or digit", () => {
    expect(meaningfulTextError("Outreach Program", "Description")).toBeNull();
    expect(meaningfulTextError("123", "Answer")).toBeNull();
  });
});

describe("minWordCountError (configurable minimum)", () => {
  it("enforces the given minimum and reports the count", () => {
    expect(minWordCountError("one two", "Description", 3)).toBe("Description must be at least 3 words (2/3).");
    expect(minWordCountError("one two three", "Description", 3)).toBeNull();
  });

  it("does not count punctuation-only tokens toward the minimum", () => {
    expect(minWordCountError(". . . one", "Description", 2)).toBe("Description must be at least 2 words (1/2).");
  });
});