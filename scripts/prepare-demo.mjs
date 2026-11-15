import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./prepare_demo.py", import.meta.url));
const run = spawnSync("python3", [script, ...process.argv.slice(2)], { stdio: "inherit" });
if (run.error) console.error("Python could not start:", run.error.message);
process.exitCode = run.status ?? 1;
