import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
// Only compiled app assets enter docs/. Local statement files and the dev API are excluded.
const result = spawnSync(
  "npm",
  ["run", "build", "--", "--base=/Daily/", "--outDir=docs"],
  { stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status || 1);
writeFileSync("docs/.nojekyll", "");
