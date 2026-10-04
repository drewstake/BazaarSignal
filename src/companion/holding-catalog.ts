import bazaarRows from "./bazaar-catalog.json";

export interface HoldingCatalogItem {
  id: string;
  name: string;
  kind: "bazaar";
}

const normalize = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();

const catalog: HoldingCatalogItem[] = [
  ...bazaarRows.map(([id, name]) => ({ id, name, kind: "bazaar" as const })),
];
const byId = new Map(catalog.map((item) => [item.id, item]));
const searchable = catalog.map((item) => ({
  item,
  name: normalize(item.name),
  id: normalize(item.id),
  text: normalize(`${item.name} ${item.id}`),
}));

export const holdingCatalogItem = (id: string) => byId.get(id);

export function searchHoldingItems(query: string, limit = 20) {
  const normalized = normalize(query);
  if (!normalized) return [];
  const words = normalized.split(" ");
  return searchable
    .filter((row) => words.every((word) => row.text.includes(word)))
    .map((row) => ({
      ...row,
      rank:
        row.id === normalized || row.name === normalized
          ? 0
          : row.name.startsWith(normalized)
            ? 1
            : 2,
    }))
    .sort((a, b) => a.rank - b.rank || a.item.name.localeCompare(b.item.name))
    .slice(0, limit)
    .map((row) => row.item);
}
