import { createServer } from "node:http";
import { createCollector, marketHandler } from "./http";
const collector = await createCollector();
// Source release stays cache-only. Do not start collection without authorization.

const port = Number(process.env.COLLECTOR_PORT ?? 8787);
const server = createServer(marketHandler(collector));
server.listen(port, process.env.COLLECTOR_HOST ?? "127.0.0.1", () =>
  console.log(
    `BazaarSignal shared market cache listening on ${port}; collection paused.`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    collector.stop();
    server.close();
  });
