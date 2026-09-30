import { createServer } from "node:http";
import { createCollector, marketHandler } from "./http";
const collector = createCollector();
await collector.initialize();
collector.start();
const port = Number(process.env.COLLECTOR_PORT ?? 8787);
const server = createServer(marketHandler(collector));
server.listen(port, process.env.COLLECTOR_HOST ?? "127.0.0.1", () =>
  console.log(
    `BazaarSignal collector listening on ${port}; ${collector.health.mode} history, scope: ${collector.health.scope.join(", ") || "all items"}.`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    collector.stop();
    server.close();
  });
