import { spawn } from "node:child_process";
import { dirname, resolve, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
const root = fileURLToPath(new URL("../", import.meta.url));
// Keep child tools on the same supported Node runtime as this runner.
process.env.PATH = dirname(process.execPath) + delimiter + process.env.PATH;
const npmCli = resolve(
  dirname(process.execPath),
  "node_modules/npm/bin/npm-cli.js",
);
const typechecks = ["shared", "frontend", "worker"].map((name) => [
  "run",
  "typecheck",
  "--workspace",
  name,
]);
const commands = process.argv.includes("--quick")
  ? [...typechecks, ["run", "test:db"]]
  : [
      ...typechecks,
      ["test", "--workspace", "shared", "--", "--maxWorkers=2"],
      ["test", "--workspace", "frontend", "--", "--maxWorkers=2"],
      ["test", "--workspace", "worker", "--", "--maxWorkers=2"],
      ["run", "test:db"],
      ...["shared", "frontend", "worker"].map((name) => [
        "run",
        "build",
        "--workspace",
        name,
      ]),
      ["run", "security:repo"],
      ["run", "security:dist"],
      ["run", "build:worker"],
      ["run", "audit"],
    ];
const results = [];
let all = "";
for (const args of commands) {
  const command = ["npm", ...args].join(" ");
  let output = "";
  console.log(`START ${command}`);
  const code = await new Promise((done) => {
    const child = spawn(process.execPath, [npmCli, ...args], {
      cwd: root,
      env: process.env,
      windowsHide: true,
    });
    child.stdout.on("data", (d) => {
      output += d;
    });
    child.stderr.on("data", (d) => {
      output += d;
    });
    child.on("error", (e) => {
      output += e.message;
      done(1);
    });
    child.on("close", done);
  });
  results.push({ command, code });
  all += `\n$ ${command}\n${output}\nexit=${code}\n`;
  console.log(`${code === 0 ? "PASS" : "FAIL"} ${command}`);
  if (code !== 0) console.log(output.slice(-12000));
}
mkdirSync(resolve(root, "test-results"), { recursive: true });
writeFileSync(resolve(root, "test-results/temporary-gates.log"), all);
writeFileSync(
  resolve(root, "test-results/temporary-gates.json"),
  JSON.stringify(results, null, 2),
);
process.exitCode = results.every((r) => r.code === 0) ? 0 : 1;
