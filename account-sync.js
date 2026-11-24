// 进度、收藏和打卡的纯合并逻辑。浏览器和 Node 测试共用。
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.CET4_SYNC = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const RANK = { unknown: 0, fuzzy: 1, mastered: 2 };

  function validId(id) {
    return typeof id === "string" && /^[0-9]{1,4}-[0-9]{1,6}$/.test(id);
  }

  function validDay(day) {
    if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return false;
    }
    const [year, month, date] = day.split("-").map(Number);
    const parsed = new Date(year, month - 1, date);
    return (
      parsed.getFullYear() === year &&
      parsed.getMonth() === month - 1 &&
      parsed.getDate() === date
    );
  }

  function todayKey(now) {
    const date = now instanceof Date ? now : new Date();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
  }

  function shiftDay(day, delta) {
    const [year, month, date] = day.split("-").map(Number);
    const next = new Date(year, month - 1, date);
    next.setDate(next.getDate() + delta);
    return todayKey(next);
  }

  function asTime(value) {
    const time = Number(value);
    if (!Number.isFinite(time) || time < 0) {
      return 0;
    }
    return Math.floor(time);
  }

  function normalizeStatus(value) {
    if (!value || typeof value !== "object") {
      return null;
    }
    const status =
      value.status === "mastered" || value.status === "fuzzy" || value.status === "unknown"
        ? value.status
        : null;
    if (!status) {
      return null;
    }
    return { status, at: asTime(value.at) };
  }

  function normalizeFavorite(value) {
    if (!value || typeof value !== "object" || typeof value.on !== "boolean") {
      return null;
    }
    return { on: value.on, at: asTime(value.at) };
  }

  function normalizeCheckin(value) {
    if (!value || typeof value !== "object") {
      return null;
    }
    const actions = Number(value.actions);
    const safeActions =
      Number.isFinite(actions) && actions > 0 ? Math.min(Math.floor(actions), 100000) : 0;
    const manual = Boolean(value.manual);
    const study = Boolean(value.study) || safeActions > 0;
    if (!manual && !study) {
      return null;
    }
    return { manual, study, actions: safeActions };
  }

  function cleanMap(source, normalize) {
    const out = {};
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      return out;
    }
    Object.entries(source).forEach(([id, value]) => {
      if (!validId(id)) {
        return;
      }
      const next = normalize(value);
      if (next) {
        out[id] = next;
      }
    });
    return Object.fromEntries(Object.entries(out).sort(([left], [right]) => left.localeCompare(right)));
  }

  function cleanCheckins(source) {
    const out = {};
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      return out;
    }
    Object.entries(source).forEach(([day, value]) => {
      if (!validDay(day)) {
        return;
      }
      const next = normalizeCheckin(value);
      if (next) {
        out[day] = next;
      }
    });
    return Object.fromEntries(Object.entries(out).sort(([left], [right]) => left.localeCompare(right)));
  }

  function emptyBundle() {
    return { progress: {}, favorites: {}, stats: { checkins: {} } };
  }

  function normalizeBundle(bundle) {
    const source = bundle && typeof bundle === "object" ? bundle : {};
    const stats = source.stats && typeof source.stats === "object" ? source.stats : {};
    return {
      progress: cleanMap(source.progress, normalizeStatus),
      favorites: cleanMap(source.favorites, normalizeFavorite),
      stats: { checkins: cleanCheckins(stats.checkins) },
    };
  }

  function chooseProgress(local, cloud) {
    if (!local) {
      return cloud;
    }
    if (!cloud) {
      return local;
    }
    if (local.at !== cloud.at) {
      return local.at > cloud.at ? local : cloud;
    }
    return (RANK[local.status] || 0) >= (RANK[cloud.status] || 0) ? local : cloud;
  }

  function chooseFavorite(local, cloud) {
    if (!local) {
      return cloud;
    }
    if (!cloud) {
      return local;
    }
    if (local.at !== cloud.at) {
      return local.at > cloud.at ? local : cloud;
    }
    if (local.on || cloud.on) {
      return { on: true, at: local.at };
    }
    return { on: false, at: local.at };
  }

  function mergeCheckins(local, cloud) {
    const out = {};
    const days = new Set([...Object.keys(local || {}), ...Object.keys(cloud || {})]);
    days.forEach((day) => {
      const left = local[day];
      const right = cloud[day];
      if (!left && !right) {
        return;
      }
      out[day] = {
        manual: Boolean((left && left.manual) || (right && right.manual)),
        study: Boolean((left && left.study) || (right && right.study)),
        actions: Math.max((left && left.actions) || 0, (right && right.actions) || 0),
      };
    });
    return out;
  }

  // 同一时间戳：进度取更熟的一边（生词 < 模糊 < 已掌握），收藏取并集。
  // 时间戳不同：较新的一条生效，所以后来主动改回生词或取消收藏可以同步走。
  function mergeStudyState(local, cloud) {
    const left = normalizeBundle(local);
    const right = normalizeBundle(cloud);
    const progress = {};
    const favorites = {};
    new Set([...Object.keys(left.progress), ...Object.keys(right.progress)]).forEach((id) => {
      const chosen = chooseProgress(left.progress[id], right.progress[id]);
      if (!chosen || (chosen.status === "unknown" && !chosen.at)) {
        return;
      }
      progress[id] = chosen;
    });
    new Set([...Object.keys(left.favorites), ...Object.keys(right.favorites)]).forEach((id) => {
      const chosen = chooseFavorite(left.favorites[id], right.favorites[id]);
      if (!chosen || (!chosen.on && !chosen.at)) {
        return;
      }
      favorites[id] = chosen;
    });
    return {
      progress,
      favorites,
      stats: { checkins: mergeCheckins(left.stats.checkins, right.stats.checkins) },
    };
  }

  function statusMap(progress) {
    const out = {};
    Object.entries(progress || {}).forEach(([id, value]) => {
      if (value === "fuzzy" || value === "mastered") {
        out[id] = value;
      }
    });
    return out;
  }

  function touchProgress(meta, before, after, now) {
    const next = {};
    const previous = meta && typeof meta === "object" ? meta : {};
    Object.entries(previous).forEach(([id, value]) => {
      const record = normalizeStatus(value);
      if (record) {
        next[id] = record;
      }
    });
    const ids = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
    ids.forEach((id) => {
      if (!validId(id)) {
        return;
      }
      const from = before[id] === "fuzzy" || before[id] === "mastered" ? before[id] : "unknown";
      const to = after[id] === "fuzzy" || after[id] === "mastered" ? after[id] : "unknown";
      if (from === to) {
        return;
      }
      if (to === "unknown") {
        next[id] = { status: "unknown", at: asTime(now) };
      } else {
        next[id] = { status: to, at: asTime(now) };
      }
    });
    return next;
  }

  function touchFavorites(meta, beforeIds, afterIds, now) {
    const next = {};
    const previous = meta && typeof meta === "object" ? meta : {};
    Object.entries(previous).forEach(([id, value]) => {
      const record = normalizeFavorite(value);
      if (record) {
        next[id] = record;
      }
    });
    const before = new Set(beforeIds || []);
    const after = new Set(afterIds || []);
    const ids = new Set([...before, ...after]);
    ids.forEach((id) => {
      if (!validId(id) || before.has(id) === after.has(id)) {
        return;
      }
      next[id] = { on: after.has(id), at: asTime(now) };
    });
    return next;
  }

  function bundleFromLocal(statuses, favoriteIds, progressMeta, favoriteMeta, stats) {
    const progress = {};
    const favorites = {};
    const current = statusMap(statuses);
    Object.entries(current).forEach(([id, status]) => {
      const record = normalizeStatus(progressMeta && progressMeta[id]);
      progress[id] = {
        status,
        at: record && record.status === status ? record.at : 0,
      };
    });
    Object.entries(progressMeta || {}).forEach(([id, value]) => {
      if (!validId(id) || current[id]) {
        return;
      }
      const record = normalizeStatus(value);
      if (record && record.status === "unknown" && record.at) {
        progress[id] = record;
      }
    });
    const selected = new Set((favoriteIds || []).filter(validId));
    selected.forEach((id) => {
      const record = normalizeFavorite(favoriteMeta && favoriteMeta[id]);
      favorites[id] = { on: true, at: record && record.on === true ? record.at : 0 };
    });
    Object.entries(favoriteMeta || {}).forEach(([id, value]) => {
      if (!validId(id) || selected.has(id)) {
        return;
      }
      const record = normalizeFavorite(value);
      if (record && record.on === false && record.at) {
        favorites[id] = record;
      }
    });
    const normalized = normalizeBundle({ progress, favorites, stats });
    return normalized;
  }

  function localFromBundle(bundle) {
    const normalized = normalizeBundle(bundle);
    const progress = {};
    const favorites = [];
    Object.entries(normalized.progress).forEach(([id, record]) => {
      if (record.status === "fuzzy" || record.status === "mastered") {
        progress[id] = record.status;
      }
    });
    Object.entries(normalized.favorites).forEach(([id, record]) => {
      if (record.on) {
        favorites.push(id);
      }
    });
    favorites.sort();
    return {
      progress,
      favorites,
      progressMeta: normalized.progress,
      favoriteMeta: normalized.favorites,
      stats: normalized.stats,
    };
  }

  function isChecked(checkins, day) {
    const record = checkins && checkins[day];
    return Boolean(record && (record.manual || record.study));
  }

  // 今天已打卡就从今天往前数。今天还没有、昨天有，则连续天数先保留到昨天。
  function streakFromCheckins(checkins, now) {
    const cleaned = cleanCheckins(checkins);
    const today = todayKey(now);
    let cursor = isChecked(cleaned, today) ? today : shiftDay(today, -1);
    if (!isChecked(cleaned, cursor)) {
      return 0;
    }
    let count = 0;
    while (isChecked(cleaned, cursor)) {
      count += 1;
      cursor = shiftDay(cursor, -1);
      if (count > 20000) {
        break;
      }
    }
    return count;
  }

  function bundlesEqual(left, right) {
    return JSON.stringify(normalizeBundle(left)) === JSON.stringify(normalizeBundle(right));
  }

  return {
    validId,
    validDay,
    todayKey,
    shiftDay,
    emptyBundle,
    normalizeBundle,
    mergeStudyState,
    touchProgress,
    touchFavorites,
    bundleFromLocal,
    localFromBundle,
    streakFromCheckins,
    isChecked,
    bundlesEqual,
  };
});
