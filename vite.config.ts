import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs/promises";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "private-local-history",
      configureServer(server) {
        server.middlewares.use("/api/local-history", async (req, res) => {
          if (req.method !== "GET") {
            res.statusCode = 405;
            res.end();
            return;
          }
          try {
            const data = await fs.readFile(
              new URL("./.local/history.json", import.meta.url),
              "utf8",
            );
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.setHeader("Cache-Control", "no-store");
            res.end(data);
          } catch {
            res.statusCode = 404;
            res.end("{}");
          }
        });
      },
    },
  ],
  server: { host: "0.0.0.0", port: 5173, strictPort: true },
});
