import { createServer } from "node:http";
import { createCollector, marketHandler } from "./http";
const collector = await createCollector();
collector.start();

const port = Number(process.env.COLLECTOR_PORT ?? 8787);
const server = createServer(marketHandler(collector));
server.listen(port, process.env.COLLECTOR_HOST ?? "127.0.0.1", () =>
  console.log(
    `BazaarSignal shared current-market cache listening on ${port}; automatic budgeted refresh enabled.`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    collector.stop();
    server.close();
  });
