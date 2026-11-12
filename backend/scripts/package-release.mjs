import { execFileSync } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const output = resolve("dist/release");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run this script with npm run package:release");

function npm(args) {
  execFileSync(process.execPath, [npmCli, ...args], { stdio: "inherit" });
}

async function pack(name, files) {
  const staging = join(output, name);
  for (const [source, destination] of [...files, ["../LICENSE", "LICENSE"]]) {
    const path = join(staging, destination);
    await mkdir(dirname(path), { recursive: true });
    await copyFile(source, path);
  }
  npm(["pack", staging, "--pack-destination", output]);
}

npm(["run", "build"]);
npm(["--prefix", "sdk", "run", "build"]);

await pack("sdk", [
  ["sdk/package.json", "package.json"],
  ["sdk/README.md", "README.md"],
  ["sdk/dist/index.js", "dist/index.js"],
  ["sdk/dist/index.d.ts", "dist/index.d.ts"],
]);

await pack("mcp", [
  ["mcp/package.json", "package.json"],
  ["mcp/README.md", "README.md"],
  ["mcp/cli.mjs", "cli.mjs"],
  ["dist/src/mcp/server.js", "src/mcp/server.js"],
  ["dist/sdk/src/index.js", "sdk/src/index.js"],
]);
