# 採番ルール選択機能（`numberingMode`）設計書

## 概要

YAML 設定のルートに任意の `numberingMode` キーを追加し、オーバーレイ描画時の連番バッジの採番方式を「全体で採番（`"global"`）」または「ルールごとに採番（`"perRule"`）」から選択できるようにする。指定がなければ従来どおり `"global"` として動作する。

不正な値が指定された場合は自動フォールバックせず、設定ミスに確実に気付けるようエラーとして処理を中断する。

## YAML 設定仕様

### 設定例

```yaml
startNumber: 1
numberingMode: "perRule" # "global"（省略時: 全体で採番）または "perRule"（ルールごとに採番）
rules:
  - selector: "a"
    color: "#FF3B30"
    padding: 2
  - selector: "button, input[type='submit']"
    color: "#007AFF"
    padding: 4
```

### ルート項目

| キー | 必須 | 型 | デフォルト値 | 説明 |
| --- | --- | --- | --- | --- |
| `startNumber` | 任意 | 整数（0以上） | `1` | 連番バッジの開始番号（`0` 以上 `Number.MAX_SAFE_INTEGER` 以下の整数） |
| `numberingMode` | 任意 | 文字列 | `"global"` | 採番方式（`"global"`: 全体で採番、`"perRule"`: ルールごとに採番） |
| `rules` | 必須 | 配列 | なし | 描画ルールの配列 |

### 採番挙動

- `numberingMode: "global"`（デフォルト）:
  - 全ルールを通じて `startNumber` から連続した番号（`startNumber`, `startNumber + 1`, ...）を採番する。
- `numberingMode: "perRule"`:
  - 各ルールごとに `startNumber` から採番をリセットする（ルール 1 が `startNumber, startNumber + 1, ...`、ルール 2 も `startNumber, startNumber + 1, ...`）。
  - 複数ルールに重複マッチする要素は従来どおり先頭ルールを優先して 1 回のみ描画し、後続ルールではスキップする。スキップされた要素は後続ルールのカウンタを進めないため欠番は生じない。
  - 非表示要素・描画サイズ 0 以下の要素・オーバーレイ自身の要素も従来どおりスキップし、カウンタを進めない。
  - マッチ件数が 0 件のルールを挟んでも、後続ルールは `startNumber` から正常に採番する。
  - 戻り値の `count` は従来どおり全ルールの合計描画件数（`trackedAnnotations.length`）を返す。

### バリデーション規則

- `numberingMode` が未指定（`undefined`）または YAML 上で値が空（`numberingMode:` → `null`）の場合はデフォルト値 `"global"` を使用する。
- それ以外の場合は `typeof value === "string"` かつ `value === "global" || value === "perRule"` の厳密一致を満たす必要がある。
- 空文字列 `""`、前後空白を含む文字列（`" perRule "`）、大文字小文字違い（`"Global"`, `"perrule"`）、ハイフン区切り（`"per-rule"`）、その他の文字列、数値、真偽値、配列、オブジェクトが指定された場合は、エラーメッセージ `'numberingMode' は "global" または "perRule" で指定してください。` を表示して処理を中断する。

## コンポーネント設計

### 1. `sidepanel.js`

- 定数を定義する。
  - `NUMBERING_MODE_GLOBAL = "global"`
  - `NUMBERING_MODE_PER_RULE = "perRule"`
  - `DEFAULT_NUMBERING_MODE = NUMBERING_MODE_GLOBAL`
  - `VALID_NUMBERING_MODES = new Set([NUMBERING_MODE_GLOBAL, NUMBERING_MODE_PER_RULE])`
- `parseAndValidateYaml(yamlText)` に `parsed.numberingMode` のバリデーションを追加する。
  - `parsed.numberingMode === undefined || parsed.numberingMode === null` のときは `DEFAULT_NUMBERING_MODE` を採用する。
  - 上記以外で `typeof parsed.numberingMode !== "string" || !VALID_NUMBERING_MODES.has(parsed.numberingMode)` のときは `Error('\'numberingMode\' は "global" または "perRule" で指定してください。')` をスローする。
- `parseAndValidateYaml(yamlText)` の戻り値を `{ rules, startNumber, numberingMode, warnings }` とする。
- `handleApply()` から送信するメッセージを `{ type: "APPLY_ANNOTATIONS", rules: parsedResult.rules, startNumber: parsedResult.startNumber, numberingMode: parsedResult.numberingMode }` に拡張する。
- `window.__webpageAnnotatorSidepanel` に `DEFAULT_NUMBERING_MODE` を追加公開する。

### 2. `content.js`

- 定数を定義する。
  - `NUMBERING_MODE_GLOBAL = "global"`
  - `NUMBERING_MODE_PER_RULE = "perRule"`
  - `DEFAULT_NUMBERING_MODE = NUMBERING_MODE_GLOBAL`
  - `VALID_NUMBERING_MODES = new Set([NUMBERING_MODE_GLOBAL, NUMBERING_MODE_PER_RULE])`
- `applyAnnotations(rules, options = {})` で `options.numberingMode` を受け取り検証する。
  - `options.numberingMode === undefined || options.numberingMode === null` のときは `DEFAULT_NUMBERING_MODE` を採用する（既存の `applyAnnotations(rules)` および `applyAnnotations(rules, { startNumber })` 呼び出しとの後方互換を維持）。
  - 上記以外で `typeof options.numberingMode !== "string" || !VALID_NUMBERING_MODES.has(options.numberingMode)` のときは `{ ok: false, error: '\'numberingMode\' は "global" または "perRule" で指定してください。' }` を返して中断する（オーバーレイは生成しない）。
- 採番計算を以下のように行う。
  - ルールごとのループ内で `let ruleMatchedCount = 0` を初期化する。
  - 描画対象となる要素ごとに、`const offset = numberingMode === NUMBERING_MODE_PER_RULE ? ruleMatchedCount : matchedEntries.length` とし、`const nextIndex = startNumber + offset` を算出する。
  - `!Number.isSafeInteger(nextIndex)` の場合は `{ ok: false, error: "連番が安全な整数の上限を超えました。" }` を返して中断する（オーバーレイは生成しない）。
  - 要素を追加するときに `ruleMatchedCount += 1` とする。
- 算出した `nextIndex` はバッジテキスト、`data-webpage-annotator-box`、`data-webpage-annotator-badge`、および `entry.index` に使用する。
- `chrome.runtime.onMessage` リスナーの `APPLY_ANNOTATIONS` 分岐で `applyAnnotations(message.rules, { startNumber: message.startNumber, numberingMode: message.numberingMode })` を呼び出す。

### 3. `README.md`

- 「使い方」に `numberingMode` で全体採番／ルールごと採番を切り替えられる旨を追記する。
- 「YAML 設定仕様」の設定例およびルート項目表に `numberingMode` を追記する。
- 「バリデーションとエラー時の挙動」に、`numberingMode` が不正な場合はエラーを表示して処理を中断する旨を追記する。

## テスト・検証計画

既存の `tests/run-tests.js`（`gjs` 上で実行）に自動テストケースを追加し、テスト駆動開発（Red → Green）で検証する。

### 検証ケース

1. **`sidepanel.js` (`parseAndValidateYaml`)**
   - `numberingMode` 未指定で `"global"` が返り、`DEFAULT_NUMBERING_MODE === "global"` が公開されている。
   - `numberingMode:`（`null`）で `"global"` が返る。
   - `numberingMode: "global"` で `"global"` が返る。
   - `numberingMode: "perRule"` で `"perRule"` が返る。
   - 不正値（`""`, `"Global"`, `"perrule"`, `"per-rule"`, `" perRule "`, `"rule"`, `1`, `true`, `false`, `[]`, `{}`）がいずれも `'numberingMode' は "global" または "perRule" で指定してください。` をスローする。
2. **`content.js` (`applyAnnotations` およびメッセージハンドラ)**
   - `numberingMode` 省略（後方互換）および `{ numberingMode: "global" }` で全ルール通番採番される。
   - `{ numberingMode: "perRule" }`（`startNumber` 省略）で各ルールが `1` からリセット採番され、`count` は全ルールの合計描画件数を返す。
   - `{ startNumber: 0, numberingMode: "perRule" }` および `{ startNumber: 10, numberingMode: "perRule" }` で各ルールが指定の開始番号からリセット採番される。
   - 重複マッチ要素・非表示要素・描画サイズ 0 要素がスキップされても各ルールで欠番なく採番される。
   - マッチ 0 件のルールを挟んでも後続ルールが `startNumber` から採番される。
   - `startNumber: Number.MAX_SAFE_INTEGER` かつ `numberingMode: "perRule"` のとき、各ルール 1 件ずつなら成功し、同一ルールに 2 件以上マッチした場合は `"連番が安全な整数の上限を超えました。"` でエラー返却・オーバーレイ未生成となる。
   - 不正な `numberingMode`（`""`, `"Global"`, `"per-rule"`, `1`, `true`, `[]`, `{}`）で `{ ok: false, error }` を返し、オーバーレイを生成しない。
3. **結合テスト (`sidepanel.js` → `content.js`)**
   - `sidepanel.js` で `numberingMode: "perRule"` と `startNumber: 5` を指定して描画適用を実行すると、`APPLY_ANNOTATIONS` メッセージに `numberingMode: "perRule"` が含まれ、`content.js` でルールごとに `5, 6, ...` が描画される。
