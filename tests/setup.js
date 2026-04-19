global.browser = undefined;
global.chrome = {
  storage: {
    local: {
      get: jest.fn().mockResolvedValue({}),
      set: jest.fn().mockResolvedValue(undefined),
    },
  },
  runtime: { getURL: jest.fn(p => `chrome-extension://test/${p}`) },
  tabs: {
    onActivated: { addListener: jest.fn() },
    onRemoved: { addListener: jest.fn() },
    get: jest.fn(),
    query: jest.fn(),
    update: jest.fn(),
  },
  windows: {
    onFocusChanged: { addListener: jest.fn() },
    WINDOW_ID_NONE: -1,
  },
  webNavigation: { onCommitted: { addListener: jest.fn() } },
  alarms: {
    create: jest.fn(),
    onAlarm: { addListener: jest.fn() },
  },
};
