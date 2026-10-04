import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  localFirestore,
  localNotificationService,
} from "../server/local-workspace";
import { DOCUMENT } from "../apps-script/store";
import { legacyHolding } from "../shared/companion/portfolio";

// Run against the active local Firestore emulator; no cloud URLs or user UIDs.
it("commits notification create/pause/resume/edit/delete against real local Firestore preconditions", async () => {
  const uid = `local-verification-${randomUUID()}`,
    pid = "verification",
    hid = "bz_DIAMOND",
    now = Date.now();
  const parent = `users/${uid}/portfolios/${pid}`,
    holding = `${parent}/holdings/${hid}`,
    notification = `users/${uid}/portfolioNotifications/${pid}__${hid}`;
  const encode = (v: any): any =>
    v === null
      ? { nullValue: null }
      : typeof v === "string"
        ? { stringValue: v }
        : typeof v === "number"
          ? { integerValue: String(v) }
          : { booleanValue: v };
  const write = (path: string, data: object) => ({
    update: {
      name: `${DOCUMENT}/${path}`,
      fields: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, encode(v)]),
      ),
    },
    currentDocument: { exists: false },
  });
  const changes = localNotificationService(),
    identity = { uid, email: "verification@example.test", claims: {} };
  const request = {
    portfolioId: pid,
    holdingId: hid,
    operation: "save",
    revision: 0,
    input: { baseline: "acquisition", up: 10, down: 5 },
  };
  try {
    await localFirestore(":commit", "POST", {
      writes: [
        write(parent, {
          id: pid,
          name: "Isolated verification",
          createdAt: now,
          updatedAt: now,
          revision: 1,
          deleted: false,
        }),
        write(
          holding,
          legacyHolding({
            itemId: "DIAMOND",
            name: "Diamond",
            quantity: 5,
            costBasis: 100,
            createdAt: now,
            updatedAt: now,
            revision: 1,
          }),
        ),
      ],
    });
    expect(await changes(identity, request)).toMatchObject({
      enabled: true,
      revision: 1,
    });
    await expect(changes(identity, request)).rejects.toThrow(
      "changed elsewhere",
    );
    expect(
      await changes(identity, { ...request, operation: "pause", revision: 1 }),
    ).toMatchObject({ enabled: false, revision: 2 });
    expect(
      await changes(identity, { ...request, operation: "resume", revision: 2 }),
    ).toMatchObject({ enabled: true, revision: 3 });
    expect(
      await changes(identity, {
        ...request,
        revision: 3,
        input: { ...request.input, up: 20 },
      }),
    ).toMatchObject({ up: 20, revision: 4 });
    expect(
      await changes(identity, { ...request, operation: "delete", revision: 4 }),
    ).toMatchObject({ deleted: true, enabled: false });
    expect(
      (await localFirestore(`/${notification}`)).fields.deleted.booleanValue,
    ).toBe(true);
    expect(
      JSON.parse(
        (await localFirestore(`/portfolioDelivery/${uid}`)).fields.json
          .stringValue,
      ).state.mail,
    ).toEqual([]);
  } finally {
    // Delete only the disposable records created by this test, on loopback.
    await localFirestore(":commit", "POST", {
      writes: [
        holding,
        notification,
        parent,
        `portfolioDelivery/${uid}`,
        `portfolioSubscribers/${uid}`,
      ].map((path) => ({ delete: `${DOCUMENT}/${path}` })),
    });
  }
});
