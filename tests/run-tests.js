"use strict";

const GLib = imports.gi.GLib;

const PROJECT_ROOT = GLib.get_current_dir();

const readTextFile = (relativePath) => {
  const fullPath = GLib.build_filenamev([PROJECT_ROOT, relativePath]);
  const [ok, bytes] = GLib.file_get_contents(fullPath);
  if (!ok) {
    throw new Error(`ファイルの読み込みに失敗しました: ${fullPath}`);
  }
  return new TextDecoder("utf-8").decode(bytes);
};

const assertEqual = (actual, expected, message) => {
  if (actual !== expected) {
    throw new Error(`${message}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
};

const assertDeepEqual = (actual, expected, message) => {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}\n  expected: ${expectedJson}\n  actual:   ${actualJson}`);
  }
};

const assertThrows = (fn, expectedSubstring, message) => {
  let threw = false;
  try {
    fn();
  } catch (error) {
    threw = true;
    const errorMessage = error && error.message ? error.message : String(error);
    if (expectedSubstring && !errorMessage.includes(expectedSubstring)) {
      throw new Error(
        `${message}\n  expected error to include: ${JSON.stringify(expectedSubstring)}\n  actual error: ${JSON.stringify(errorMessage)}`
      );
    }
  }
  if (!threw) {
    throw new Error(`${message}\n  expected function to throw, but it did not`);
  }
};

class MockElement {
  constructor(tagName, options = {}) {
    this.tagName = String(tagName).toUpperCase();
    this.id = options.id || "";
    this.attributes = new Map();
    this.style = {};
    this.dataset = {};
    this.children = [];
    this.parentNode = null;
    this.textContent = "";
    this.value = "";
    this.className = "";
    this.disabled = false;
    this._listeners = new Map();
    this._rect = options.rect || { left: 20, top: 40, width: 100, height: 24 };
    this._computedDisplay = options.display || "block";
    this._isConnected = Boolean(options.connected);
    this._selectors = new Set(options.selectors || []);
  }

  get isConnected() {
    if (this._isConnected) {
      return true;
    }
    return this.parentNode ? this.parentNode.isConnected : false;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "id") {
      this.id = String(value);
    }
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  appendChild(child) {
    if (child instanceof MockDocumentFragment) {
      for (const fragChild of child.children) {
        fragChild.parentNode = this;
        this.children.push(fragChild);
      }
      child.children = [];
      return child;
    }
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (this.parentNode) {
      const idx = this.parentNode.children.indexOf(this);
      if (idx >= 0) {
        this.parentNode.children.splice(idx, 1);
      }
      this.parentNode = null;
    }
    this._isConnected = false;
  }

  closest(selector) {
    if (selector === '[data-webpage-annotator-overlay="true"]') {
      let current = this;
      while (current) {
        if (current.getAttribute && current.getAttribute("data-webpage-annotator-overlay") === "true") {
          return current;
        }
        current = current.parentNode;
      }
    }
    return null;
  }

  getBoundingClientRect() {
    return this._rect;
  }

  addEventListener(type, listener) {
    if (!this._listeners.has(type)) {
      this._listeners.set(type, []);
    }
    this._listeners.get(type).push(listener);
  }

  dispatchEvent(type, event = {}) {
    const handlers = this._listeners.get(type) || [];
    for (const handler of handlers) {
      handler(event);
    }
  }

  querySelectorAllByAttr(attrName) {
    const results = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (child.getAttribute && child.getAttribute(attrName) !== null) {
          results.push(child);
        }
        walk(child);
      }
    };
    walk(this);
    return results;
  }
}

class MockDocumentFragment {
  constructor() {
    this.children = [];
  }

  appendChild(child) {
    child.parentNode = null;
    this.children.push(child);
    return child;
  }

  querySelector(selector) {
    if (!selector || selector.includes("[invalid") || selector.includes(">>>")) {
      throw new Error(`Invalid selector: ${selector}`);
    }
    return null;
  }
}

const loadJsYaml = () => {
  const source = readTextFile("lib/js-yaml.min.js");
  const sandboxWindow = {};
  const fn = new Function("window", "self", "globalThis", `${source}\nreturn window.jsyaml;`);
  const jsyaml = fn(sandboxWindow, sandboxWindow, sandboxWindow);
  if (!jsyaml || typeof jsyaml.load !== "function") {
    throw new Error("js-yaml のロードに失敗しました");
  }
  return jsyaml;
};

const createSidepanelEnv = (jsyaml, sentMessages = [], tabResponse = { ok: true, count: 2, warnings: [] }) => {
  const elements = {
    "yaml-input": new MockElement("textarea", { id: "yaml-input", connected: true }),
    "apply-btn": new MockElement("button", { id: "apply-btn", connected: true }),
    "clear-btn": new MockElement("button", { id: "clear-btn", connected: true }),
    "status-message": new MockElement("div", { id: "status-message", connected: true }),
    "error-message": new MockElement("div", { id: "error-message", connected: true }),
  };

  const mockWindow = {
    jsyaml,
    setTimeout: () => 1,
    clearTimeout: () => {},
  };

  const mockDocument = {
    getElementById: (id) => elements[id] || null,
    createDocumentFragment: () => new MockDocumentFragment(),
    createElement: (tag) => new MockElement(tag),
  };

  const mockCSS = {
    supports: (_prop, value) => /^#[0-9a-fA-F]{3,6}$/.test(value) || value === "red" || value === "blue",
  };

  const mockChrome = {
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {},
      },
    },
    tabs: {
      query: async () => [{ id: 101 }],
      sendMessage: async (tabId, message) => {
        sentMessages.push({ tabId, message });
        return typeof tabResponse === "function" ? tabResponse(tabId, message) : tabResponse;
      },
    },
    scripting: {
      executeScript: async () => [],
    },
  };

  const source = readTextFile("sidepanel.js");
  const fn = new Function("window", "document", "CSS", "chrome", source);
  fn(mockWindow, mockDocument, mockCSS, mockChrome);

  return {
    window: mockWindow,
    elements,
    sidepanel: mockWindow.__webpageAnnotatorSidepanel,
  };
};

const createContentEnv = (pageElements = []) => {
  const body = new MockElement("body", { connected: true });
  for (const el of pageElements) {
    body.appendChild(el);
  }

  let messageListener = null;

  const mockWindow = {
    getComputedStyle: (el) => ({ display: el._computedDisplay || "block" }),
    requestAnimationFrame: (cb) => {
      cb();
      return 1;
    },
    cancelAnimationFrame: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const findById = (node, id) => {
    if (node.id === id) {
      return node;
    }
    for (const child of node.children) {
      const found = findById(child, id);
      if (found) {
        return found;
      }
    }
    return null;
  };

  const mockDocument = {
    body,
    getElementById: (id) => findById(body, id),
    createElement: (tag) => new MockElement(tag),
    createDocumentFragment: () => new MockDocumentFragment(),
    querySelectorAll: (selector) => {
      if (selector.includes("[invalid")) {
        throw new Error(`Invalid selector: ${selector}`);
      }
      return pageElements.filter((el) => el._selectors.has(selector));
    },
  };

  const mockChrome = {
    runtime: {
      onMessage: {
        addListener: (listener) => {
          messageListener = listener;
        },
      },
    },
  };

  const source = readTextFile("content.js");
  const fn = new Function("window", "document", "Element", "chrome", source);
  fn(mockWindow, mockDocument, MockElement, mockChrome);

  return {
    window: mockWindow,
    document: mockDocument,
    engine: mockWindow.__webpageAnnotatorEngine,
    dispatchMessage: (message) => {
      let response = null;
      messageListener(message, {}, (res) => {
        response = res;
      });
      return response;
    },
  };
};

const flushMicrotasks = () => {
  const loop = new GLib.MainLoop(null, false);
  GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
    loop.quit();
    return GLib.SOURCE_REMOVE;
  });
  loop.run();
};

const tests = [];
const test = (name, fn) => {
  tests.push({ name, fn });
};

const jsyaml = loadJsYaml();

// --- sidepanel.js: parseAndValidateYaml ---

test("sidepanel: startNumber 未指定時はデフォルト値 1 を返す", () => {
  const { sidepanel } = createSidepanelEnv(jsyaml);
  const result = sidepanel.parseAndValidateYaml('rules:\n  - selector: "a"\n');
  assertEqual(result.startNumber, 1, "startNumber は 1 であるべき");
  assertEqual(sidepanel.DEFAULT_START_NUMBER, 1, "DEFAULT_START_NUMBER が公開されるべき");
  assertEqual(result.warnings.length, 0, "警告は 0 件であるべき");
});

test("sidepanel: startNumber が null（値なし）のときはデフォルト値 1 を返す", () => {
  const { sidepanel } = createSidepanelEnv(jsyaml);
  const result = sidepanel.parseAndValidateYaml('startNumber:\nrules:\n  - selector: "a"\n');
  assertEqual(result.startNumber, 1, "startNumber: null は 1 になるべき");
  assertEqual(result.warnings.length, 0, "警告は 0 件であるべき");
});

test("sidepanel: startNumber: 0 を許容する", () => {
  const { sidepanel } = createSidepanelEnv(jsyaml);
  const result = sidepanel.parseAndValidateYaml('startNumber: 0\nrules:\n  - selector: "a"\n');
  assertEqual(result.startNumber, 0, "startNumber は 0 であるべき");
});

test("sidepanel: startNumber: 10 を許容する", () => {
  const { sidepanel } = createSidepanelEnv(jsyaml);
  const result = sidepanel.parseAndValidateYaml('startNumber: 10\nrules:\n  - selector: "a"\n');
  assertEqual(result.startNumber, 10, "startNumber は 10 であるべき");
});

test("sidepanel: startNumber に Number.MAX_SAFE_INTEGER を許容する", () => {
  const { sidepanel } = createSidepanelEnv(jsyaml);
  const result = sidepanel.parseAndValidateYaml(
    `startNumber: ${Number.MAX_SAFE_INTEGER}\nrules:\n  - selector: "a"\n`
  );
  assertEqual(result.startNumber, Number.MAX_SAFE_INTEGER, "MAX_SAFE_INTEGER が許容されるべき");
});

const invalidYamlCases = [
  ["負数 (-1)", "startNumber: -1"],
  ["小数 (1.5)", "startNumber: 1.5"],
  ["数字文字列 (\"10\")", 'startNumber: "10"'],
  ["空文字列 (\"\")", 'startNumber: ""'],
  ["文字列 (\"abc\")", 'startNumber: "abc"'],
  ["真偽値 (true)", "startNumber: true"],
  ["真偽値 (false)", "startNumber: false"],
  ["配列 ([1])", "startNumber: [1]"],
  ["オブジェクト ({})", "startNumber: {}"],
  ["NaN (.nan)", "startNumber: .nan"],
  ["Infinity (.inf)", "startNumber: .inf"],
  ["安全な整数範囲外 (MAX_SAFE_INTEGER + 1)", "startNumber: 9007199254740992"],
];

for (const [label, line] of invalidYamlCases) {
  test(`sidepanel: 不正な startNumber (${label}) はエラーで中断する`, () => {
    const { sidepanel } = createSidepanelEnv(jsyaml);
    assertThrows(
      () => sidepanel.parseAndValidateYaml(`${line}\nrules:\n  - selector: "a"\n`),
      "'startNumber' は 0 以上の整数で指定してください。",
      `不正値 (${label}) はエラーを投げるべき`
    );
  });
}

test("sidepanel: numberingMode 未指定時はデフォルト値 'global' を返す", () => {
  const { sidepanel } = createSidepanelEnv(jsyaml);
  const result = sidepanel.parseAndValidateYaml('rules:\n  - selector: "a"\n');
  assertEqual(result.numberingMode, "global", "numberingMode は 'global' であるべき");
  assertEqual(sidepanel.DEFAULT_NUMBERING_MODE, "global", "DEFAULT_NUMBERING_MODE が公開されるべき");
  assertEqual(result.warnings.length, 0, "警告は 0 件であるべき");
});

test("sidepanel: numberingMode が null（値なし）のときはデフォルト値 'global' を返す", () => {
  const { sidepanel } = createSidepanelEnv(jsyaml);
  const result = sidepanel.parseAndValidateYaml('numberingMode:\nrules:\n  - selector: "a"\n');
  assertEqual(result.numberingMode, "global", "numberingMode: null は 'global' になるべき");
  assertEqual(result.warnings.length, 0, "警告は 0 件であるべき");
});

test("sidepanel: numberingMode: 'global' を許容する", () => {
  const { sidepanel } = createSidepanelEnv(jsyaml);
  const result = sidepanel.parseAndValidateYaml('numberingMode: "global"\nrules:\n  - selector: "a"\n');
  assertEqual(result.numberingMode, "global", "numberingMode は 'global' であるべき");
});

test("sidepanel: numberingMode: 'perRule' を許容する", () => {
  const { sidepanel } = createSidepanelEnv(jsyaml);
  const result = sidepanel.parseAndValidateYaml('numberingMode: "perRule"\nrules:\n  - selector: "a"\n');
  assertEqual(result.numberingMode, "perRule", "numberingMode は 'perRule' であるべき");
});

const invalidNumberingModeYamlCases = [
  ["空文字列 (\"\")", 'numberingMode: ""'],
  ["大文字違い (\"Global\")", 'numberingMode: "Global"'],
  ["小文字違い (\"perrule\")", 'numberingMode: "perrule"'],
  ["ハイフン区切り (\"per-rule\")", 'numberingMode: "per-rule"'],
  ["前後空白あり (\" perRule \")", 'numberingMode: " perRule "'],
  ["未知の文字列 (\"rule\")", 'numberingMode: "rule"'],
  ["数値 (1)", "numberingMode: 1"],
  ["真偽値 (true)", "numberingMode: true"],
  ["真偽値 (false)", "numberingMode: false"],
  ["配列 ([\"global\"])", 'numberingMode: ["global"]'],
  ["オブジェクト ({})", "numberingMode: {}"],
];

for (const [label, line] of invalidNumberingModeYamlCases) {
  test(`sidepanel: 不正な numberingMode (${label}) はエラーで中断する`, () => {
    const { sidepanel } = createSidepanelEnv(jsyaml);
    assertThrows(
      () => sidepanel.parseAndValidateYaml(`${line}\nrules:\n  - selector: "a"\n`),
      '\'numberingMode\' は "global" または "perRule" で指定してください。',
      `不正値 (${label}) はエラーを投げるべき`
    );
  });
}

test("sidepanel: prefix / suffix 未指定時および null 時は空文字 '' を返す", () => {
  const { sidepanel } = createSidepanelEnv(jsyaml);
  assertEqual(sidepanel.DEFAULT_PREFIX, "", "DEFAULT_PREFIX が公開されるべき");
  assertEqual(sidepanel.DEFAULT_SUFFIX, "", "DEFAULT_SUFFIX が公開されるべき");

  const result = sidepanel.parseAndValidateYaml(
    [
      "rules:",
      '  - selector: "a"',
      '  - selector: "button"',
      "    prefix:",
      "    suffix:",
    ].join("\n")
  );
  assertEqual(result.rules[0].prefix, "", "未指定の prefix は '' であるべき");
  assertEqual(result.rules[0].suffix, "", "未指定の suffix は '' であるべき");
  assertEqual(result.rules[1].prefix, "", "null の prefix は '' であるべき");
  assertEqual(result.rules[1].suffix, "", "null の suffix は '' であるべき");
  assertEqual(result.warnings.length, 0, "警告は 0 件であるべき");
});

test("sidepanel: prefix / suffix の文字列は前後空白・日本語・記号を含めそのまま保持される", () => {
  const { sidepanel } = createSidepanelEnv(jsyaml);
  const result = sidepanel.parseAndValidateYaml(
    [
      "rules:",
      '  - selector: "a"',
      '    prefix: " L- "',
      '    suffix: " 件"',
      '  - selector: "button"',
      '    prefix: ""',
      '    suffix: "#"',
    ].join("\n")
  );
  assertEqual(result.rules[0].prefix, " L- ", "prefix の前後空白が保持されるべき");
  assertEqual(result.rules[0].suffix, " 件", "suffix の前後空白と日本語が保持されるべき");
  assertEqual(result.rules[1].prefix, "", "空文字 prefix が保持されるべき");
  assertEqual(result.rules[1].suffix, "#", "記号 suffix が保持されるべき");
});

const invalidPrefixSuffixCases = [
  ["数値 (123)", "123"],
  ["真偽値 (true)", "true"],
  ["真偽値 (false)", "false"],
  ["配列 ([\"a\"])", '["a"]'],
  ["オブジェクト ({})", "{}"],
];

for (const field of ["prefix", "suffix"]) {
  for (const [label, yamlValue] of invalidPrefixSuffixCases) {
    test(`sidepanel: 不正な ${field} (${label}) はルール番号付きエラーで中断する`, () => {
      const { sidepanel } = createSidepanelEnv(jsyaml);
      const yamlText = [
        "rules:",
        '  - selector: "a"',
        '  - selector: "button"',
        `    ${field}: ${yamlValue}`,
      ].join("\n");
      assertThrows(
        () => sidepanel.parseAndValidateYaml(yamlText),
        `ルール #2: '${field}' は文字列で指定してください。`,
        `不正な ${field} (${label}) はエラーを投げるべき`
      );
    });
  }
}

// --- content.js: applyAnnotations ---

test("content: 第2引数省略（後方互換）で 1 から連番採番される", () => {
  const elements = [
    new MockElement("a", { id: "a1", selectors: ["a"] }),
    new MockElement("a", { id: "a2", selectors: ["a"] }),
  ];
  const { engine, document } = createContentEnv(elements);
  const res = engine.applyAnnotations([{ selector: "a", color: "#FF3B30", padding: 0 }]);

  assertEqual(res.ok, true, "ok は true であるべき");
  assertEqual(res.count, 2, "count は 2 であるべき");

  const container = document.getElementById("__webpage-annotator-overlay-root");
  const badges = container.querySelectorAllByAttr("data-webpage-annotator-badge");
  const boxes = container.querySelectorAllByAttr("data-webpage-annotator-box");
  assertDeepEqual(
    badges.map((b) => b.textContent),
    ["1", "2"],
    "バッジテキストは 1, 2 であるべき"
  );
  assertDeepEqual(
    badges.map((b) => b.getAttribute("data-webpage-annotator-badge")),
    ["1", "2"],
    "badge 属性は 1, 2 であるべき"
  );
  assertDeepEqual(
    boxes.map((b) => b.getAttribute("data-webpage-annotator-box")),
    ["1", "2"],
    "box 属性は 1, 2 であるべき"
  );
});

test("content: startNumber: 0 で 0, 1, 2 から採番される", () => {
  const elements = [
    new MockElement("a", { id: "a1", selectors: ["a"] }),
    new MockElement("a", { id: "a2", selectors: ["a"] }),
    new MockElement("button", { id: "b1", selectors: ["button"] }),
  ];
  const { engine, document } = createContentEnv(elements);
  const res = engine.applyAnnotations(
    [
      { selector: "a", color: "#FF3B30", padding: 0 },
      { selector: "button", color: "#007AFF", padding: 2 },
    ],
    { startNumber: 0 }
  );

  assertEqual(res.ok, true, "ok は true であるべき");
  assertEqual(res.count, 3, "count は描画件数 3 であるべき");

  const container = document.getElementById("__webpage-annotator-overlay-root");
  const badges = container.querySelectorAllByAttr("data-webpage-annotator-badge");
  const boxes = container.querySelectorAllByAttr("data-webpage-annotator-box");
  assertDeepEqual(
    badges.map((b) => b.textContent),
    ["0", "1", "2"],
    "バッジテキストは 0, 1, 2 であるべき"
  );
  assertDeepEqual(
    boxes.map((b) => b.getAttribute("data-webpage-annotator-box")),
    ["0", "1", "2"],
    "box 属性は 0, 1, 2 であるべき"
  );
});

test("content: startNumber: 10 かつ重複・非表示要素スキップ時でも欠番なく 10, 11 と採番される", () => {
  const dupVisible = new MockElement("a", { id: "a1", selectors: ["a", ".special"] });
  const hidden = new MockElement("a", { id: "a2", selectors: ["a"], display: "none" });
  const zeroWidth = new MockElement("a", {
    id: "a3",
    selectors: ["a"],
    rect: { left: 0, top: 0, width: 0, height: 20 },
  });
  const secondVisible = new MockElement("button", { id: "b1", selectors: [".special"] });

  const { engine, document } = createContentEnv([dupVisible, hidden, zeroWidth, secondVisible]);
  const res = engine.applyAnnotations(
    [
      { selector: "a", color: "#FF3B30", padding: 0 },
      { selector: ".special", color: "#007AFF", padding: 0 },
    ],
    { startNumber: 10 }
  );

  assertEqual(res.ok, true, "ok は true であるべき");
  assertEqual(res.count, 2, "count は 2 であるべき");

  const container = document.getElementById("__webpage-annotator-overlay-root");
  const badges = container.querySelectorAllByAttr("data-webpage-annotator-badge");
  assertDeepEqual(
    badges.map((b) => b.textContent),
    ["10", "11"],
    "欠番なく 10, 11 と採番されるべき"
  );
});

for (const [label, invalidValue] of [
  ["負数 (-1)", -1],
  ["小数 (1.5)", 1.5],
  ["文字列 (\"10\")", "10"],
  ["真偽値 (true)", true],
  ["NaN", NaN],
  ["Infinity", Infinity],
  ["MAX_SAFE_INTEGER + 1", Number.MAX_SAFE_INTEGER + 1],
]) {
  test(`content: 不正な startNumber (${label}) はエラーを返しオーバーレイを生成しない`, () => {
    const elements = [new MockElement("a", { id: "a1", selectors: ["a"] })];
    const { engine, document } = createContentEnv(elements);
    const res = engine.applyAnnotations([{ selector: "a", color: "#FF3B30", padding: 0 }], {
      startNumber: invalidValue,
    });

    assertEqual(res.ok, false, "ok は false であるべき");
    assertEqual(
      res.error,
      "'startNumber' は 0 以上の整数で指定してください。",
      "期待するエラーメッセージが返るべき"
    );
    assertEqual(
      document.getElementById("__webpage-annotator-overlay-root"),
      null,
      "オーバーレイコンテナは生成されないべき"
    );
  });
}

test("content: 不正な options（配列やプリミティブ）はエラーを返す", () => {
  const elements = [new MockElement("a", { id: "a1", selectors: ["a"] })];
  const { engine } = createContentEnv(elements);
  const res1 = engine.applyAnnotations([{ selector: "a" }], []);
  const res2 = engine.applyAnnotations([{ selector: "a" }], 10);
  assertEqual(res1.ok, false, "配列 options はエラーであるべき");
  assertEqual(res2.ok, false, "数値 options はエラーであるべき");
});

test("content: startNumber が MAX_SAFE_INTEGER のとき1件なら成功し2件以上ならエラーを返す", () => {
  const oneEl = [new MockElement("a", { id: "a1", selectors: ["a"] })];
  const env1 = createContentEnv(oneEl);
  const res1 = env1.engine.applyAnnotations([{ selector: "a" }], {
    startNumber: Number.MAX_SAFE_INTEGER,
  });
  assertEqual(res1.ok, true, "1件なら成功するべき");
  const container1 = env1.document.getElementById("__webpage-annotator-overlay-root");
  assertDeepEqual(
    container1.querySelectorAllByAttr("data-webpage-annotator-badge").map((b) => b.textContent),
    [String(Number.MAX_SAFE_INTEGER)],
    "MAX_SAFE_INTEGER がバッジに表示されるべき"
  );

  const twoEls = [
    new MockElement("a", { id: "a1", selectors: ["a"] }),
    new MockElement("a", { id: "a2", selectors: ["a"] }),
  ];
  const env2 = createContentEnv(twoEls);
  const res2 = env2.engine.applyAnnotations([{ selector: "a" }], {
    startNumber: Number.MAX_SAFE_INTEGER,
  });
  assertEqual(res2.ok, false, "2件以上で安全な整数上限を超えたらエラーを返すべき");
  assertEqual(
    res2.error,
    "連番が安全な整数の上限を超えました。",
    "上限超過エラーメッセージが返るべき"
  );
  assertEqual(
    env2.document.getElementById("__webpage-annotator-overlay-root"),
    null,
    "オーバーレイは生成されないべき"
  );
});

test("content: numberingMode: 'global' 指定時は複数ルールを通して連番採番される", () => {
  const elements = [
    new MockElement("a", { id: "a1", selectors: ["a"] }),
    new MockElement("a", { id: "a2", selectors: ["a"] }),
    new MockElement("button", { id: "b1", selectors: ["button"] }),
    new MockElement("button", { id: "b2", selectors: ["button"] }),
  ];
  const { engine, document } = createContentEnv(elements);
  const res = engine.applyAnnotations(
    [
      { selector: "a", color: "#FF3B30", padding: 0 },
      { selector: "button", color: "#007AFF", padding: 0 },
    ],
    { numberingMode: "global" }
  );

  assertEqual(res.ok, true, "ok は true であるべき");
  assertEqual(res.count, 4, "count は 4 であるべき");

  const container = document.getElementById("__webpage-annotator-overlay-root");
  const badges = container.querySelectorAllByAttr("data-webpage-annotator-badge");
  assertDeepEqual(
    badges.map((b) => b.textContent),
    ["1", "2", "3", "4"],
    "全体で 1, 2, 3, 4 と採番されるべき"
  );
});

test("content: numberingMode: 'perRule' 指定時は各ルールごとにデフォルト 1 からリセット採番される", () => {
  const elements = [
    new MockElement("a", { id: "a1", selectors: ["a"] }),
    new MockElement("a", { id: "a2", selectors: ["a"] }),
    new MockElement("button", { id: "b1", selectors: ["button"] }),
    new MockElement("button", { id: "b2", selectors: ["button"] }),
    new MockElement("button", { id: "b3", selectors: ["button"] }),
  ];
  const { engine, document } = createContentEnv(elements);
  const res = engine.applyAnnotations(
    [
      { selector: "a", color: "#FF3B30", padding: 0 },
      { selector: "button", color: "#007AFF", padding: 0 },
    ],
    { numberingMode: "perRule" }
  );

  assertEqual(res.ok, true, "ok は true であるべき");
  assertEqual(res.count, 5, "count は合計描画件数 5 であるべき");

  const container = document.getElementById("__webpage-annotator-overlay-root");
  const badges = container.querySelectorAllByAttr("data-webpage-annotator-badge");
  const boxes = container.querySelectorAllByAttr("data-webpage-annotator-box");
  assertDeepEqual(
    badges.map((b) => b.textContent),
    ["1", "2", "1", "2", "3"],
    "ルールごとに 1, 2 / 1, 2, 3 と採番されるべき"
  );
  assertDeepEqual(
    badges.map((b) => b.getAttribute("data-webpage-annotator-badge")),
    ["1", "2", "1", "2", "3"],
    "badge 属性もルールごとに採番されるべき"
  );
  assertDeepEqual(
    boxes.map((b) => b.getAttribute("data-webpage-annotator-box")),
    ["1", "2", "1", "2", "3"],
    "box 属性もルールごとに採番されるべき"
  );
});

test("content: numberingMode: 'perRule' かつ startNumber: 0 / 10 で各ルールが指定番号からリセット採番される", () => {
  const makeElements = () => [
    new MockElement("a", { id: "a1", selectors: ["a"] }),
    new MockElement("a", { id: "a2", selectors: ["a"] }),
    new MockElement("button", { id: "b1", selectors: ["button"] }),
    new MockElement("button", { id: "b2", selectors: ["button"] }),
  ];

  const envZero = createContentEnv(makeElements());
  const resZero = envZero.engine.applyAnnotations(
    [
      { selector: "a", color: "#FF3B30", padding: 0 },
      { selector: "button", color: "#007AFF", padding: 0 },
    ],
    { startNumber: 0, numberingMode: "perRule" }
  );
  assertEqual(resZero.ok, true, "startNumber: 0 で ok は true であるべき");
  assertDeepEqual(
    envZero.document
      .getElementById("__webpage-annotator-overlay-root")
      .querySelectorAllByAttr("data-webpage-annotator-badge")
      .map((b) => b.textContent),
    ["0", "1", "0", "1"],
    "各ルールが 0 から採番されるべき"
  );

  const envTen = createContentEnv(makeElements());
  const resTen = envTen.engine.applyAnnotations(
    [
      { selector: "a", color: "#FF3B30", padding: 0 },
      { selector: "button", color: "#007AFF", padding: 0 },
    ],
    { startNumber: 10, numberingMode: "perRule" }
  );
  assertEqual(resTen.ok, true, "startNumber: 10 で ok は true であるべき");
  assertDeepEqual(
    envTen.document
      .getElementById("__webpage-annotator-overlay-root")
      .querySelectorAllByAttr("data-webpage-annotator-badge")
      .map((b) => b.textContent),
    ["10", "11", "10", "11"],
    "各ルールが 10 から採番されるべき"
  );
});

test("content: numberingMode: 'perRule' で重複・非表示・幅0要素をスキップしても欠番なく採番される", () => {
  const dupVisible = new MockElement("a", { id: "a1", selectors: ["a", ".special"] });
  const hidden = new MockElement("a", { id: "a2", selectors: ["a"], display: "none" });
  const zeroWidth = new MockElement("a", {
    id: "a3",
    selectors: ["a"],
    rect: { left: 0, top: 0, width: 0, height: 20 },
  });
  const secondA = new MockElement("a", { id: "a4", selectors: ["a"] });
  const firstSpecialOnly = new MockElement("button", { id: "b1", selectors: [".special"] });
  const secondSpecialOnly = new MockElement("button", { id: "b2", selectors: [".special"] });

  const { engine, document } = createContentEnv([
    dupVisible,
    hidden,
    zeroWidth,
    secondA,
    firstSpecialOnly,
    secondSpecialOnly,
  ]);
  const res = engine.applyAnnotations(
    [
      { selector: "a", color: "#FF3B30", padding: 0 },
      { selector: ".special", color: "#007AFF", padding: 0 },
    ],
    { startNumber: 1, numberingMode: "perRule" }
  );

  assertEqual(res.ok, true, "ok は true であるべき");
  assertEqual(res.count, 4, "count は 4 であるべき");

  const container = document.getElementById("__webpage-annotator-overlay-root");
  const badges = container.querySelectorAllByAttr("data-webpage-annotator-badge");
  assertDeepEqual(
    badges.map((b) => b.textContent),
    ["1", "2", "1", "2"],
    "重複・非表示要素スキップ後もルールごとに欠番なく 1, 2 / 1, 2 と採番されるべき"
  );
});

test("content: numberingMode: 'perRule' で 0 件マッチのルールを挟んでも後続ルールが正しく採番される", () => {
  const elements = [
    new MockElement("a", { id: "a1", selectors: ["a"] }),
    new MockElement("button", { id: "b1", selectors: ["button"] }),
    new MockElement("button", { id: "b2", selectors: ["button"] }),
  ];
  const { engine, document } = createContentEnv(elements);
  const res = engine.applyAnnotations(
    [
      { selector: "a", color: "#FF3B30", padding: 0 },
      { selector: ".not-found", color: "#34C759", padding: 0 },
      { selector: "button", color: "#007AFF", padding: 0 },
    ],
    { startNumber: 3, numberingMode: "perRule" }
  );

  assertEqual(res.ok, true, "ok は true であるべき");
  assertEqual(res.count, 3, "count は 3 であるべき");
  assertDeepEqual(
    document
      .getElementById("__webpage-annotator-overlay-root")
      .querySelectorAllByAttr("data-webpage-annotator-badge")
      .map((b) => b.textContent),
    ["3", "3", "4"],
    "0件マッチのルールを挟んでも後続ルールが 3, 4 で採番されるべき"
  );
});

test("content: numberingMode: 'perRule' かつ MAX_SAFE_INTEGER のとき各ルール1件なら成功し同一ルール2件ならエラー", () => {
  const onePerRule = [
    new MockElement("a", { id: "a1", selectors: ["a"] }),
    new MockElement("button", { id: "b1", selectors: ["button"] }),
  ];
  const envOk = createContentEnv(onePerRule);
  const resOk = envOk.engine.applyAnnotations(
    [{ selector: "a" }, { selector: "button" }],
    { startNumber: Number.MAX_SAFE_INTEGER, numberingMode: "perRule" }
  );
  assertEqual(resOk.ok, true, "各ルール1件ずつなら成功するべき");
  assertDeepEqual(
    envOk.document
      .getElementById("__webpage-annotator-overlay-root")
      .querySelectorAllByAttr("data-webpage-annotator-badge")
      .map((b) => b.textContent),
    [String(Number.MAX_SAFE_INTEGER), String(Number.MAX_SAFE_INTEGER)],
    "各ルールが MAX_SAFE_INTEGER で描画されるべき"
  );

  const twoInSameRule = [
    new MockElement("a", { id: "a1", selectors: ["a"] }),
    new MockElement("a", { id: "a2", selectors: ["a"] }),
  ];
  const envErr = createContentEnv(twoInSameRule);
  const resErr = envErr.engine.applyAnnotations([{ selector: "a" }], {
    startNumber: Number.MAX_SAFE_INTEGER,
    numberingMode: "perRule",
  });
  assertEqual(resErr.ok, false, "同一ルール2件で上限超過エラーを返すべき");
  assertEqual(
    resErr.error,
    "連番が安全な整数の上限を超えました。",
    "上限超過エラーメッセージが返るべき"
  );
  assertEqual(
    envErr.document.getElementById("__webpage-annotator-overlay-root"),
    null,
    "オーバーレイは生成されないべき"
  );
});

for (const [label, invalidMode] of [
  ["空文字列 (\"\")", ""],
  ["大文字違い (\"Global\")", "Global"],
  ["ハイフン区切り (\"per-rule\")", "per-rule"],
  ["前後空白あり (\" perRule \")", " perRule "],
  ["数値 (1)", 1],
  ["真偽値 (true)", true],
  ["配列 ([])", []],
  ["オブジェクト ({})", {}],
]) {
  test(`content: 不正な numberingMode (${label}) はエラーを返しオーバーレイを生成しない`, () => {
    const elements = [new MockElement("a", { id: "a1", selectors: ["a"] })];
    const { engine, document } = createContentEnv(elements);
    const res = engine.applyAnnotations([{ selector: "a", color: "#FF3B30", padding: 0 }], {
      numberingMode: invalidMode,
    });

    assertEqual(res.ok, false, "ok は false であるべき");
    assertEqual(
      res.error,
      '\'numberingMode\' は "global" または "perRule" で指定してください。',
      "期待するエラーメッセージが返るべき"
    );
    assertEqual(
      document.getElementById("__webpage-annotator-overlay-root"),
      null,
      "オーバーレイコンテナは生成されないべき"
    );
  });
}

test("content: ルールごとに prefix / suffix を設定するとバッジと data 属性に反映される", () => {
  const elements = [
    new MockElement("a", { id: "a1", selectors: ["a"] }),
    new MockElement("a", { id: "a2", selectors: ["a"] }),
    new MockElement("button", { id: "b1", selectors: ["button"] }),
    new MockElement("input", { id: "i1", selectors: ["input"] }),
    new MockElement("span", { id: "s1", selectors: ["span"] }),
  ];
  const { engine, document } = createContentEnv(elements);
  const res = engine.applyAnnotations(
    [
      { selector: "a", color: "#FF3B30", padding: 0, prefix: "L-" },
      { selector: "button", color: "#007AFF", padding: 0, suffix: "件" },
      { selector: "input", color: "#34C759", padding: 0, prefix: " IN ", suffix: " pt" },
      { selector: "span", color: "#AF52DE", padding: 0 },
    ],
    { startNumber: 1, numberingMode: "perRule" }
  );

  assertEqual(res.ok, true, "ok は true であるべき");
  assertEqual(res.count, 5, "count は 5 であるべき");

  const container = document.getElementById("__webpage-annotator-overlay-root");
  const badges = container.querySelectorAllByAttr("data-webpage-annotator-badge");
  const boxes = container.querySelectorAllByAttr("data-webpage-annotator-box");
  const expectedLabels = ["L-1", "L-2", "1件", " IN 1 pt", "1"];

  assertDeepEqual(
    badges.map((b) => b.textContent),
    expectedLabels,
    "バッジテキストが期待するラベルと一致するべき"
  );
  assertDeepEqual(
    badges.map((b) => b.getAttribute("data-webpage-annotator-badge")),
    expectedLabels,
    "data-webpage-annotator-badge 属性が期待するラベルと一致するべき"
  );
  assertDeepEqual(
    boxes.map((b) => b.getAttribute("data-webpage-annotator-box")),
    expectedLabels,
    "data-webpage-annotator-box 属性が期待するラベルと一致するべき"
  );
});

test("content: prefix / suffix と numberingMode: 'global'・startNumber: 10 の組み合わせ", () => {
  const elements = [
    new MockElement("a", { id: "a1", selectors: ["a"] }),
    new MockElement("button", { id: "b1", selectors: ["button"] }),
  ];
  const { engine, document } = createContentEnv(elements);
  const res = engine.applyAnnotations(
    [
      { selector: "a", color: "#FF3B30", padding: 0, prefix: "A-" },
      { selector: "button", color: "#007AFF", padding: 0, prefix: "B-", suffix: "!" },
    ],
    { startNumber: 10, numberingMode: "global" }
  );

  assertEqual(res.ok, true, "ok は true であるべき");
  const badges = document
    .getElementById("__webpage-annotator-overlay-root")
    .querySelectorAllByAttr("data-webpage-annotator-badge");
  assertDeepEqual(
    badges.map((b) => b.textContent),
    ["A-10", "B-11!"],
    "全体採番とルール別接頭辞・接尾辞が組み合わさるべき"
  );
});

for (const field of ["prefix", "suffix"]) {
  for (const [label, invalidValue] of [
    ["数値 (123)", 123],
    ["真偽値 (true)", true],
    ["配列 ([])", []],
    ["オブジェクト ({})", {}],
  ]) {
    test(`content: 不正な ${field} (${label}) はマッチ 0 件のルールでもエラーを返しオーバーレイを生成しない`, () => {
      const elements = [new MockElement("a", { id: "a1", selectors: ["a"] })];
      const { engine, document } = createContentEnv(elements);
      const res = engine.applyAnnotations([
        { selector: "a", color: "#FF3B30", padding: 0 },
        { selector: ".no-match", color: "#007AFF", padding: 0, [field]: invalidValue },
      ]);

      assertEqual(res.ok, false, "ok は false であるべき");
      assertEqual(
        res.error,
        `ルール #2: '${field}' は文字列で指定してください。`,
        "期待するエラーメッセージが返るべき"
      );
      assertEqual(
        document.getElementById("__webpage-annotator-overlay-root"),
        null,
        "オーバーレイコンテナは生成されないべき"
      );
    });
  }
}

// --- 結合テスト: sidepanel.js -> content.js ---

test("integration: sidepanel の描画適用から content の onMessage 経由で startNumber が反映される", () => {
  const elements = [
    new MockElement("a", { id: "a1", selectors: ["a"] }),
    new MockElement("a", { id: "a2", selectors: ["a"] }),
  ];
  const contentEnv = createContentEnv(elements);
  const sentMessages = [];
  const sidepanelEnv = createSidepanelEnv(jsyaml, sentMessages, (_tabId, message) =>
    contentEnv.dispatchMessage(message)
  );

  sidepanelEnv.elements["yaml-input"].value = [
    "startNumber: 5",
    "rules:",
    '  - selector: "a"',
    '    color: "#FF3B30"',
  ].join("\n");

  sidepanelEnv.elements["apply-btn"].dispatchEvent("click");
  flushMicrotasks();

  assertEqual(sentMessages.length, 1, "メッセージが1回送信されるべき");
  assertEqual(sentMessages[0].message.type, "APPLY_ANNOTATIONS", "APPLY_ANNOTATIONS が送信されるべき");
  assertEqual(sentMessages[0].message.startNumber, 5, "startNumber: 5 が送信されるべき");

  const container = contentEnv.document.getElementById("__webpage-annotator-overlay-root");
  const badges = container.querySelectorAllByAttr("data-webpage-annotator-badge");
  assertDeepEqual(
    badges.map((b) => b.textContent),
    ["5", "6"],
    "content.js で 5, 6 が描画されるべき"
  );
  assertEqual(
    sidepanelEnv.elements["status-message"].textContent,
    "2 件の要素にオーバーレイを描画しました。",
    "ステータスメッセージが正しく表示されるべき"
  );
});

test("integration: sidepanel の描画適用から content の onMessage 経由で numberingMode: 'perRule' が反映される", () => {
  const elements = [
    new MockElement("a", { id: "a1", selectors: ["a"] }),
    new MockElement("a", { id: "a2", selectors: ["a"] }),
    new MockElement("button", { id: "b1", selectors: ["button"] }),
  ];
  const contentEnv = createContentEnv(elements);
  const sentMessages = [];
  const sidepanelEnv = createSidepanelEnv(jsyaml, sentMessages, (_tabId, message) =>
    contentEnv.dispatchMessage(message)
  );

  sidepanelEnv.elements["yaml-input"].value = [
    "startNumber: 5",
    'numberingMode: "perRule"',
    "rules:",
    '  - selector: "a"',
    '    color: "#FF3B30"',
    '  - selector: "button"',
    '    color: "#007AFF"',
  ].join("\n");

  sidepanelEnv.elements["apply-btn"].dispatchEvent("click");
  flushMicrotasks();

  assertEqual(sentMessages.length, 1, "メッセージが1回送信されるべき");
  assertEqual(sentMessages[0].message.type, "APPLY_ANNOTATIONS", "APPLY_ANNOTATIONS が送信されるべき");
  assertEqual(sentMessages[0].message.startNumber, 5, "startNumber: 5 が送信されるべき");
  assertEqual(sentMessages[0].message.numberingMode, "perRule", "numberingMode: 'perRule' が送信されるべき");

  const container = contentEnv.document.getElementById("__webpage-annotator-overlay-root");
  const badges = container.querySelectorAllByAttr("data-webpage-annotator-badge");
  assertDeepEqual(
    badges.map((b) => b.textContent),
    ["5", "6", "5"],
    "content.js でルールごとに 5, 6 / 5 が描画されるべき"
  );
  assertEqual(
    sidepanelEnv.elements["status-message"].textContent,
    "3 件の要素にオーバーレイを描画しました。",
    "ステータスメッセージが合計件数 3 で表示されるべき"
  );
});

test("integration: sidepanel からルール別の prefix / suffix が content に反映される", () => {
  const elements = [
    new MockElement("a", { id: "a1", selectors: ["a"] }),
    new MockElement("a", { id: "a2", selectors: ["a"] }),
    new MockElement("button", { id: "b1", selectors: ["button"] }),
  ];
  const contentEnv = createContentEnv(elements);
  const sentMessages = [];
  const sidepanelEnv = createSidepanelEnv(jsyaml, sentMessages, (_tabId, message) =>
    contentEnv.dispatchMessage(message)
  );

  sidepanelEnv.elements["yaml-input"].value = [
    "startNumber: 1",
    'numberingMode: "perRule"',
    "rules:",
    '  - selector: "a"',
    '    color: "#FF3B30"',
    '    prefix: "L-"',
    '  - selector: "button"',
    '    color: "#007AFF"',
    '    prefix: "BTN "',
    '    suffix: "件"',
  ].join("\n");

  sidepanelEnv.elements["apply-btn"].dispatchEvent("click");
  flushMicrotasks();

  assertEqual(sentMessages.length, 1, "メッセージが1回送信されるべき");
  assertEqual(sentMessages[0].message.rules[0].prefix, "L-", "ルール1の prefix が送信されるべき");
  assertEqual(sentMessages[0].message.rules[0].suffix, "", "ルール1の suffix は '' が送信されるべき");
  assertEqual(sentMessages[0].message.rules[1].prefix, "BTN ", "ルール2の prefix が送信されるべき");
  assertEqual(sentMessages[0].message.rules[1].suffix, "件", "ルール2の suffix が送信されるべき");

  const container = contentEnv.document.getElementById("__webpage-annotator-overlay-root");
  const badges = container.querySelectorAllByAttr("data-webpage-annotator-badge");
  const boxes = container.querySelectorAllByAttr("data-webpage-annotator-box");
  assertDeepEqual(
    badges.map((b) => b.textContent),
    ["L-1", "L-2", "BTN 1件"],
    "content.js でルール別の接頭辞・接尾辞付きラベルが描画されるべき"
  );
  assertDeepEqual(
    boxes.map((b) => b.getAttribute("data-webpage-annotator-box")),
    ["L-1", "L-2", "BTN 1件"],
    "box 属性もルール別のラベルと一致するべき"
  );
});

let passed = 0;
let failed = 0;

for (const { name, fn } of tests) {
  try {
    fn();
    print(`PASS: ${name}`);
    passed += 1;
  } catch (error) {
    printerr(`FAIL: ${name}\n  ${error && error.message ? error.message : String(error)}`);
    failed += 1;
  }
}

print(`\nSummary: ${passed} passed, ${failed} failed (total ${tests.length})`);
if (failed > 0) {
  imports.system.exit(1);
}
