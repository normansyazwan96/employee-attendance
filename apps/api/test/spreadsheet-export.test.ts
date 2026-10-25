import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { createCsv, createXlsx } from "../src/services/spreadsheet-export.js";

describe("spreadsheet exports", () => {
  it("escapes CSV values and includes a UTF-8 marker", () => {
    const bytes = createCsv([["Name", "Note"], ["Ali", "Late, with note"], ["Mei", 'Said "ok"']]);
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    const csv = new TextDecoder().decode(bytes);
    expect(csv.startsWith("Name,Note\r\n")).toBe(true);
    expect(csv).toContain('Ali,"Late, with note"');
    expect(csv).toContain('Mei,"Said ""ok"""');
  });

  it("creates a readable XLSX package with escaped worksheet values", () => {
    const files = unzipSync(createXlsx([["Employee", "Minutes"], ["A & B", 480]]));
    expect(Object.keys(files)).toContain("xl/worksheets/sheet1.xml");
    const worksheet = strFromU8(files["xl/worksheets/sheet1.xml"]!);
    expect(worksheet).toContain("A &amp; B");
    expect(worksheet).toContain("<v>480</v>");
  });

  it("neutralizes formula-like CSV strings without changing negative numbers", () => {
    const csv = new TextDecoder().decode(createCsv([["=1+1", "+cmd", "-formula", "@SUM(A1:A2)", "\t=hidden", "\r=hidden", -42]]));
    expect(csv).toContain("'=1+1,'+cmd,'-formula,'@SUM(A1:A2)");
    expect(csv).toContain("'\t=hidden");
    expect(csv).toContain("'\r=hidden");
    expect(csv).toContain(",-42\r\n");
  });
});
