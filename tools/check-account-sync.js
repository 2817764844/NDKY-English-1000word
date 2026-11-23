const assert = require("assert");
const {
  mergeStudyState,
  touchProgress,
  touchFavorites,
  bundleFromLocal,
  localFromBundle,
  streakFromCheckins,
  todayKey,
} = require("../account-sync.js");

const legacyMastered = { progress: { "1-1": { status: "mastered", at: 0 } }, favorites: {}, stats: { checkins: {} } };
const empty = { progress: {}, favorites: {}, stats: { checkins: {} } };

const kept = mergeStudyState(legacyMastered, empty);
assert.deepStrictEqual(kept.progress["1-1"], { status: "mastered", at: 0 });

const sameTime = mergeStudyState(
  { progress: { "1-2": { status: "fuzzy", at: 0 } }, favorites: {}, stats: { checkins: {} } },
  { progress: { "1-2": { status: "mastered", at: 0 } }, favorites: {}, stats: { checkins: {} } },
);
assert.strictEqual(sameTime.progress["1-2"].status, "mastered");

const newerDemotion = mergeStudyState(
  { progress: { "2-3": { status: "mastered", at: 0 } }, favorites: {}, stats: { checkins: {} } },
  { progress: { "2-3": { status: "fuzzy", at: 50 } }, favorites: {}, stats: { checkins: {} } },
);
assert.deepStrictEqual(newerDemotion.progress["2-3"], { status: "fuzzy", at: 50 });

const newerUpgrade = mergeStudyState(
  { progress: { "2-4": { status: "fuzzy", at: 80 } }, favorites: {}, stats: { checkins: {} } },
  { progress: { "2-4": { status: "mastered", at: 20 } }, favorites: {}, stats: { checkins: {} } },
);
assert.strictEqual(newerUpgrade.progress["2-4"].status, "fuzzy");

const favorites = mergeStudyState(
  {
    progress: {},
    favorites: { "3-1": { on: true, at: 0 } },
    stats: { checkins: {} },
  },
  {
    progress: {},
    favorites: { "3-2": { on: true, at: 0 }, "3-1": { on: false, at: 0 } },
    stats: { checkins: {} },
  },
);
assert.strictEqual(favorites.favorites["3-1"].on, true);
assert.strictEqual(favorites.favorites["3-2"].on, true);

const removed = mergeStudyState(
  { progress: {}, favorites: { "4-1": { on: true, at: 0 } }, stats: { checkins: {} } },
  { progress: {}, favorites: { "4-1": { on: false, at: 90 } }, stats: { checkins: {} } },
);
assert.strictEqual(removed.favorites["4-1"].on, false);

const days = mergeStudyState(
  {
    progress: {},
    favorites: {},
    stats: { checkins: { "2026-11-22": { manual: true, study: false, actions: 0 } } },
  },
  {
    progress: {},
    favorites: {},
    stats: {
      checkins: {
        "2026-11-22": { manual: false, study: true, actions: 2 },
        "2026-11-23": { manual: false, study: true, actions: 1 },
      },
    },
  },
);
assert.deepStrictEqual(days.stats.checkins["2026-11-22"], {
  manual: true,
  study: true,
  actions: 2,
});
assert.strictEqual(days.stats.checkins["2026-11-23"].study, true);

const junk = mergeStudyState(
  {
    progress: { "__proto__": { status: "mastered", at: 9 }, "1-1": { status: "nope", at: 1 } },
    favorites: { "bad": { on: true, at: 1 } },
    stats: { checkins: { "not-a-day": { manual: true } } },
  },
  empty,
);
assert.deepStrictEqual(junk.progress, {});
assert.deepStrictEqual(junk.favorites, {});
assert.deepStrictEqual(junk.stats.checkins, {});

const meta = touchProgress(
  {},
  { "1-1": "mastered", "1-2": "fuzzy" },
  { "1-1": "mastered", "1-2": "unknown" },
  40,
);
assert.strictEqual(meta["1-1"], undefined);
assert.deepStrictEqual(meta["1-2"], { status: "unknown", at: 40 });

const favMeta = touchFavorites({}, ["1-1", "1-2"], ["1-2"], 70);
assert.deepStrictEqual(favMeta["1-1"], { on: false, at: 70 });
assert.strictEqual(favMeta["1-2"], undefined);

const built = bundleFromLocal(
  { "5-1": "mastered", "5-2": "fuzzy" },
  ["5-1"],
  { "5-2": { status: "unknown", at: 3 }, "5-9": { status: "unknown", at: 8 } },
  { "5-1": { on: true, at: 0 }, "5-3": { on: false, at: 11 } },
  { checkins: { "2026-11-01": { manual: true, study: false, actions: 0 } } },
);
assert.strictEqual(built.progress["5-1"].at, 0);
assert.strictEqual(built.progress["5-2"].status, "fuzzy");
assert.deepStrictEqual(built.progress["5-9"], { status: "unknown", at: 8 });
assert.strictEqual(built.favorites["5-3"].on, false);

const view = localFromBundle(built);
assert.strictEqual(view.progress["5-1"], "mastered");
assert.strictEqual(view.progress["5-9"], undefined);
assert.deepStrictEqual(view.favorites, ["5-1"]);

const now = new Date(2026, 10, 23, 9, 0, 0);
assert.strictEqual(todayKey(now), "2026-11-23");
assert.strictEqual(
  streakFromCheckins(
    {
      "2026-11-21": { study: true, actions: 1 },
      "2026-11-22": { manual: true, actions: 0 },
      "2026-11-23": { study: true, actions: 1 },
    },
    now,
  ),
  3,
);
assert.strictEqual(
  streakFromCheckins(
    {
      "2026-11-21": { study: true, actions: 1 },
      "2026-11-22": { manual: true, actions: 0 },
    },
    now,
  ),
  2,
);
assert.strictEqual(
  streakFromCheckins({ "2026-11-20": { study: true, actions: 1 } }, now),
  0,
);

console.log("account-sync ok");
