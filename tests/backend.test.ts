import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { DEFAULT_SETTINGS, type Workflow } from "../shared/model";
const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock("../functions/src/delivery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../functions/src/delivery")>()),
  send: sendMock,
}));
let backend: typeof import("../functions/src/index");
let db: ReturnType<typeof getFirestore>;
let prices = { buy: 1_100_000, sell: 1_150_000 };
let bazaarRequests = 0;
const auth = { uid: "owner", token: { email_verified: true } };
const schedule = { scheduleTime: new Date().toISOString(), jobName: "test" };
const workflow: Workflow = {
  id: "w1",
  itemId: "SUMMONING_EYE",
  itemName: "Summoning Eye",
  quantity: 100,
  buyTarget: 1_100_000,
  sellTarget: 1_200_000,
  stage: "watching_buy",
  paused: false,
  channels: ["email", "discord"],
  generation: 0,
  revision: 0,
  purchaseCost: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};
const settings = {
  ...DEFAULT_SETTINGS,
  discordEnabled: true,
  discordTested: true,
};
const action = (data: unknown, identity: unknown = auth) =>
  backend.performAction.run({ data, auth: identity } as never);
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST)
    throw new Error(
      "Backend integration tests must run against the local emulator.",
    );
  process.env.GCLOUD_PROJECT = "demo-bazaar-watch";
  process.env.OWNER_UID = "owner";
  process.env.APP_URL = "https://example.test";
  process.env.GMAIL_USER = "sender@gmail.com";
  process.env.DISCORD_USER_ID = "123456789123456789";
  process.env.GMAIL_APP_PASSWORD = "test";
  process.env.DISCORD_BOT_TOKEN = "test";
  backend = await import("../functions/src/index");
  db = getFirestore();
  vi.spyOn(getAuth(), "getUser").mockResolvedValue({
    email: "owner@example.test",
    emailVerified: true,
  } as never);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/bazaar")) {
        bazaarRequests++;
        return new Response(
          JSON.stringify({
            success: true,
            lastUpdated: Date.now(),
            products: {
              SUMMONING_EYE: {
                buy_summary: [
                  { amount: 1000, pricePerUnit: prices.buy, orders: 2 },
                ],
                sell_summary: [
                  { amount: 1000, pricePerUnit: prices.sell, orders: 3 },
                ],
                quick_status: { buyMovingWeek: 10000 },
              },
            },
          }),
        );
      }
      if (url.includes("/items"))
        return new Response(
          JSON.stringify({
            success: true,
            items: [{ id: "SUMMONING_EYE", name: "Summoning Eye" }],
          }),
        );
      throw new Error(`Unexpected external call ${url}`);
    }),
  );
});
beforeEach(async () => {
  for (const collection of await db.listCollections())
    await db.recursiveDelete(collection);
  sendMock.mockReset();
  sendMock.mockResolvedValue(undefined);
  bazaarRequests = 0;
  prices = { buy: 1_100_000, sell: 1_150_000 };
  await db.doc("owners/owner/settings/main").set(settings);
  await db.doc("owners/owner/workflows/w1").set(workflow);
});
afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("scheduled worker + Firestore transactions", () => {
  it("creates one confirmation, retries independently, and disables only the linked alert", async () => {
    await backend.pollBazaar.run(schedule);
    sendMock.mockClear();
    const input = { requestId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", itemId: "SUMMONING_EYE", side: "buy", quantity: 10, target: 1, taxRate: 1.25 };
    const create = () => backend.createPriceAlert.run({ auth, data: input } as never);
    const [a,b] = await Promise.all([create(),create()]);
    expect(a.id).toBe(b.id);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][3]).toMatchObject({
      emailProvider: "gmail", gmailUser: "sender@gmail.com", gmailPassword: "test",
      email: "owner@example.test",
    });
    const event = (await db.doc(`owners/owner/events/${a.id}-created`).get()).data()!;
    expect(event.deliveries.email.status).toBe("sent");
    const token = event.message.match(/#disable=([a-f0-9]{64})/)[1];
    const links = await db.collection("alertLinks").get();
    expect(links.size).toBe(1);
    expect(links.docs[0].id).not.toBe(token);
    expect(JSON.stringify(links.docs[0].data())).not.toContain(token);
    await expect(backend.disablePriceAlert.run({data:{token:"f".repeat(64)}} as never)).rejects.toThrow("valid");
    expect((await db.doc(`owners/owner/workflows/${a.id}`).get()).data()?.paused).toBe(false);
    await backend.disablePriceAlert.run({ data: { token } } as never);
    await backend.disablePriceAlert.run({ data: { token } } as never);
    expect((await db.doc(`owners/owner/workflows/${a.id}`).get()).data()?.paused).toBe(true);
    expect((await db.doc("owners/owner/workflows/w1").get()).data()?.paused).toBe(false);
    await expect(backend.createPriceAlert.run({data:input,auth:{uid:"other",token:{email_verified:true}}} as never)).rejects.toThrow("private");
    await expect(backend.createPriceAlert.run({data:{...input,target:2},auth} as never)).rejects.toThrow("different alert");
  });
  it("delivers the confirmation before a target email and cancels queued target retries", async () => {
    await backend.pollBazaar.run(schedule);
    sendMock.mockClear();
    sendMock.mockRejectedValue(new Error("Temporary email failure"));
    const result = await backend.createPriceAlert.run({auth,data:{ requestId: "11111111-2222-3333-4444-555555555555", itemId:"SUMMONING_EYE", side:"sell",quantity:1,target:1000000,taxRate:1.25 }} as never);
    expect(result.emailStatus).toBe("queued");
    await backend.pollBazaar.run(schedule);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const receiptRef = db.doc(`owners/owner/events/${result.id}-created`);
    await receiptRef.update({"deliveries.email.nextAttempt":0});
    sendMock.mockResolvedValue(undefined);
    await backend.pollBazaar.run(schedule);
    await backend.pollBazaar.run(schedule);
    const messages = sendMock.mock.calls.map(call => call[2] as string);
    expect(messages[1]).toContain("alert created");
    expect(messages[2]).toContain("sell target reached");
    const token = (await receiptRef.get()).data()!.message.match(/#disable=([a-f0-9]{64})/)[1];
    const targetRef = db.doc(`owners/owner/events/${result.id}-0-sell`);
    await targetRef.update({pending:true,"deliveries.email.status":"queued","deliveries.email.nextAttempt":0});
    await backend.disablePriceAlert.run({data:{token}} as never);
    expect((await targetRef.get()).data()?.deliveries.email.status).toBe("cancelled");
    const count = sendMock.mock.calls.length;
    await backend.pollBazaar.run(schedule);
    expect(sendMock).toHaveBeenCalledTimes(count);
  });
  it("deduplicates overlapping polls and sends one message per channel", async () => {
    await Promise.all([
      backend.pollBazaar.run(schedule),
      backend.pollBazaar.run(schedule),
    ]);
    expect(bazaarRequests).toBe(1);
    expect((await db.collection("owners/owner/events").get()).size).toBe(1);
    expect(sendMock).toHaveBeenCalledTimes(2);
    await backend.pollBazaar.run(schedule);
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(
      (await db.doc("owners/owner/workflows/w1").get()).data()?.stage,
    ).toBe("awaiting_purchase");
  });
  it("runs buy -> manual purchase -> sell with actual stored state", async () => {
    await backend.pollBazaar.run(schedule);
    await action({
      type: "confirmPurchase",
      id: "w1",
      quantity: 100,
      purchaseCost: 110000000,
    });
    await backend.pollBazaar.run(schedule);
    expect((await db.collection("owners/owner/events").get()).size).toBe(1);
    prices.sell = 1_250_000;
    await backend.pollBazaar.run(schedule);
    expect((await db.collection("owners/owner/events").get()).size).toBe(2);
    expect(
      (await db.doc("owners/owner/workflows/w1").get()).data()?.stage,
    ).toBe("completed");
    expect(sendMock).toHaveBeenCalledTimes(4);
  });
  it("retries failed Discord delivery without resending successful email", async () => {
    sendMock.mockImplementation(async (channel: string) => {
      if (channel === "discord") throw new Error("Discord blocked");
    });
    await backend.pollBazaar.run(schedule);
    const ref = db.doc("owners/owner/events/w1-0-buy");
    expect((await ref.get()).data()?.deliveries.email.status).toBe("sent");
    expect((await ref.get()).data()?.deliveries.discord.status).toBe("queued");
    await ref.update({ "deliveries.discord.nextAttempt": 0 });
    sendMock.mockResolvedValue(undefined);
    await backend.pollBazaar.run(schedule);
    expect(sendMock.mock.calls.filter(([c]) => c === "email")).toHaveLength(1);
    expect(sendMock.mock.calls.filter(([c]) => c === "discord")).toHaveLength(
      2,
    );
    expect((await ref.get()).data()?.pending).toBe(false);
  });
  it("enforces owner identity and serializes the 20-active-workflow cap", async () => {
    await expect(
      action(
        { type: "delete", id: "w1" },
        { uid: "other", token: { email_verified: true } },
      ),
    ).rejects.toThrow("private");
    await expect(action({ type: "delete", id: "w1" }, null)).rejects.toThrow(
      "private",
    );
    await backend.pollBazaar.run(schedule);
    const batch = db.batch();
    for (let i = 1; i < 19; i++)
      batch.set(db.doc(`owners/owner/workflows/seed${i}`), {
        ...workflow,
        id: `seed${i}`,
      });
    await batch.commit();
    const create = {
      type: "create",
      itemId: "SUMMONING_EYE",
      quantity: 10,
      buyTarget: 1,
      sellTarget: 2,
      channels: ["email"],
    };
    const result = await Promise.allSettled([action(create), action(create)]);
    expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await db.collection("owners/owner/workflows").get()).size).toBe(20);
  });
});
