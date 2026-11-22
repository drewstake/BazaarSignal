import { expect, test } from "@playwright/test";
import { historyDayLabel, historyDayStart } from "../../shared/daily-price-history";

test("screens liquid discounts by period and threshold, then checks history for the selected item", async ({page}) => {
  const at = Date.parse("2026-10-30T18:02:00Z");
  const throughDay = Math.floor((at - 18000000) / 86400000) - 1;
  await page.clock.install({time: at});
  await page.route("https://**", route => route.abort());
  let boardReads = 0, historyReads = 0;
  const row = {id:"SUMMONING_EYE",name:"Summoning Eye",entry:1100000,offer:1400000,bid:1350000,
    avg:{median:1400000,days:78,offer:1400000,bid:1350000},immediate:1080000,spread:1.82,tax:13500,loss:33500,breakEven:1113924.05,target:1350000,rise:25,evidence:{hits:3,misses:0,incomplete:1},reasons:[],upside:233125,discount:21.43,buyVolume:105000,sellVolume:73000};
  await page.route("**/api/companion/flips", route => {
    boardReads++;
    const change = {day: throughDay - 1, before: 51200, after: 12800};
    return route.fulfill({json:{board:{version:4,lot:10,stale:false,watchlist:{7:[],30:[],90:[]},at,throughDay,
      changedItems:[{id:"ENCHANTED_MELON_BLOCK",name:"Enchanted Melon",change,ready:[]},
        {id:"COMPOST",name:"Compost",change:{...change,ingredientId:"BOX_OF_SEEDS",ingredientName:"Box of Seeds",before:76800,after:25600},ready:[]}],
      periods:{7:[],30:[],90:[row]}}}});
  });
  await page.route("**/api/price-history?item=SUMMONING_EYE", route => {
    historyReads++;
    const points = [[throughDay - 90, 99], [throughDay - 89, 1600],
      [throughDay - 3, 400], [throughDay, 100]].map(([day, price]) =>
        [day, historyDayStart(day), price, null, "bazaarsignal"]);
    return route.fulfill({json:{version:1,item:row.id,timezone:"EST",points}});
  });
  await page.goto("/#view=flips",{waitUntil:"domcontentloaded"});
  const grid = page.getByRole("list",{name:"Actionable flips"});
  await expect(page.getByRole("heading", {name:"Sell-offer gainers"})).toBeVisible();
  await expect(grid).toContainText("233,125");
  await expect(grid).toContainText("105,000 / 73,000");
  await page.getByText("NPC sell price changes (2)").click();
  await expect(page.locator(".flip-changes li").filter({hasText:"Compost"})).toContainText("Ingredient · Box of Seeds · 76,800 coins → 25,600 coins");
  const changed = page.locator(".flip-changes li").filter({hasText:"Enchanted Melon"});
  await expect(changed).toContainText("51,200 coins → 12,800 coins");
  await expect(changed).toContainText("Waiting for post-update history");
  await expect(grid).not.toContainText("Enchanted Melon");
  await page.getByLabel("Average over").selectOption("30");
  await expect(page.getByText("No flip meets the entry, exit and recovery checks at this discount.")).toBeVisible();
  await page.getByLabel("Average over").selectOption("90");
  await page.getByLabel("Minimum discount").selectOption("25");
  await expect(grid).toHaveCount(0);
  await page.getByLabel("Minimum discount").selectOption("20");
  await expect(grid).toBeVisible();
  expect(historyReads).toBe(0);
  await grid.getByRole("button",{name:"Check past dips"}).click();
  await expect(grid).toContainText("3 reached the bid target");
  const chart = grid.getByRole("region", {name: "Summoning Eye price history"});
  await expect(chart.getByRole("img")).toHaveAccessibleName(/3 recorded days/);
  await expect(chart.getByRole("button", {name: "Log", exact: true})).toHaveAttribute("aria-pressed", "true");
  const path = chart.getByRole("img").locator("path").first();
  const heights = async () => Array.from((await path.getAttribute("d"))!.matchAll(/,([\d.]+)/g), m => Number(m[1]));
  const [high, mid, low] = await heights();
  expect(mid).toBeCloseTo((high + low) / 2, 1);
  await chart.getByRole("button", {name: "Linear"}).click();
  const linear = await heights();
  expect(linear[1]).toBeCloseTo(linear[0] + (linear[2] - linear[0]) * 0.8, 1);
  await expect(chart.getByRole("slider")).toHaveAttribute("aria-valuetext", /Instant buy: 100 coins. Instant sell: unavailable/);
  await chart.getByLabel("Chart end").fill(historyDayLabel(throughDay - 1));
  await expect(chart.getByRole("img")).toHaveAccessibleName(/2 recorded days/);
  await expect(chart.getByRole("slider")).toHaveAttribute("aria-valuetext", /Instant buy: 400 coins/);
  await grid.getByRole("button",{name:"Check past dips"}).click();
  await expect(chart).toHaveCount(0);
  await grid.getByRole("button",{name:"Check past dips"}).click();
  await expect(chart.getByRole("img")).toHaveAccessibleName(/3 recorded days/);
  expect(boardReads).toBe(1);
  expect(historyReads).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
