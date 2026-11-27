# 枠の角丸指定機能（`rounded`）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** YAML のルートキー `rounded`（真偽値、デフォルト `false`）でオーバーレイ枠線を角丸にするかどうかをグローバルに指定でき、連番バッジと一体化した描画・スクロール追従・厳格バリデーションを行う機能を追加する。

**Architecture:** `sidepanel.js` の `parseAndValidateYaml` で `rounded`（未指定・`null` は `false`、真偽値以外はエラー送出）を検証して `APPLY_ANNOTATIONS` メッセージに含め、`content.js` の `applyAnnotations(rules, options = {})` と `applyBoxPosition(item)` で防御的バリデーションおよびバッジ配置（`outside` / `inside`）連動の `borderRadius` 適用を行う。

**Tech Stack:** Chrome Extension (Manifest V3), Vanilla JavaScript, js-yaml, GJS (`gjs`) による自動テスト

## Global Constraints

- `rounded` のデフォルト値は `false`（従来の直角枠）。
- 許容する値は真偽値（`typeof v === "boolean"`）のみ。未指定（`undefined`）または YAML 上で値なし（`rounded:` → `null`）の場合のみ `false` を採用する。
- 真偽値以外（`"true"`, `"false"`, `""`, `yes`, `no`, `1`, `0`, `[]`, `{}` 等）はフォールバックせず、`'rounded' は真偽値（true または false）で指定してください。` で処理を中断する。
- 角丸半径は `ROUNDED_BORDER_RADIUS = 6`、内側バッジ左上角丸は `ROUNDED_INNER_BADGE_RADIUS = Math.max(0, ROUNDED_BORDER_RADIUS - BORDER_WIDTH)`（`4`）。
- 描画時の `borderRadius`:
  - `rounded: false`・`outside`: 枠 `"0px"`、バッジ `"3px 3px 0 0"`
  - `rounded: false`・`inside`: 枠 `"0px"`、バッジ `"0 0 3px 0"`
  - `rounded: true`・`outside`: 枠 `"0 6px 6px 6px"`、バッジ `"3px 3px 0 0"`
  - `rounded: true`・`inside`: 枠 `"6px"`、バッジ `"4px 0 3px 0"`
- `content.js` の既存呼び出し（`applyAnnotations(rules)` 等）との後方互換を維持する。

---

### Task 1: `rounded` 機能の自動テストを追加（Red）

**Files:**
- Modify: `tests/run-tests.js`

**Interfaces:**
- Consumes: `sidepanel.js` (`window.__webpageAnnotatorSidepanel.DEFAULT_ROUNDED`, `parseAndValidateYaml`), `content.js` (`window.__webpageAnnotatorEngine.applyAnnotations`, `updateAllPositions`, `chrome.runtime.onMessage`)
- Produces: `rounded` の単体テスト・位置追従テスト・結合テストを含む `tests/run-tests.js`

- [ ] **Step 1: `tests/run-tests.js` に `rounded` のテストを追加**
  - `sidepanel.js`:
    - `rounded` 未指定で `false` が返り、`DEFAULT_ROUNDED === false` が公開される。
    - `rounded:`（`null`）で `false` が返る。
    - `rounded: true` / `rounded: false` を許容する。
    - 不正値（`"true"`, `"false"`, `""`, `yes`, `no`, `1`, `0`, `[]`, `{}`）が `'rounded' は真偽値（true または false）で指定してください。` をスローする。
  - `content.js`:
    - `rounded` 省略（後方互換）および `{ rounded: false }` で外側・内側配置それぞれの `boxEl.style.borderRadius` / `badgeEl.style.borderRadius` を検証する。
    - `{ rounded: true }` で外側配置（枠 `"0 6px 6px 6px"` / バッジ `"3px 3px 0 0"`）と内側配置（枠 `"6px"` / バッジ `"4px 0 3px 0"`）を検証する。
    - `{ rounded: true }` で要素の `_rect.top` を変化させて `updateAllPositions()` を呼び、`outside` → `inside` および `inside` → `outside` の切り替えに連動して枠・バッジの `borderRadius` が更新されることを検証する。
    - 不正な `rounded`（`"true"`, `""`, `1`, `0`, `[]`, `{}`）で `{ ok: false, error: "'rounded' は真偽値（true または false）で指定してください。" }` を返しオーバーレイを生成しないことを検証する。
  - 結合テスト:
    - `sidepanel.js` で `rounded: true` を入力して描画適用すると、`APPLY_ANNOTATIONS` メッセージに `rounded: true` が含まれ、`content.js` で角丸枠が描画されることを検証する。
- [ ] **Step 2: テストを実行し、実装前で失敗すること（Red）を確認**
  - Run: `gjs tests/run-tests.js`
  - Expected: 追加した `rounded` 関連テストが失敗し、非ゼロ終了コードで終了する。

---

### Task 2: `sidepanel.js` の `rounded` 対応（Green）

**Files:**
- Modify: `sidepanel.js:4-23`（`DEFAULT_ROUNDED` 定数追加）
- Modify: `sidepanel.js:105-192`（`parseAndValidateYaml` での検証と戻り値への `rounded` 追加）
- Modify: `sidepanel.js:292-298`（`APPLY_ANNOTATIONS` メッセージへの `rounded` 追加）
- Modify: `sidepanel.js:357-368`（`window.__webpageAnnotatorSidepanel` への `DEFAULT_ROUNDED` 公開）

**Interfaces:**
- Produces:
  - `window.__webpageAnnotatorSidepanel.DEFAULT_ROUNDED` (`false`)
  - `parseAndValidateYaml(yamlText)` → `{ rules, startNumber, numberingMode, rounded, warnings }`
  - `APPLY_ANNOTATIONS` メッセージ `{ type: "APPLY_ANNOTATIONS", rules, startNumber, numberingMode, rounded }`

- [ ] **Step 1: `sidepanel.js` に定数・バリデーション・メッセージ送信・公開プロパティを追加**

```js
const DEFAULT_ROUNDED = false;
```

```js
let rounded = DEFAULT_ROUNDED;
if (parsed.rounded !== undefined && parsed.rounded !== null) {
  if (typeof parsed.rounded !== "boolean") {
    throw new Error("'rounded' は真偽値（true または false）で指定してください。");
  }
  rounded = parsed.rounded;
}
```

```js
return { rules, startNumber, numberingMode, rounded, warnings };
```

```js
const response = await sendMessageToTab(tab.id, {
  type: "APPLY_ANNOTATIONS",
  rules: parsedResult.rules,
  startNumber: parsedResult.startNumber,
  numberingMode: parsedResult.numberingMode,
  rounded: parsedResult.rounded,
});
```

- [ ] **Step 2: `gjs tests/run-tests.js` を実行し、`sidepanel.js` 関連テストが PASS することを確認**

---

### Task 3: `content.js` の `rounded` 対応（Green）

**Files:**
- Modify: `content.js:9-23`（`DEFAULT_ROUNDED`, `ROUNDED_BORDER_RADIUS`, `ROUNDED_INNER_BADGE_RADIUS` 定数追加）
- Modify: `content.js:82-116`（`applyBoxPosition` の `borderRadius` 動的設定）
- Modify: `content.js:246-265`（`applyAnnotations` での `options.rounded` バリデーション）
- Modify: `content.js:344-359`（`item` への `rounded` 保持）
- Modify: `content.js:372-386`（`onMessage` での `rounded: message.rounded` 受け渡し）

**Interfaces:**
- Consumes: `APPLY_ANNOTATIONS` メッセージの `message.rounded`
- Produces: `applyAnnotations(rules, options = {})` が `options.rounded` を反映した枠・バッジを描画する

- [ ] **Step 1: `content.js` に定数・バリデーション・`applyBoxPosition` の角丸描画・`onMessage` 連携を実装**

```js
const DEFAULT_ROUNDED = false;
const BADGE_HEIGHT = 18;
const BORDER_WIDTH = 2;
const ROUNDED_BORDER_RADIUS = 6;
const ROUNDED_INNER_BADGE_RADIUS = Math.max(0, ROUNDED_BORDER_RADIUS - BORDER_WIDTH);
```

```js
const { element, padding, rounded, boxEl, badgeEl } = item;
...
const isClippedAtTop = boxTop < BADGE_HEIGHT;
if (isClippedAtTop) {
  badgeEl.style.top = "0px";
  badgeEl.style.bottom = "auto";
  badgeEl.style.left = "0px";
  if (rounded) {
    boxEl.style.borderRadius = `${ROUNDED_BORDER_RADIUS}px`;
    badgeEl.style.borderRadius = `${ROUNDED_INNER_BADGE_RADIUS}px 0 3px 0`;
  } else {
    boxEl.style.borderRadius = "0px";
    badgeEl.style.borderRadius = "0 0 3px 0";
  }
  badgeEl.dataset.placement = "inside";
} else {
  badgeEl.style.top = "auto";
  badgeEl.style.bottom = "100%";
  badgeEl.style.left = `-${BORDER_WIDTH}px`;
  if (rounded) {
    boxEl.style.borderRadius = `0 ${ROUNDED_BORDER_RADIUS}px ${ROUNDED_BORDER_RADIUS}px ${ROUNDED_BORDER_RADIUS}px`;
  } else {
    boxEl.style.borderRadius = "0px";
  }
  badgeEl.style.borderRadius = "3px 3px 0 0";
  badgeEl.dataset.placement = "outside";
}
```

```js
const rawRounded = options ? options.rounded : undefined;
let rounded = DEFAULT_ROUNDED;
if (rawRounded !== undefined && rawRounded !== null) {
  if (typeof rawRounded !== "boolean") {
    return {
      ok: false,
      error: "'rounded' は真偽値（true または false）で指定してください。",
    };
  }
  rounded = rawRounded;
}
```

- [ ] **Step 2: `gjs tests/run-tests.js` を実行し、全テストが PASS することを確認**

---

### Task 4: `README.md` の更新と最終検証・コミット

**Files:**
- Modify: `README.md:32-84`

- [ ] **Step 1: `README.md` の「使い方」「YAML 設定仕様」「ルート項目表」「バリデーションとエラー時の挙動」に `rounded` を追記**
- [ ] **Step 2: `gjs tests/run-tests.js` を実行し、全テストが 0 failures で PASS することを確認**
- [ ] **Step 3: `git status` と `git diff` を確認し、実装計画・ソース・テスト・README をコミットする**
