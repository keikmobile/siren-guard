const { isWhitelistActive, isBlockedByTime, matchesDomain, findMatchingRule, getJSTDateKey } = require("../background");

// new Date(year, month-1, day, hours, minutes) はローカル時刻で生成されるため、
// タイムゾーンに依存せず getHours()/getMinutes() が期待値を返す
function mockLocalTime(hours, minutes) {
  jest.setSystemTime(new Date(2026, 3, 19, hours, minutes, 0));
}

// ─── matchesDomain ───────────────────────────────────────────────

describe("matchesDomain", () => {
  test("完全一致", () => {
    expect(matchesDomain("x.com", "x.com")).toBe(true);
  });
  test("サブドメイン一致", () => {
    expect(matchesDomain("www.x.com", "x.com")).toBe(true);
  });
  test("深いサブドメイン", () => {
    expect(matchesDomain("api.v2.x.com", "x.com")).toBe(true);
  });
  test("別ドメインはfalse", () => {
    expect(matchesDomain("notx.com", "x.com")).toBe(false);
  });
  test("後方一致でも別ドメインはfalse", () => {
    expect(matchesDomain("evilx.com", "x.com")).toBe(false);
  });
});

// ─── findMatchingRule ────────────────────────────────────────────

describe("findMatchingRule", () => {
  const rules = [
    { domain: "x.com", dailyLimit: 3 },
    { domain: "reddit.com", dailyLimit: 5 },
  ];

  test("一致するルールを返す", () => {
    expect(findMatchingRule(rules, "x.com")).toEqual({ domain: "x.com", dailyLimit: 3 });
  });
  test("サブドメインも一致", () => {
    expect(findMatchingRule(rules, "www.reddit.com")).toEqual({ domain: "reddit.com", dailyLimit: 5 });
  });
  test("登録外はundefined", () => {
    expect(findMatchingRule(rules, "github.com")).toBeUndefined();
  });
});

// ─── isBlockedByTime ─────────────────────────────────────────────

describe("isBlockedByTime", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test("allowedTimeRange なしは常にfalse", () => {
    mockLocalTime(10, 0);
    expect(isBlockedByTime({ allowedTimeRange: null })).toBe(false);
  });

  test("許可時間帯内はfalse", () => {
    mockLocalTime(10, 0);
    expect(isBlockedByTime({ allowedTimeRange: { start: "09:00", end: "22:00" } })).toBe(false);
  });

  test("許可時間帯外（早朝）はtrue", () => {
    mockLocalTime(8, 0);
    expect(isBlockedByTime({ allowedTimeRange: { start: "09:00", end: "22:00" } })).toBe(true);
  });

  test("許可時間帯外（深夜）はtrue", () => {
    mockLocalTime(23, 0);
    expect(isBlockedByTime({ allowedTimeRange: { start: "09:00", end: "22:00" } })).toBe(true);
  });

  test("ちょうど開始時刻はfalse（境界値）", () => {
    mockLocalTime(9, 0);
    expect(isBlockedByTime({ allowedTimeRange: { start: "09:00", end: "22:00" } })).toBe(false);
  });

  test("ちょうど終了時刻はtrue（境界値）", () => {
    mockLocalTime(22, 0);
    expect(isBlockedByTime({ allowedTimeRange: { start: "09:00", end: "22:00" } })).toBe(true);
  });

  test("深夜またぎ：範囲内（23:30）はfalse", () => {
    mockLocalTime(23, 30);
    expect(isBlockedByTime({ allowedTimeRange: { start: "23:00", end: "06:00" } })).toBe(false);
  });

  test("深夜またぎ：範囲内（03:00）はfalse", () => {
    mockLocalTime(3, 0);
    expect(isBlockedByTime({ allowedTimeRange: { start: "23:00", end: "06:00" } })).toBe(false);
  });

  test("深夜またぎ：範囲外（昼間）はtrue", () => {
    mockLocalTime(12, 0);
    expect(isBlockedByTime({ allowedTimeRange: { start: "23:00", end: "06:00" } })).toBe(true);
  });
});

// ─── isWhitelistActive ───────────────────────────────────────────

describe("isWhitelistActive", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const cfg = (enabled, start, end) => ({
    enabled,
    timeRange: { start, end },
    allowedDomains: [],
  });

  test("null はfalse", () => {
    expect(isWhitelistActive(null)).toBe(false);
  });

  test("enabled=false はfalse", () => {
    mockLocalTime(10, 0);
    expect(isWhitelistActive(cfg(false, "09:00", "18:00"))).toBe(false);
  });

  test("有効時間帯内はtrue", () => {
    mockLocalTime(10, 0);
    expect(isWhitelistActive(cfg(true, "09:00", "18:00"))).toBe(true);
  });

  test("有効時間帯外はfalse", () => {
    mockLocalTime(20, 0);
    expect(isWhitelistActive(cfg(true, "09:00", "18:00"))).toBe(false);
  });

  test("ちょうど開始時刻はtrue（境界値）", () => {
    mockLocalTime(9, 0);
    expect(isWhitelistActive(cfg(true, "09:00", "18:00"))).toBe(true);
  });

  test("ちょうど終了時刻はfalse（境界値）", () => {
    mockLocalTime(18, 0);
    expect(isWhitelistActive(cfg(true, "09:00", "18:00"))).toBe(false);
  });

  test("深夜またぎ：範囲内（23:30）はtrue", () => {
    mockLocalTime(23, 30);
    expect(isWhitelistActive(cfg(true, "22:00", "06:00"))).toBe(true);
  });

  test("深夜またぎ：範囲内（03:00）はtrue", () => {
    mockLocalTime(3, 0);
    expect(isWhitelistActive(cfg(true, "22:00", "06:00"))).toBe(true);
  });

  test("深夜またぎ：範囲外（昼間）はfalse", () => {
    mockLocalTime(12, 0);
    expect(isWhitelistActive(cfg(true, "22:00", "06:00"))).toBe(false);
  });
});

// ─── getJSTDateKey ───────────────────────────────────────────────

describe("getJSTDateKey", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test("YYYY-MM-DD 形式を返す", () => {
    jest.setSystemTime(new Date("2026-04-19T10:00:00+09:00"));
    expect(getJSTDateKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
