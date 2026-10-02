import { MarketCollector } from "./engine";
import { configuredStore } from "./cache-store";
import { configuredPolicy } from "./policy";
export { marketHandler } from "./routes";

export async function createCollector() {
  return new MarketCollector(await configuredStore(), configuredPolicy());
}
