import { describe, expect, test } from "bun:test";
import { getTestSkipReason } from "./requirements";
import { defineTest } from "./types";

const noOpRun = async () => {};

describe("Kitchen test renderer requirements", () => {
  test("runs a CEF-specific test when CEF is bundled", () => {
    const cefTest = defineTest({
      name: "CEF-specific",
      category: "contract",
      requires: { renderer: "cef" },
      run: noOpRun,
    });

    expect(getTestSkipReason(cefTest, ["native", "cef"])).toBeUndefined();
  });

  test("skips a CEF-specific test when only the system renderer is bundled", () => {
    const cefTest = defineTest({
      name: "CEF-specific",
      category: "contract",
      requires: { renderer: "cef" },
      run: noOpRun,
    });

    expect(getTestSkipReason(cefTest, ["native"])).toContain(
      "requires the CEF renderer",
    );
  });

  test("never turns a CEF request into a hard requirement", () => {
    const fallbackTest = defineTest({
      name: "CEF fallback",
      category: "contract",
      async run({ createWindow }) {
        // Critical contract: this requests CEF and must still run in a
        // system-only build so BrowserWindow's fallback is exercised.
        await createWindow({ renderer: "cef" });
      },
    });

    expect(getTestSkipReason(fallbackTest, ["native"])).toBeUndefined();
  });
});
