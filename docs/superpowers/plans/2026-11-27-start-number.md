# 連番の開始番号指定機能（`startNumber`）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** YAML のルートキー `startNumber` で連番バッジの開始番号を指定でき、未指定時は `1` から採番し、不正値時はエラーで処理を中断する機能を追加する。

**Architecture:** `sidepanel.js` の YAML パーサ・バリデータで `startNumber`（0 以上の安全な整数、未指定・`null` は `1`、不正値はエラー送出）を検証して `APPLY_ANNOTATIONS` メッセージに含め、`content.js` の `applyAnnotations(rules, options = {})` で開始番号からの連番採番と防御的バリデーションを行う。

**Tech Stack:** Chrome Extension (Manifest V3), Vanilla JavaScript, js-yaml, GJS (`gjs`) による自動テスト

## Global Constraints

- `startNumber` のデフォルト値は `1`。
- 許容する値は `0` 以上 `Number.MAX_SAFE_INTEGER` 以下の安全な整数（`typeof v === "number" && Number.isSafeInteger(v) && v >= 0`）。
- `startNumber` が未指定（`undefined`）または `null`（YAML の `startNumber:`）の場合のみ `1` を採用する。
- それ以外の不正値（負数、小数、空文字や数値文字列を含む文字列、真偽値、配列、オブジェクト、`NaN`、`Infinity`、安全な整数範囲外）はフォールバックせず、`'startNumber' は 0 以上の整数で指定してください。` で処理を中断する。
- `content.js` の `applyAnnotations(rules)` 呼び出し（第2引数省略）の後方互換を維持する。

---

### Task 1: 自動テストスイートの作成（Red）

**Files:**
- Create: `tests/run-tests.js`

**Interfaces:**
- Consumes: `lib/js-yaml.min.js`, `sidepanel.js` (`window.__webpageAnnotatorSidepanel`), `content.js` (`window.__webpageAnnotatorEngine`, `chrome.runtime.onMessage`)
- Produces: `gjs tests/run-tests.js` で実行可能な自動テストスイート

- [ ] **Step 1: `tests/run-tests.js` を作成**
  - `sidepanel.js` の `parseAndValidateYaml` の正常系（未指定、`null`、`0`、`10`、`Number.MAX_SAFE_INTEGER`）および異常系（`-1`、`1.5`、`"10"`、`""`、`true`、`false`、`[]`、`{}`、`.nan`、`.inf`、`9007199254740992`）を検証するテストを書く。
  - `content.js` の `applyAnnotations` の後方互換、`startNumber: 0` / `10` 採番、重複・非表示要素スキップ時の連続採番、不正な `startNumber` / `options` でのエラー返却、オーバーフロー時のエラー返却を検証するテストを書く。
  - `sidepanel.js` の適用ボタン押下から `content.js` の `onMessage` リスナーへ `startNumber` が連携される結合テストを書く。
- [ ] **Step 2: テストを実行し、実装前で失敗すること（Red）を確認**
  - Run: `gjs tests/run-tests.js`
  - Expected: `startNumber` 関連テストが失敗し、非ゼロ終了コードで終了する。

### Task 2: `sidepanel.js` の `startNumber` 対応（Green）

**Files:**
- Modify: `sidepanel.js:4-16`（定数追加）
- Modify: `sidepanel.js:82-145`（`parseAndValidateYaml` の検証と戻り値拡張）
- Modify: `sidepanel.js:246-249`（`APPLY_ANNOTATIONS` メッセージへの `startNumber` 追加）
- Modify: `sidepanel.js:309-315`（`DEFAULT_START_NUMBER` 公開）

**Interfaces:**
- Produces: `parseAndValidateYaml(yamlText)` → `{ rules, startNumber, warnings }`、`APPLY_ANNOTATIONS` メッセージ `{ type: "APPLY_ANNOTATIONS", rules, startNumber }`

- [ ] **Step 1: `sidepanel.js` に `DEFAULT_START_NUMBER`、バリデーション、メッセージ送信を追加**
- [ ] **Step 2: `gjs tests/run-tests.js` を実行し、`sidepanel.js` 単体テストが通ることを確認**

### Task 3: `content.js` の `startNumber` 対応（Green）

**Files:**
- Modify: `content.js:9-16`（定数追加）
- Modify: `content.js:206-287`（`applyAnnotations(rules, options = {})` の実装とオーバーフロー対策）
- Modify: `content.js:295-306`（`onMessage` での `startNumber` 受け渡し）

**Interfaces:**
- Consumes: `APPLY_ANNOTATIONS` メッセージの `message.startNumber`
- Produces: `applyAnnotations(rules, options = {})` → `{ ok, count, warnings } | { ok: false, error }`

- [ ] **Step 1: `content.js` に `DEFAULT_START_NUMBER`、`options.startNumber` の厳格検証、`startNumber + matchedEntries.length` 採番、オーバーフロー検知、`onMessage` 連携を実装**
- [ ] **Step 2: `gjs tests/run-tests.js` を実行し、全テストが PASS することを確認**

### Task 4: `README.md` の更新と最終検証

**Files:**
- Modify: `README.md:32-68`

- [ ] **Step 1: `README.md` に `startNumber` の仕様・設定例・バリデーション挙動を追記**
- [ ] **Step 2: `gjs tests/run-tests.js` および `git diff` で最終確認を実施**
