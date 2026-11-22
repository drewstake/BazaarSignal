import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Pass the extracted NotEnoughUpdates/NotEnoughUpdates-REPO directory.
// Reviewed with revision fadb5d2e63d5f4ef2b31129ad9374f0c1ee87c0b.
// Refresh offline at release time. No recipe downloads are needed by the collector.
const root = process.argv[2];
if (!root) throw Error("Pass the extracted NEU repository path.");
async function json(url) {
  const response = await fetch(url, {signal: AbortSignal.timeout(30000)});
  if (!response.ok) throw Error(url + " returned " + response.status);
  return response.json();
}
const [catalog, bazaar, matter] = await Promise.all([
  json("https://api.hypixel.net/v2/resources/skyblock/items"),
  json("https://api.hypixel.net/v2/skyblock/bazaar"),
  json("https://hypixelskyblock.minecraft.wiki/api.php?action=parse&page=Compost/Organic%20Matter%20Table&prop=wikitext&format=json"),
]);
if (!catalog.success || !bazaar.success) throw Error("Market metadata unavailable.");
const graph = new Map();
function normalize(id) {
  const book = "ENCHANTMENT_" + id.replace(";", "_");
  if (id.includes(";") && Object.hasOwn(bazaar.products, book)) return book;
  return id.replace(/-(\d+)$/, ":$1");
}
function add(output, inputs) {
  let deps = graph.get(output);
  if (!deps) graph.set(output, deps = new Set());
  for (const id of inputs) if (id && id !== output && id !== "SKYBLOCK_COIN") deps.add(id);
}
for (const file of readdirSync(join(root, "items")).filter(f => f.endsWith(".json"))) {
  const item = JSON.parse(readFileSync(join(root, "items", file), "utf8"));
  for (const recipe of [item.recipe, ...(item.recipes ?? [])].filter(Boolean)) {
    let slots;
    if (!recipe.type || recipe.type === "crafting")
      slots = Object.entries(recipe).filter(([key]) => /^[ABC][123]$/.test(key)).map(([, slot]) => slot);
    else if (recipe.type === "forge") slots = recipe.inputs;
    else continue;
    const output = normalize(recipe.overrideOutputId || item.internalname);
    add(output, slots.filter(Boolean).map(s => normalize(s.replace(/:\d+$/, ""))));
  }
}
for (const item of catalog.items) for (const recipe of item.recipes ?? []) {
  if (recipe.output?.item_id && recipe.matrix && recipe.ingredient_symbols)
    add(recipe.output.item_id, recipe.matrix.map(symbol => recipe.ingredient_symbols[symbol]));
}
const cropRows = matter.parse.wikitext["*"].split("\n").filter(line => line.startsWith("| {{Item|"));
const crops = cropRows.map(line => {
  if (line.startsWith("| {{Item|Cactus Green}}")) return "INK_SACK:2";
  const id = line.match(/\{\{BZC\|[\d.,]+ ([^}|]+)/)?.[1];
  if (!id) throw Error("Unrecognized organic matter row: " + line);
  return id.toUpperCase().replaceAll(" ", "_");
});
if (!crops.includes("BOX_OF_SEEDS") || crops.length < 50) throw Error("Incomplete organic matter table.");
const fuels = catalog.items.filter(item => item.components?.some(c => c.type === "MACHINE_FUEL"));
add("COMPOST", [...crops, ...fuels.map(item => item.id)]);

// Include intermediate recipes even when the ingredient has no Bazaar listing.
const reachable = new Set(Object.keys(bazaar.products));
for (const output of reachable) for (const input of graph.get(output) ?? []) reachable.add(input);
const rows = [...reachable].filter(id => graph.get(id)?.size).sort()
  .map(id => "  " + JSON.stringify(id) + ": " + JSON.stringify([...graph.get(id)].sort()));
writeFileSync("collector/flip-recipe-inputs.json", "{\n" + rows.join(",\n") + "\n}\n");
console.log("Saved recipes for", rows.length, "outputs.");
