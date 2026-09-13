import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// This is a launcher test, not Desktop runtime coverage. A copied Node binary
// supplies an independent process.pid oracle and a deterministic exit fixture.
const launcher = process.env.ELECTROBUN_TEST_LAUNCHER;
if (process.env.ELECTROBUN_REQUIRE_TEST_LAUNCHER === "1") {
  assert.equal(process.platform, "win32", "the required launcher gate needs Windows");
  assert.equal(process.arch, "x64", "the release launcher gate targets Windows x64");
  assert.ok(launcher, "ELECTROBUN_TEST_LAUNCHER must select the freshly built release launcher");
}
for (const channel of ["dev", "stable"]) {
  for (const fixture of [{ exit: "exit", code: 0 }, { exit: "exit", code: 9 },
    { exit: "exit", code: 0xc0000409 }, { exit: "exit", code: 0xc0000400 }, { exit: "self-terminate", code: 1 }]) {
    // Node/libuv reports forced Windows termination as 1, unlike Cottontail's
    // signal-number exit code. Both must be reported without interpretation.
    const { exit, code: expectedCode } = fixture;
    test(`Windows ${channel} launcher records the real child identity and ${exit} code ${expectedCode}`, {
      skip: process.platform !== "win32" || !launcher, timeout: 30_000,
    }, async () => {
      const directory = await mkdtemp(join(tmpdir(), "electrobun identity é "));
      try {
        const bin = join(directory, "bin");
        const resources = join(directory, "Resources");
        await Promise.all([mkdir(bin), mkdir(resources)]);
        await Promise.all([
          copyFile(launcher, join(bin, "launcher.exe")),
          copyFile(process.execPath, join(bin, "bun.exe")),
          writeFile(join(resources, "build.json"), JSON.stringify({ mainProcess: "bun" })),
          // Omit install metadata: this unmanaged fixture must not register an app.
          writeFile(join(resources, "version.json"), JSON.stringify({ channel })),
          writeFile(join(resources, "main.js"), `
            const fs = require('node:fs');
            fs.writeFileSync(process.env.IDENTITY_REPORT, JSON.stringify({pid:process.pid, parentPid:process.ppid, at:Date.now()}));
            ${exit === "exit" ? `process.exit(${expectedCode})` : "process.kill(process.pid, 'SIGKILL')"};
          `),
        ]);
        const env = { ...process.env, IDENTITY_REPORT: join(directory, "identity.json") };
        delete env.ELECTROBUN_CONSOLE;
        const child = spawn(join(bin, "launcher.exe"), [], { cwd: bin, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
        let output = "";
        child.stdout.setEncoding("utf8").on("data", (chunk) => output += chunk);
        child.stderr.setEncoding("utf8").on("data", (chunk) => output += chunk);
        const result = await new Promise((resolve, reject) => {
          child.once("error", reject);
          child.once("close", (code, signal) => resolve({ code, signal }));
        });
        assert.deepEqual(result, { code: expectedCode, signal: null });
        const actual = JSON.parse(await readFile(env.IDENTITY_REPORT, "utf8"));
        const rows = output.split(/\r?\n/).filter((line) => line.startsWith("[electrobun:process] ")).map((line) => JSON.parse(line.slice("[electrobun:process] ".length)));
        assert.deepEqual(rows.map(({ event }) => event), ["spawn", "exit"]);
        const [spawned, exited] = rows;
        assert.equal(spawned.pid, actual.pid);
        assert.equal(spawned.launcherPid, child.pid);
        assert.equal(actual.parentPid, child.pid);
        assert.match(output, new RegExp(`Child process spawned with PID ${actual.pid}\\b`));
        assert.equal(exited.pid, actual.pid);
        assert.equal(exited.createdFiletime, spawned.createdFiletime);
        assert.equal(exited.code, expectedCode);
        const birthMs = Number((BigInt(spawned.createdFiletime) - 116444736000000000n) / 10000n);
        assert.ok(birthMs <= actual.at && actual.at - birthMs < 10_000);
        assert.ok(BigInt(exited.observedFiletime) >= BigInt(spawned.observedFiletime));
      } finally {
        // Windows image mappings/antivirus can briefly retain a just-exited exe.
        await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
      }
    });
  }
}
