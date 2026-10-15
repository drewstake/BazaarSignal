import { expect, it, vi } from "vitest";
const { read, scan, user } = vi.hoisted(() => ({
  read: vi.fn(),
  scan: vi.fn(),
  user: {
    uid: "owner",
    emailVerified: true,
    providerData: [{ providerId: "google.com" }],
  },
}));
vi.mock("../src/data", () => ({ auth: { currentUser: user } }));
vi.mock("../src/firestore", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, ...parts: string[]) => ({ path: parts.join("/") }),
  doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join("/") }),
  getDocs: scan,
  getDoc: vi.fn(),
  increment: vi.fn(),
  runTransaction: async (_db: unknown, work: (tx: unknown) => Promise<void>) =>
    work({ get: read }),
}));
import { migratePositions } from "../src/companion/portfolio-store";
it("completed migration markers skip all three redundant transaction reads without writes", async () => {
  const now = Date.now();
  scan.mockResolvedValue({
    docs: [
      {
        id: "BOOSTER_COOKIE",
        data: () => ({
          itemId: "BOOSTER_COOKIE",
          name: "Cookie",
          quantity: 1,
          costBasis: 100,
          revision: 1,
          createdAt: now,
          updatedAt: now,
        }),
      },
    ],
  });
  read.mockResolvedValue({ exists: () => true });
  await migratePositions(user.uid);
  expect(scan).toHaveBeenCalledOnce();
  expect(read).toHaveBeenCalledOnce();
  expect(read).toHaveBeenCalledWith({
    path: "users/owner/positionMigrations/BOOSTER_COOKIE",
  });
  await migratePositions(user.uid);
  expect(scan).toHaveBeenCalledOnce();
  expect(read).toHaveBeenCalledOnce();
});
