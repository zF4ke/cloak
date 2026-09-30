import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Service } from "./core/service.ts";
import type { CloakApi } from "./shared/types.ts";
async function main() {
  const service = new Service(
    process.env.CLOAK_DATA_DIR || join(tmpdir(), "cloak-preview"),
    process.cwd(),
    false,
  );
  await service.initialize();
  createServer(async (request, response) => {
    try {
      if (
        request.method !== "POST" ||
        request.url !== "/api/rpc" ||
        (request.headers.origin &&
          !["http://127.0.0.1:5173", "http://localhost:5173"].includes(
            request.headers.origin,
          ))
      ) {
        response.writeHead(403);
        response.end();
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 100_000) throw new Error("Request is too large.");
        chunks.push(chunk);
      }
      const { method, args } = JSON.parse(
        Buffer.concat(chunks).toString("utf8"),
      ) as { method: keyof CloakApi; args: unknown[] };
      // Browser preview never mutates real project folders or controls OneDrive.
      if (!["snapshot", "inspect", "chooseFolder"].includes(method))
        throw new Error("Use the desktop app for this action.");
      const value = await service.call(method, args);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ value }));
    } catch (error) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }).listen(43180, "127.0.0.1");
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
