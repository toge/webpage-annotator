# 連番の開始番号指定機能（`startNumber`）設計書

## 概要

YAML 設定のルートに任意の `startNumber` キーを追加し、オーバーレイ描画時の連番バッジの開始番号を指定できるようにする。指定がなければ従来どおり `1` から採番する。

不正な値が指定された場合は自動フォールバックせず、設定ミスに確実に気付けるようエラーとして処理を中断する。

## YAML 設定仕様

### 設定例

```yaml
startNumber: 10
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
| `rules` | 必須 | 配列 | なし | 描画ルールの配列 |

### バリデーション規則

- `startNumber` が未指定（`undefined`）または YAML 上で値が空（`startNumber:` → `null`）の場合はデフォルト値 `1` を使用する。
- それ以外の場合は `typeof value === "number" && Number.isSafeInteger(value) && value >= 0` を満たす必要がある。
- 負数、小数、文字列（空文字 `""` や数字文字列 `"10"` を含む）、真偽値、配列、オブジェクト、`NaN`、`Infinity`、および `Number.MAX_SAFE_INTEGER` を超える数値が指定された場合は、エラーメッセージ `'startNumber' は 0 以上の整数で指定してください。` を表示して処理を中断する。

## コンポーネント設計

### 1. `sidepanel.js`

- 定数 `DEFAULT_START_NUMBER = 1` を定義する。
- `parseAndValidateYaml(yamlText)` に `parsed.startNumber` のバリデーションを追加する。
  - `parsed.startNumber === undefined || parsed.startNumber === null` のときは `DEFAULT_START_NUMBER` を採用する。
  - 上記以外で `typeof parsed.startNumber !== "number" || !Number.isSafeInteger(parsed.startNumber) || parsed.startNumber < 0` のときは `Error("'startNumber' は 0 以上の整数で指定してください。")` をスローする。
- `parseAndValidateYaml(yamlText)` の戻り値を `{ rules, startNumber, warnings }` とする。
- `handleApply()` から送信するメッセージを `{ type: "APPLY_ANNOTATIONS", rules: parsedResult.rules, startNumber: parsedResult.startNumber }` に拡張する。
- `window.__webpageAnnotatorSidepanel` に `DEFAULT_START_NUMBER` を追加公開する。

### 2. `content.js`

- 定数 `DEFAULT_START_NUMBER = 1` を定義する。
- `applyAnnotations(rules, options = {})` として、第2引数（任意）で `{ startNumber }` を受け取る。
  - 既存の `applyAnnotations(rules)` 呼び出しは `options = {}` として `startNumber = 1` で後方互換を維持する。
  - `options` が `undefined` / `null` 以外でプレーンなオブジェクトでない（非オブジェクトまたは配列）場合は `{ ok: false, error: "オプションが不正です。" }` を返す。
  - `options.startNumber` が `undefined` または `null` の場合は `DEFAULT_START_NUMBER` を採用する。
  - それ以外で `typeof options.startNumber !== "number" || !Number.isSafeInteger(options.startNumber) || options.startNumber < 0` の場合は `{ ok: false, error: "'startNumber' は 0 以上の整数で指定してください。" }` を返して中断する。
- 連番計算を `const nextIndex = startNumber + matchedEntries.length` とする。
  - `!Number.isSafeInteger(nextIndex)` となった場合（例: `startNumber === Number.MAX_SAFE_INTEGER` かつ2件以上マッチした場合）は、不正確な描画を行わず `{ ok: false, error: "連番が安全な整数の上限を超えました。" }` を返して中断する。
- 算出した `nextIndex` はバッジテキスト、`data-webpage-annotator-box`、`data-webpage-annotator-badge`、および `entry.index` に使用する。
- 戻り値の `count` は従来どおり描画件数（`trackedAnnotations.length`）を返す。
- `chrome.runtime.onMessage` リスナーの `APPLY_ANNOTATIONS` 分岐で `applyAnnotations(message.rules, { startNumber: message.startNumber })` を呼び出す。

### 3. `README.md`

- 「使い方」の連番に関する説明を更新する。
- 「YAML 設定仕様」にルート設定項目の表と `startNumber` の記述例を追記する。
- 「バリデーションとエラー時の挙動」に、`startNumber` が不正な場合はエラーを表示して処理を中断する旨を追記する。

## テスト・検証計画

`gjs`（SpiderMonkey ランタイム）上で軽量 DOM モックと `lib/js-yaml.min.js` を読み込み、実際の `sidepanel.js` および `content.js` を実行する自動テストスイートを作成する（テスト駆動開発：Red → Green）。

### 検証ケース

1. **`sidepanel.js` (`parseAndValidateYaml`)**
   - `startNumber` 未指定で `1` が返る。
   - `startNumber:`（`null`）で `1` が返る。
   - `startNumber: 0` で `0` が返る。
   - `startNumber: 10` で `10` が返る。
   - `startNumber: 9007199254740991`（`Number.MAX_SAFE_INTEGER`）が許容される。
   - 不正値（`-1`, `1.5`, `"10"`, `""`, `true`, `false`, `[]`, `{}`, `.nan`, `.inf`, `9007199254740992`）がいずれもエラーをスローする。
2. **`content.js` (`applyAnnotations` およびメッセージハンドラ)**
   - 第2引数省略（後方互換）で `1, 2, 3...` が採番される。
   - `{ startNumber: 0 }` で `0, 1, 2...` が採番され、バッジテキスト・`data-webpage-annotator-box`・`data-webpage-annotator-badge` がすべて一致する。
   - `{ startNumber: 10 }` で `10, 11, 12...` が採番され、`count` は要素数のまま返る。
   - 重複マッチ要素・非表示要素がスキップされても開始番号から欠番なく連番が振られる。
   - 不正な `startNumber`（`-1`, `1.5`, `"10"`, `true`）や不正な `options` で `{ ok: false, error }` が返り、オーバーレイは生成されない。
   - `startNumber: Number.MAX_SAFE_INTEGER` で1件マッチ時は成功し、2件以上マッチ時はエラー `{ ok: false, error }` を返す。
   - `chrome.runtime.onMessage` 経由の `APPLY_ANNOTATIONS` メッセージで `startNumber` が反映される。
