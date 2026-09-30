export type KitId = 'signal' | 'ledger' | 'ember';
export type PageId = 'overview' | 'bazaar' | 'auctions' | 'watchlist' | 'components';
export type Risk = 'Low' | 'Medium' | 'High';
export interface Opportunity {
  id: string;
  name: string;
  category: string;
  market: 'Bazaar' | 'Auction';
  buy: number;
  sell: number;
  volume: number;
  risk: Risk;
  confidence: number;
  tone: string;
  icon: 'gem' | 'eye' | 'flame' | 'cookie' | 'sword' | 'helmet' | 'wand' | 'box';
  rarity: string;
  note: string;
}
export const DEFAULT_FEE = 1.25;
export const opportunities: Opportunity[] = [
  { id: 'diamond', name: 'Enchanted Diamond Block', category: 'Mining', market: 'Bazaar', buy: 202900, sell: 211500, volume: 185240, risk: 'Low', confidence: 94, tone: 'cyan', icon: 'gem', rarity: 'Rare', note: 'Deep order book · steady demand' },
  { id: 'eye', name: 'Summoning Eye', category: 'Combat', market: 'Bazaar', buy: 1123000, sell: 1208000, volume: 38420, risk: 'Medium', confidence: 86, tone: 'violet', icon: 'eye', rarity: 'Epic', note: 'Wider spread · moderate competition' },
  { id: 'cookie', name: 'Booster Cookie', category: 'Consumables', market: 'Bazaar', buy: 13180000, sell: 13750000, volume: 52180, risk: 'Low', confidence: 92, tone: 'amber', icon: 'cookie', rarity: 'Legendary', note: 'High demand · larger capital requirement' },
  { id: 'blaze', name: 'Enchanted Blaze Rod', category: 'Combat', market: 'Bazaar', buy: 408200, sell: 437600, volume: 18750, risk: 'Medium', confidence: 82, tone: 'orange', icon: 'flame', rarity: 'Rare', note: 'Healthy spread · slower order fills' },
  { id: 'iron', name: 'Enchanted Iron Block', category: 'Mining', market: 'Bazaar', buy: 232200, sell: 246800, volume: 75350, risk: 'Low', confidence: 91, tone: 'silver', icon: 'box', rarity: 'Rare', note: 'Consistent turnover · balanced depth' },
  { id: 'sword', name: 'Shadow Fury', category: 'Weapon', market: 'Auction', buy: 38500000, sell: 43800000, volume: 46, risk: 'Medium', confidence: 87, tone: 'violet', icon: 'sword', rarity: 'Legendary', note: 'Clean item · compare upgrades before buying' },
  { id: 'helmet', name: 'Necron’s Helmet', category: 'Armor', market: 'Auction', buy: 24200000, sell: 27900000, volume: 83, risk: 'Low', confidence: 93, tone: 'orange', icon: 'helmet', rarity: 'Legendary', note: 'Comparable clean listings · strong demand' },
  { id: 'wand', name: 'Spirit Sceptre', category: 'Weapon', market: 'Auction', buy: 16800000, sell: 19200000, volume: 64, risk: 'Medium', confidence: 85, tone: 'cyan', icon: 'wand', rarity: 'Legendary', note: 'Clean item · typical resale estimate' },
  { id: 'dragon', name: 'Superior Dragon Chestplate', category: 'Armor', market: 'Auction', buy: 12600000, sell: 14900000, volume: 21, risk: 'High', confidence: 71, tone: 'amber', icon: 'helmet', rarity: 'Legendary', note: 'Thin comparables · price may move quickly' },
];
export const kits: Record<KitId, { name: string; subtitle: string; description: string; colors: string[]; font: string; radius: string }> = {
  signal: { name: 'Signal', subtitle: 'The trading desk', description: 'A quiet, precise workspace. Dense market information, cool mint highlights, and everything within reach.', colors: ['#101719', '#192225', '#344346', '#89E5C0', '#F0F5F3'], font: 'DM Sans', radius: '12px' },
  ledger: { name: 'Ledger', subtitle: 'The daily market', description: 'An open, editorial approach. Warm paper, forest green, and a clear hierarchy for considered decisions.', colors: ['#F5F3EC', '#FFFEF9', '#D8DCD1', '#24533D', '#26352C'], font: 'DM Sans + Georgia', radius: '4px' },
  ember: { name: 'Ember', subtitle: 'The opportunity hunter', description: 'A bold discovery experience. Burnt orange, expressive type, and item cards that put the next deal first.', colors: ['#181614', '#24211D', '#4A4035', '#FFAF6D', '#F9F1E8'], font: 'Space Grotesk', radius: '18px' },
};
export const profit = (item: Opportunity, fee = DEFAULT_FEE, quantity = 1) => (item.sell * (1 - fee / 100) - item.buy) * quantity;
export const roi = (item: Opportunity, fee = DEFAULT_FEE) => profit(item, fee) / item.buy * 100;
export const compact = (value: number) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
export const number = (value: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
