# 採番ルール選択機能（`numberingMode`）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** YAML のルートキー `numberingMode` で採番方式（`"global"`: 全体で採番 / `"perRule"`: ルールごとに採番）を選択でき、未指定時は `"global"`、不正値時はエラーで処理を中断する機能を追加する。

**Architecture:** `sidepanel.js` の `parseAndValidateYaml` で `numberingMode`（`"global"` または `"perRule"`、未指定・`null` は `"global"`、不正値はエラー送出）を検証して `APPLY_ANNOTATIONS` メッセージに含め、`content.js` の `applyAnnotations(rules, options = {})` で防御的バリデーションとモードに応じた採番（全体通番またはルールごとのリセット採番）を行う。

**Tech Stack:** Chrome Extension (Manifest V3), Vanilla JavaScript, js-yaml, GJS (`gjs`) による自動テスト

## Global Constraints

- `numberingMode` のデフォルト値は `"global"`。
- 許容する値は文字列 `"global"` または `"perRule"` のみ（完全一致）。
- `numberingMode` が未指定（`undefined`）または `null`（YAML の `numberingMode:`）の場合のみ `"global"` を採用する。
- それ以外の不正値（空文字 `""`、前後空白あり、大文字小文字違い、`"per-rule"`、その他の文字列、数値、真偽値、配列、オブジェクト）はフォールバックせず、`'numberingMode' は "global" または "perRule" で指定してください。` で処理を中断する。
- `numberingMode: "perRule"` のとき、各ルールは共通の `startNumber`（デフォルト `1`）から採番をリセットし、重複・非表示・オーバーレイ要素スキップ時に欠番を生じない。
- `content.js` の `applyAnnotations(rules)` および `applyAnnotations(rules, { startNumber })` 呼び出しの後方互換を維持する。
- 戻り値の `count` は従来どおり全ルールの合計描画件数（`trackedAnnotations.length`）を返す。

---

### Task 1: `numberingMode` 自動テストの追加（Red）

**Files:**
- Modify: `tests/run-tests.js:390-605`

**Interfaces:**
- Consumes: `sidepanel.js` (`window.__webpageAnnotatorSidepanel.parseAndValidateYaml`, `DEFAULT_NUMBERING_MODE`), `content.js` (`window.__webpageAnnotatorEngine.applyAnnotations`, `chrome.runtime.onMessage`)
- Produces: `numberingMode` の正常系・異常系・境界値・結合テスト

- [ ] **Step 1: `tests/run-tests.js` に `sidepanel.js` / `content.js` / 結合テストを追加**

`sidepanel.js` テスト:
```javascript
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
```

`content.js` および結合テスト:
- `numberingMode: "global"` で通番採番
- `numberingMode: "perRule"` で各ルールが `1`（および `startNumber: 0` / `startNumber: 10`）からリセット採番、かつ `count` は合計件数
- `numberingMode: "perRule"` で重複・非表示・幅 0 要素をスキップしても各ルールで欠番なし
- `numberingMode: "perRule"` で 0 件マッチのルールを挟んでも後続ルールが `startNumber` から採番
- `numberingMode: "perRule"` かつ `startNumber: Number.MAX_SAFE_INTEGER` で各ルール 1 件ずつなら成功、同一ルール 2 件なら上限超過エラー
- 不正な `numberingMode`（`""`, `"Global"`, `"per-rule"`, `" perRule "`, `1`, `true`, `[]`, `{}`）でエラー返却・オーバーレイ未生成
- 結合テスト: `sidepanel.js` で `startNumber: 5` + `numberingMode: "perRule"` を適用し、`content.js` でルールごとに `5, 6` / `5` が描画されること

- [ ] **Step 2: テストを実行し、実装前で失敗すること（Red）を確認**
  - Run: `gjs tests/run-tests.js`
  - Expected: 新規追加した `numberingMode` テストが FAIL し、非ゼロ終了コードで終了する。

---

### Task 2: `sidepanel.js` の `numberingMode` 対応（Green）

**Files:**
- Modify: `sidepanel.js:4-10`（定数追加）
- Modify: `sidepanel.js:87-158`（`parseAndValidateYaml` の検証と戻り値拡張）
- Modify: `sidepanel.js:259-264`（`APPLY_ANNOTATIONS` メッセージへの `numberingMode` 追加）
- Modify: `sidepanel.js:323-330`（`DEFAULT_NUMBERING_MODE` 公開）

**Interfaces:**
- Produces: `parseAndValidateYaml(yamlText)` → `{ rules, startNumber, numberingMode, warnings }`、`APPLY_ANNOTATIONS` メッセージ `{ type: "APPLY_ANNOTATIONS", rules, startNumber, numberingMode }`

- [ ] **Step 1: `sidepanel.js` に定数・バリデーション・メッセージ送信・公開プロパティを追加**

```javascript
const NUMBERING_MODE_GLOBAL = "global";
const NUMBERING_MODE_PER_RULE = "perRule";
const DEFAULT_NUMBERING_MODE = NUMBERING_MODE_GLOBAL;
const VALID_NUMBERING_MODES = new Set([NUMBERING_MODE_GLOBAL, NUMBERING_MODE_PER_RULE]);
```

```javascript
let numberingMode = DEFAULT_NUMBERING_MODE;
if (parsed.numberingMode !== undefined && parsed.numberingMode !== null) {
  if (
    typeof parsed.numberingMode !== "string" ||
    !VALID_NUMBERING_MODES.has(parsed.numberingMode)
  ) {
    throw new Error('\'numberingMode\' は "global" または "perRule" で指定してください。');
  }
  numberingMode = parsed.numberingMode;
}
```

- [ ] **Step 2: `gjs tests/run-tests.js` を実行し、`sidepanel.js` 単体テストがすべて PASS することを確認**
  - Run: `gjs tests/run-tests.js`
  - Expected: `sidepanel:` のテストがすべて PASS、`content:` および結合テストのみまだ FAIL。

---

### Task 3: `content.js` の `numberingMode` 対応（Green）

**Files:**
- Modify: `content.js:9-17`（定数追加）
- Modify: `content.js:226-287`（`options.numberingMode` の検証と採番ロジック分岐）
- Modify: `content.js:322-327`（`onMessage` での `numberingMode` 受け渡し）

**Interfaces:**
- Consumes: `APPLY_ANNOTATIONS` メッセージの `message.numberingMode`
- Produces: `applyAnnotations(rules, options = {})` → `{ ok, count, warnings } | { ok: false, error }`

- [ ] **Step 1: `content.js` に定数・`options.numberingMode` 検証・ルールごと採番ロジック・`onMessage` 連携を実装**

```javascript
const NUMBERING_MODE_GLOBAL = "global";
const NUMBERING_MODE_PER_RULE = "perRule";
const DEFAULT_NUMBERING_MODE = NUMBERING_MODE_GLOBAL;
const VALID_NUMBERING_MODES = new Set([NUMBERING_MODE_GLOBAL, NUMBERING_MODE_PER_RULE]);
```

```javascript
const rawNumberingMode = options ? options.numberingMode : undefined;
let numberingMode = DEFAULT_NUMBERING_MODE;
if (rawNumberingMode !== undefined && rawNumberingMode !== null) {
  if (
    typeof rawNumberingMode !== "string" ||
    !VALID_NUMBERING_MODES.has(rawNumberingMode)
  ) {
    return {
      ok: false,
      error: '\'numberingMode\' は "global" または "perRule" で指定してください。',
    };
  }
  numberingMode = rawNumberingMode;
}
```

```javascript
let ruleMatchedCount = 0;
for (const element of elements) {
  if (seenElements.has(element) || isOverlayNode(element)) {
    continue;
  }
  if (!isElementVisible(element)) {
    continue;
  }
  const offset =
    numberingMode === NUMBERING_MODE_PER_RULE ? ruleMatchedCount : matchedEntries.length;
  const nextIndex = startNumber + offset;
  if (!Number.isSafeInteger(nextIndex)) {
    return { ok: false, error: "連番が安全な整数の上限を超えました。" };
  }
  seenElements.add(element);
  ruleMatchedCount += 1;
  matchedEntries.push({
    element,
    color,
    padding,
    index: nextIndex,
  });
}
```

- [ ] **Step 2: `gjs tests/run-tests.js` を実行し、全テストが PASS することを確認**
  - Run: `gjs tests/run-tests.js`
  - Expected: `failed = 0`、終了コード `0`。

---

### Task 4: `README.md` の更新と最終検証・コミット

**Files:**
- Modify: `README.md:32-76`

- [ ] **Step 1: `README.md` の「使い方」「YAML 設定仕様」「バリデーションとエラー時の挙動」に `numberingMode` の説明を追記**
- [ ] **Step 2: `gjs tests/run-tests.js` および `git diff` を実行して最終確認**
- [ ] **Step 3: 変更をコミット**
