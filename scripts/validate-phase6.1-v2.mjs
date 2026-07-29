import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.status !== 0) {
    if (options.capture) {
      process.stderr.write(result.stdout ?? "");
      process.stderr.write(result.stderr ?? "");
    }
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.status}.`,
    );
  }
  return result.stdout ?? "";
}

async function waitForGateway() {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const result = spawnSync(
      "docker",
      [
        "exec",
        "cdep-api-gateway-1",
        "node",
        "-e",
        "fetch('http://127.0.0.1:3000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
      ],
      { cwd: root, stdio: "ignore" },
    );
    if (result.status === 0) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
  }
  throw new Error("Gateway readiness did not become healthy within 180s.");
}

try {
  run("docker", ["compose", "config", "--quiet"]);
  run("docker", [
    "compose",
    "--profile",
    "local",
    "build",
    "cdep-web-portal",
    "api-gateway",
    "ledger-service",
  ]);
  run("docker", [
    "compose",
    "--profile",
    "local",
    "up",
    "-d",
    "cdep-web-portal",
    "api-gateway",
    "ledger-service",
  ]);
  await waitForGateway();
  run("npm", ["run", "typecheck", "--workspace", "@cdep/web-portal"]);
  run("npm", ["run", "test", "--workspace", "@cdep/web-portal"]);
  run("npm", ["run", "build", "--workspace", "@cdep/web-portal"]);
  run("docker", [
    "exec",
    "cdep-cdep-web-portal-1",
    "sh",
    "-c",
    "for path in /cases /cases/00000000-0000-4000-8000-000000000000/overview /cases/00000000-0000-4000-8000-000000000000/ledger /cases/00000000-0000-4000-8000-000000000000/activity; do wget -qO- http://127.0.0.1:8080$path | grep -q '<div id=\"root\"></div>' || exit 1; done",
  ]);
  run("docker", [
    "run",
    "--rm",
    "--network",
    "cdep_cdep-network",
    "--env-file",
    ".env",
    "-e",
    "CDEP_BASE_URL=http://api-gateway:3000",
    "-v",
    `${resolve(root, "scripts")}:/validator:ro`,
    "node:24-bookworm-slim",
    "node",
    "/validator/validate-phase6.1.mjs",
  ]);
  console.log("PASS Phase 6.1 V2 repository and Docker/Fabric validation");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  spawnSync(
    "docker",
    [
      "compose",
      "logs",
      "--tail=160",
      "cdep-web-portal",
      "api-gateway",
      "ledger-service",
    ],
    { cwd: root, stdio: "inherit" },
  );
  process.exitCode = 1;
}
