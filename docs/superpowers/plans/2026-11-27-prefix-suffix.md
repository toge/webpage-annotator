# ルールごとの接頭辞・接尾辞指定機能（`prefix` / `suffix`）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** YAML の各ルール項目に `prefix`（接頭辞）・`suffix`（接尾辞）を追加し、バッジテキストおよび `data-webpage-annotator-box` / `data-webpage-annotator-badge` 属性を `${prefix}${index}${suffix}` で表示し、文字列以外の不正型時はエラーで処理を中断する機能を追加する。

**Architecture:** `sidepanel.js` の `parseAndValidateYaml` で各ルールの `prefix`・`suffix`（未指定・`null` は `""`、文字列は前後空白を含めそのまま保持、文字列以外はエラー送出）を検証してルール配列に含め、`content.js` の `applyAnnotations` で防御的バリデーションとラベル組み立て（`${prefix}${nextIndex}${suffix}`）を行い、`createAnnotationElements(label, color)` で DOM 属性とバッジテキストを設定する。

**Tech Stack:** Chrome Extension (Manifest V3), Vanilla JavaScript, js-yaml, GJS (`gjs`) による自動テスト

## Global Constraints

- `prefix`・`suffix` のデフォルト値はともに `""`。
- `undefined` または `null` のときのみデフォルト値 `""` を使用する。
- 文字列は前後空白を含めトリムせずそのまま保持する。
- 文字列以外の型（数値、真偽値、配列、オブジェクト等）が指定された場合はフォールバックせず、以下のエラーで処理を中断する。
  - `` `ルール #${ruleNo}: 'prefix' は文字列で指定してください。` ``
  - `` `ルール #${ruleNo}: 'suffix' は文字列で指定してください。` ``
- 算出した表示ラベル `` `${prefix}${nextIndex}${suffix}` `` は `badgeEl.textContent`、`data-webpage-annotator-box`、`data-webpage-annotator-badge` のすべてに設定する。
- `prefix`・`suffix` 未指定時は `String(nextIndex)` と完全一致し、後方互換を維持する。

---

### Task 1: `prefix` / `suffix` 自動テストの追加（Red）

**Files:**
- Modify: `tests/run-tests.js`

**Interfaces:**
- Consumes: `sidepanel.js` (`parseAndValidateYaml`, `DEFAULT_PREFIX`, `DEFAULT_SUFFIX`), `content.js` (`applyAnnotations`, `chrome.runtime.onMessage`)
- Produces: `prefix` / `suffix` の単体テスト・結合テスト

- [ ] **Step 1: `tests/run-tests.js` に `sidepanel.js` / `content.js` / 結合テストを追加**
  - `sidepanel.js`: 未指定・`null` で `""`、`DEFAULT_PREFIX` / `DEFAULT_SUFFIX` 公開、通常文字列・空文字・前後空白・日本語・記号の保持、不正型（数値、真偽値、配列、オブジェクト）でルール番号付きエラー送出。
  - `content.js`: `prefix` のみ / `suffix` のみ / 両方 / 未指定の混在、前後空白保持、`startNumber` + `numberingMode`（`"global"` / `"perRule"`）併用、`data-webpage-annotator-box` / `data-webpage-annotator-badge` / `badgeEl.textContent` 一致、不正型（マッチ 0 件ルール含む）でエラー返却・オーバーレイ未生成。
  - 結合テスト: `sidepanel.js` の描画適用から `content.js` の `onMessage` 経由でルール別の `prefix` / `suffix` が描画されること。
- [ ] **Step 2: `gjs tests/run-tests.js` を実行し、実装前で失敗すること（Red）を確認**
  - Run: `gjs tests/run-tests.js`
  - Expected: 新規追加した `prefix` / `suffix` テストが FAIL し、非ゼロ終了コードで終了する。

---

### Task 2: `sidepanel.js` の `prefix` / `suffix` 対応（Green）

**Files:**
- Modify: `sidepanel.js:4-15`（定数追加）
- Modify: `sidepanel.js:145-170`（ルールごとの `prefix` / `suffix` 検証・追加）
- Modify: `sidepanel.js:338-347`（`DEFAULT_PREFIX` / `DEFAULT_SUFFIX` 公開）

**Interfaces:**
- Produces: `rules` の各要素 `{ selector, color, padding, prefix, suffix }`、`DEFAULT_PREFIX`, `DEFAULT_SUFFIX`

- [ ] **Step 1: `sidepanel.js` に定数・バリデーション・ルール返却値・公開プロパティを追加**

```javascript
const DEFAULT_PREFIX = "";
const DEFAULT_SUFFIX = "";
```

```javascript
let prefix = DEFAULT_PREFIX;
if (rawRule.prefix !== undefined && rawRule.prefix !== null) {
  if (typeof rawRule.prefix !== "string") {
    throw new Error(`ルール #${ruleNo}: 'prefix' は文字列で指定してください。`);
  }
  prefix = rawRule.prefix;
}

let suffix = DEFAULT_SUFFIX;
if (rawRule.suffix !== undefined && rawRule.suffix !== null) {
  if (typeof rawRule.suffix !== "string") {
    throw new Error(`ルール #${ruleNo}: 'suffix' は文字列で指定してください。`);
  }
  suffix = rawRule.suffix;
}

rules.push({ selector, color, padding, prefix, suffix });
```

---

### Task 3: `content.js` の `prefix` / `suffix` 対応（Green）

**Files:**
- Modify: `content.js:9-20`（定数追加）
- Modify: `content.js:169-210`（`createAnnotationElements(label, color)` 更新）
- Modify: `content.js:255-340`（`rawRule.prefix` / `rawRule.suffix` 防御的検証と `label` 生成）

**Interfaces:**
- Consumes: `rules[i].prefix`, `rules[i].suffix`
- Produces: `applyAnnotations(rules, options = {})` によるラベル付きバッジ描画および不正型エラー返却

- [ ] **Step 1: `content.js` に定数・防御的バリデーション・ラベル生成・要素生成更新を実装**

```javascript
const DEFAULT_PREFIX = "";
const DEFAULT_SUFFIX = "";
```

```javascript
let prefix = DEFAULT_PREFIX;
if (rawRule.prefix !== undefined && rawRule.prefix !== null) {
  if (typeof rawRule.prefix !== "string") {
    return {
      ok: false,
      error: `ルール #${ruleIndex + 1}: 'prefix' は文字列で指定してください。`,
    };
  }
  prefix = rawRule.prefix;
}

let suffix = DEFAULT_SUFFIX;
if (rawRule.suffix !== undefined && rawRule.suffix !== null) {
  if (typeof rawRule.suffix !== "string") {
    return {
      ok: false,
      error: `ルール #${ruleIndex + 1}: 'suffix' は文字列で指定してください。`,
    };
  }
  suffix = rawRule.suffix;
}
```

```javascript
const label = `${prefix}${nextIndex}${suffix}`;
matchedEntries.push({
  element,
  color,
  padding,
  index: nextIndex,
  label,
});
```

- [ ] **Step 2: `gjs tests/run-tests.js` を実行し、全テストが PASS することを確認**
  - Run: `gjs tests/run-tests.js`
  - Expected: `failed = 0`、終了コード `0`。

---

### Task 4: `README.md` の更新と最終検証・コミット

**Files:**
- Modify: `README.md:32-85`

- [ ] **Step 1: `README.md` の「使い方」「YAML 設定仕様」「バリデーションとエラー時の挙動」に `prefix` / `suffix` の説明を追記**
- [ ] **Step 2: `gjs tests/run-tests.js` および `git diff` を実行して最終確認**
- [ ] **Step 3: 変更をコミット**
