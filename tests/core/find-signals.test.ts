import { describe, expect, it } from "vitest";
import { findSignals, type SignalPattern } from "../../src/core/find-signals.js";

const PATTERNS: readonly SignalPattern[] = [
  { pattern: /foo/i, label: "foo signal" },
  { pattern: /bar/i, label: "bar signal" },
];

describe("findSignals", () => {
  it("returns an empty array when nothing matches", () => {
    expect(findSignals("clean text", PATTERNS)).toEqual([]);
  });

  it("returns the label for every pattern that matches", () => {
    expect(findSignals("this has foo and bar in it", PATTERNS)).toEqual(["foo signal", "bar signal"]);
  });

  it("returns labels in pattern-list order regardless of match order in the haystack", () => {
    expect(findSignals("bar comes before foo here", PATTERNS)).toEqual(["foo signal", "bar signal"]);
  });

  it("returns each label at most once even with multiple occurrences", () => {
    expect(findSignals("foo foo foo", PATTERNS)).toEqual(["foo signal"]);
  });

  it("returns an empty array for an empty haystack", () => {
    expect(findSignals("", PATTERNS)).toEqual([]);
  });

  it("returns an empty array when given no patterns", () => {
    expect(findSignals("foo bar", [])).toEqual([]);
  });
});
