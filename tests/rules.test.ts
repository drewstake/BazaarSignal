import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, it } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, collection, getDocs, deleteDoc } from "firebase/firestore";
let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-bazaar-watch",
    firestore: {
      host: "127.0.0.1",
      port: 8081,
      rules: readFileSync("firestore.rules", "utf8"),
    },
  });
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "config/access"), { ownerUid: "owner" });
    await setDoc(doc(db, "owners/owner/workflows/w1"), {
      itemId: "SUMMONING_EYE",
    });
    await setDoc(doc(db, "owners/owner/reports/usage"), {schema:1,json:'private usage report'});
    await setDoc(doc(db, "market/status"), { lastUpdated: 1 });
    await setDoc(doc(db, "owners/other/workflows/private"), { itemId: "X" });
    await setDoc(doc(db, "users/owner/status/main"), { json: "private owner projection" });
    await setDoc(doc(db, "users/other/status/main"), { json: "private other projection" });
    await setDoc(doc(db, "backendUsers/other"), { json: "server-only recipient and hashes" });
  });
});
afterAll(async () => env?.cleanup());
describe("Firestore owner boundary", () => {
  it('isolates positions to verified Google owners and validates only bounded holdings', async () => {
    const google = { email_verified: true, firebase: { sign_in_provider: 'google.com' } };
    const alice = env.authenticatedContext('positions-alice', google).firestore();
    const path = 'users/positions-alice/positions/BOOSTER_COOKIE';
    const position = { itemId: 'BOOSTER_COOKIE', name: 'Booster Cookie', quantity: 287, costBasis: 3501400000, createdAt: Date.now(), updatedAt: Date.now(), revision: 1 };
    await assertSucceeds(setDoc(doc(alice, path), position));
    await assertSucceeds(getDoc(doc(alice, path)));
    await assertSucceeds(getDocs(collection(alice, 'users/positions-alice/positions')));
    for (const db of [env.authenticatedContext('positions-bob', google).firestore(), env.unauthenticatedContext().firestore(),
      env.authenticatedContext('positions-alice', { ...google, email_verified: false }).firestore(),
      env.authenticatedContext('positions-alice', { email_verified: true, firebase: { sign_in_provider: 'password' } }).firestore()]) {
      await assertFails(getDoc(doc(db, path)));
      await assertFails(getDocs(collection(db, 'users/positions-alice/positions')));
      await assertFails(setDoc(doc(db, path), { ...position, revision: 2 }));
      await assertFails(deleteDoc(doc(db, path)));
    }
    for (const patch of [{ quantity: 0 }, { quantity: -1 }, { quantity: 1.5 }, { quantity: 1000000001 }, { quantity: Infinity },
      { costBasis: 0 }, { costBasis: -1 }, { costBasis: NaN }, { costBasis: Infinity }, { costBasis: 1e15 + 1 }, { costBasis: '3.5b' },
      { itemId: 'DIAMOND' }, { name: '' }, { name: 'x'.repeat(141) }, { updatedAt: Date.now() + 120000 }, { createdAt: 0 },
      { createdAt: position.createdAt + 1 }, { updatedAt: 1 }, { revision: 3 }, { revision: 1.5 }, { price: 13000000 }, { uid: 'positions-bob' }])
      await assertFails(setDoc(doc(alice, path), { ...position, revision: 2, ...patch }));
    const { costBasis, ...missing } = position;
    await assertFails(setDoc(doc(alice, path), { ...missing, revision: 2 }));
    await assertFails(setDoc(doc(alice, 'users/positions-alice/positions/DIAMOND'), position));
    await assertFails(setDoc(doc(alice, 'users/positions-alice/positions/BAD!'), { ...position, itemId: 'BAD!' }));
    await assertFails(setDoc(doc(alice, 'users/positions-alice/positions/DIAMOND'), { ...position, itemId: 'DIAMOND', revision: 2 }));
    await assertSucceeds(setDoc(doc(alice, path), { ...position, quantity: 300, costBasis: 3631400000, updatedAt: Date.now(), revision: 2 }));
    await assertSucceeds(deleteDoc(doc(alice, path)));
  });
  it('preserves private retired preferences but denies all obsolete writes', async () => {
    const a=env.authenticatedContext('alice',{email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore();
    const b=env.authenticatedContext('bob',{email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore();
    const saved={key:'bazaar_DIAMOND',kind:'bazaar',itemId:'DIAMOND',name:'Diamond',savedAt:Date.now()};
    const path='users/alice/watchlist/bazaar_DIAMOND';
    await env.withSecurityRulesDisabled(async c=>{await setDoc(doc(c.firestore(),path),saved);await setDoc(doc(c.firestore(),'users/alice/filters/bazaar'),{json:'{}',updatedAt:Date.now()});});
    await assertFails(setDoc(doc(a,path),saved));
    await assertSucceeds(getDocs(collection(a,'users/alice/watchlist')));
    await assertFails(setDoc(doc(a,'users/alice/filters/bazaar'),{json:'{"budget":1000}',updatedAt:Date.now()}));
    for(const db of [b,env.unauthenticatedContext().firestore()]) {
      await assertFails(getDoc(doc(db,path)));await assertFails(setDoc(doc(db,path),saved));
      await assertFails(getDocs(collection(db,'users/alice/watchlist')));await assertFails(getDoc(doc(db,'users/alice/filters/bazaar')));
    }
    await assertFails(setDoc(doc(a,path),{...saved,recipient:'private@example.com'}));
    await assertFails(setDoc(doc(a,path),{...saved,name:'x'.repeat(141)}));
    await assertFails(setDoc(doc(a,'users/alice/filters/bazaar'),{json:'x'.repeat(8193),updatedAt:Date.now()}));
    for(const collectionName of ['itemVariants','completedSales','comparablePrices','collectorStatus']) {
      await assertFails(setDoc(doc(a,`${collectionName}/forged`),{price:1}));await assertFails(getDoc(doc(a,`${collectionName}/forged`)));
    }
    await assertFails(deleteDoc(doc(a,path)));
  });
  it("allows verified owner to read market and own workflows", async () => {
    const db = env
      .authenticatedContext("owner", { email_verified: true })
      .firestore();
    await assertSucceeds(getDoc(doc(db, "market/status")));
    await assertSucceeds(getDocs(collection(db, "owners/owner/workflows")));
    await assertSucceeds(getDoc(doc(db, "owners/owner/reports/usage")));
  });
  it("denies other users, anonymous and unverified users", async () => {
    for (const db of [
      env.unauthenticatedContext().firestore(),
      env.authenticatedContext("other", { email_verified: true }).firestore(),
      env.authenticatedContext("owner", { email_verified: false }).firestore(),
    ]) {
      await assertFails(getDoc(doc(db, "market/status")));
      await assertFails(getDocs(collection(db, "owners/owner/workflows")));
      await assertFails(getDoc(doc(db, "owners/owner/reports/usage")));
    }
  });
  it("denies all client writes including owner writes and access configuration", async () => {
    const db = env
      .authenticatedContext("owner", { email_verified: true })
      .firestore();
    for (const path of [
      "market/status",
      "owners/owner/workflows/w1",
      "owners/owner/events/e1",
      "owners/owner/settings/main",
      "config/access",
      "system/pollLease",
      "backend/state",
      "owners/owner/status/main",
      "owners/owner/reports/usage",
    ])
      await assertFails(setDoc(doc(db, path), { ownerUid: "owner" }));
    await assertFails(getDoc(doc(db, "owners/other/workflows/private")));
    await assertFails(getDoc(doc(db, "system/pollLease")));
    await assertFails(getDoc(doc(db, "alertLinks/secret-hash")));
    await assertFails(getDoc(doc(db, "backend/state")));
  });
  it("allows each verified Google user only their exact sanitized status document", async () => {
    for (const uid of ['owner','other']) {
      const db=env.authenticatedContext(uid,{email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore();
      await assertSucceeds(getDoc(doc(db,`users/${uid}/status/main`)));
      await assertFails(getDoc(doc(db,`users/${uid==='owner'?'other':'owner'}/status/main`)));
      await assertFails(getDoc(doc(db,'backendUsers/other')));
      await assertFails(getDoc(doc(db,'backend/worker')));
      await assertFails(getDoc(doc(db,'alertLinks/known-hash')));
      await assertFails(getDocs(collection(db,'users')));
      await assertFails(setDoc(doc(db,`users/${uid}/status/main`),{json:'forged'}));
    }
  });
  it("denies public, unverified and non-Google reads of user status", async () => {
    for (const db of [env.unauthenticatedContext().firestore(),
      env.authenticatedContext('other',{email_verified:false,firebase:{sign_in_provider:'google.com'}}).firestore(),
      env.authenticatedContext('other',{email_verified:true,firebase:{sign_in_provider:'password'}}).firestore()]) {
      await assertFails(getDoc(doc(db,'users/other/status/main')));
    }
  });
});
