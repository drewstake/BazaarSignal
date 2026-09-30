export type Stage =
  "watching_buy" | "awaiting_purchase" | "watching_sell" | "completed";
export type Channel = "email" | "discord";
export interface Level {
  amount: number;
  pricePerUnit: number;
  orders: number;
}
export interface Book {
  buy: Level[];
  sell: Level[];
}
export interface ProductPrice {
  id: string;
  name: string;
  buy: number | null;
  sell: number | null;
  volume: number;
}
export interface Workflow {
  mode?: "single";
  taxRate?: number;
  id: string;
  itemId: string;
  itemName: string;
  quantity: number;
  buyTarget: number;
  sellTarget: number;
  stage: Stage;
  paused: boolean;
  channels: Channel[];
  generation: number;
  revision: number;
  purchaseCost: number | null;
  createdAt: number;
  updatedAt: number;
}
export interface Settings {
  taxRate: number;
  emailEnabled: boolean;
  discordEnabled: boolean;
  discordTested: boolean;
  monitoringPaused: boolean;
}
export const DEFAULT_SETTINGS: Settings = {
  taxRate: 1.25,
  emailEnabled: true,
  discordEnabled: false,
  discordTested: false,
  monitoringPaused: false,
};
export interface MarketStatus {
  lastUpdated: number;
  lastSuccess: number;
  lastAttempt: number;
  error: string | null;
}
export interface Delivery {
  status: "queued" | "sending" | "sent" | "failed" | "cancelled";
  attempts: number;
  nextAttempt: number;
  leaseUntil: number;
  error: string | null;
  sentAt?: number;
}
export interface AlertEvent {
  id: string;
  workflowId: string;
  itemName: string;
  side: "buy" | "sell" | "created";
  createdAt: number;
  marketTimestamp: number;
  message: string;
  pending: boolean;
  deliveries: Partial<Record<Channel, Delivery>>;
}
export interface AppData {
  monitoring?: { lastAttempt: number; lastSuccess: number; lastUpdated: number; error: string | null; quota: number | null; enabled: boolean };
  workflows: Workflow[];
  prices: ProductPrice[];
  books: Record<string, Book>;
  status: MarketStatus;
  settings: Settings;
  events: AlertEvent[];
}
export interface PriceAlertInput {
  requestId: string;
  itemId: string;
  side: "buy" | "sell";
  quantity: number;
  target: number;
  taxRate: number;
}
export type Action =
  | {
      type: "create";
      itemId: string;
      quantity: number;
      buyTarget: number;
      sellTarget: number;
      channels: Channel[];
    }
  | {
      type: "edit";
      id: string;
      quantity: number;
      buyTarget: number;
      sellTarget: number;
      channels: Channel[];
    }
  | {
      type: "confirmPurchase";
      id: string;
      quantity: number;
      purchaseCost: number;
    }
  | { type: "pause" | "rearm" | "delete"; id: string }
  | {
      type: "settings";
      taxRate: number;
      emailEnabled: boolean;
      discordEnabled: boolean;
      monitoringPaused: boolean;
    }
  | { type: "test"; channel: Channel };
