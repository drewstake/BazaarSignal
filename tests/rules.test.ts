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
      port: 8080,
      rules: readFileSync("firestore.rules", "utf8"),
    },
  });
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "config/access"), { ownerUid: "owner" });
    await setDoc(doc(db, "owners/owner/workflows/w1"), {
      itemId: "SUMMONING_EYE",
    });
    await setDoc(doc(db, "market/status"), { lastUpdated: 1 });
    await setDoc(doc(db, "owners/other/workflows/private"), { itemId: "X" });
    await setDoc(doc(db, "users/owner/status/main"), { json: "private owner projection" });
    await setDoc(doc(db, "users/other/status/main"), { json: "private other projection" });
    await setDoc(doc(db, "backendUsers/other"), { json: "server-only recipient and hashes" });
  });
});
afterAll(async () => env?.cleanup());
describe("Firestore owner boundary", () => {
  it('isolates watchlists and saved filters and rejects forged shared prices', async () => {
    const a=env.authenticatedContext('alice',{email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore();
    const b=env.authenticatedContext('bob',{email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore();
    const saved={key:'bazaar_DIAMOND',kind:'bazaar',itemId:'DIAMOND',name:'Diamond',savedAt:Date.now()};
    const path='users/alice/watchlist/bazaar_DIAMOND';
    await assertSucceeds(setDoc(doc(a,path),saved));
    await assertSucceeds(getDocs(collection(a,'users/alice/watchlist')));
    await assertSucceeds(setDoc(doc(a,'users/alice/filters/bazaar'),{json:'{"budget":1000}',updatedAt:Date.now()}));
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
    await assertSucceeds(deleteDoc(doc(a,path)));
  });
  it("allows verified owner to read market and own workflows", async () => {
    const db = env
      .authenticatedContext("owner", { email_verified: true })
      .firestore();
    await assertSucceeds(getDoc(doc(db, "market/status")));
    await assertSucceeds(getDocs(collection(db, "owners/owner/workflows")));
  });
  it("denies other users, anonymous and unverified users", async () => {
    for (const db of [
      env.unauthenticatedContext().firestore(),
      env.authenticatedContext("other", { email_verified: true }).firestore(),
      env.authenticatedContext("owner", { email_verified: false }).firestore(),
    ]) {
      await assertFails(getDoc(doc(db, "market/status")));
      await assertFails(getDocs(collection(db, "owners/owner/workflows")));
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
