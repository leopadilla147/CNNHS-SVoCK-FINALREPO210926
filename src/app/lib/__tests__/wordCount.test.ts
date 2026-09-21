import { describe, it, expect } from "vitest";
import { MIN_WORDS, countWords, wordCountError } from "../wordCount";

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