import inputs from "./flip-recipe-inputs.json";
import { knownNpcChanges, type NpcChanges } from "./npc-prices";
import type { FlipPriceChange } from "../shared/flips";

const products = new Map<string, string[]>();
for (const [output, ingredients] of Object.entries(inputs)) {
  for (const ingredient of ingredients) {
    const outputs = products.get(ingredient) ?? [];
    outputs.push(output);
    products.set(ingredient, outputs);
  }
}

// Archive and live catalog can come from different refreshes. Keep the newest
// direct event for each item, including events for intermediate ingredients.
export function directFlipChanges(day: number, ...sources: NpcChanges[]) {
  const changes: NpcChanges = {...knownNpcChanges(day)};
  for (const source of sources) for (const [id, change] of Object.entries(source)) {
    if (change.day <= day && (!changes[id] || changes[id].day <= change.day)) changes[id] = change;
  }
  return changes;
}

export function affectedFlipPrices(direct: NpcChanges) {
  const changes: Record<string, FlipPriceChange> = {};
  const dates = new Map<number, string[]>();
  for (const id of Object.keys(direct).sort()) {
    const day = direct[id].day;
    const ids = dates.get(day) ?? [];
    ids.push(id);
    dates.set(day, ids);
  }
  // Newest update first. Within a date, visit direct events first, then
  // their dependents by distance. Visiting each product once also breaks cycles.
  for (const day of [...dates.keys()].sort((a, b) => b - a)) {
    const queue = dates.get(day)!.filter(id => !changes[id]);
    for (const id of queue) changes[id] = direct[id];
    for (const id of queue) {
      for (const product of products.get(id) ?? []) {
        if (changes[product]) continue;
        changes[product] = {...changes[id], ingredientId: changes[id].ingredientId ?? id, path: [...(changes[id].path ?? [id]), product]};
        queue.push(product);
      }
    }
  }
  return changes;
}
