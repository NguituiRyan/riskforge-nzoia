import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

/** In `npm run dev`, serve api/<name>.ts the way Vercel does (Web-standard GET/POST handlers). */
function devApi(): Plugin {
  return {
    name: "riskforge-dev-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const match = req.url?.match(/^\/api\/([a-z-]+)/);
        if (!match) return next();
        try {
          const mod = await server.ssrLoadModule(path.resolve(__dirname, "api", `${match[1]}.ts`));
          const handler = mod[req.method ?? "GET"];
          if (typeof handler !== "function") {
            res.statusCode = 405;
            return res.end("Method not allowed");
          }
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const request = new Request(`http://localhost${req.url}`, {
            method: req.method,
            headers: req.headers as Record<string, string>,
            body: chunks.length && req.method !== "GET" ? Buffer.concat(chunks) : undefined,
          });
          const response: Response = await handler(request);
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (e) {
          server.config.logger.error(String(e));
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(e) }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // the repo-root .env holds ANTHROPIC_API_KEY, ANTHROPIC_MODEL and NODE_SECRET for the dev API
  Object.assign(process.env, loadEnv(mode, path.resolve(__dirname, ".."), ""));
  return { plugins: [react(), tailwindcss(), devApi()], server: { port: Number(process.env.PORT) || 5173 } };
});
