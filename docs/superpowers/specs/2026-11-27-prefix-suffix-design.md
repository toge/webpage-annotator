# ルールごとの接頭辞・接尾辞指定機能（`prefix` / `suffix`）設計書

## 概要

YAML 設定の各ルールに任意の `prefix`（接頭辞）・`suffix`（接尾辞）キーを追加し、オーバーレイの連番バッジ表示をルールごとに `${prefix}${index}${suffix}` の形式でカスタマイズできるようにする。指定がなければ空文字列 `""` を使用し、従来どおり番号のみを表示する。

文字列以外の不正な型が指定された場合は自動フォールバックせず、設定ミスに確実に気付けるようエラーとして処理を中断する。

## YAML 設定仕様

### 設定例

```yaml
startNumber: 1
numberingMode: "perRule"
rules:
  - selector: "a"
    color: "#FF3B30"
    padding: 2
    prefix: "L-"
    suffix: ""
  - selector: "button, input[type='submit']"
    color: "#007AFF"
    padding: 4
    prefix: "BTN "
    suffix: "件"
```

### ルール項目

| キー | 必須 | 型 | デフォルト値 | 説明 |
| --- | --- | --- | --- | --- |
| `selector` | 必須 | 文字列 | なし | 描画対象を指定する CSS セレクタ |
| `color` | 任意 | 文字列 | `"#FF3B30"` | 枠線とバッジ背景の色（HEX、RGB、色名など有効な CSS カラー） |
| `padding` | 任意 | 数値 | `0` | 対象要素の外側へ広げる余白（単位: px、0 以上の数値） |
| `prefix` | 任意 | 文字列 | `""` | 連番の前に付与する接頭辞（前後空白を保持） |
| `suffix` | 任意 | 文字列 | `""` | 連番の後ろに付与する接尾辞（前後空白を保持） |

### 挙動仕様

- 各描画対象要素の表示ラベルを `` `${prefix}${index}${suffix}` `` とする。
- 算出した表示ラベルは以下すべてに設定する。
  - `badgeEl.textContent`（HTML 解釈されないプレーンテキストとして設定）
  - `data-webpage-annotator-box` 属性
  - `data-webpage-annotator-badge` 属性
- `prefix`・`suffix` の前後空白（例: `"BTN "`、`" 件"`）はトリムせずそのまま保持する。
- `prefix`・`suffix` の両方が省略（または `""` / `null`）の場合は `String(index)` と同一になり、既存の挙動と完全互換を維持する。
- `startNumber` および `numberingMode`（`"global"` / `"perRule"`）と組み合わせて利用できる。

### バリデーション規則

- `prefix` または `suffix` が未指定（`undefined`）または YAML 上で値が空（`prefix:` / `suffix:` → `null`）の場合はデフォルト値 `""` を使用する。
- それ以外の場合は `typeof value === "string"` を満たす必要がある。
- 文字列以外の型（数値、真偽値、配列、オブジェクト等）が指定された場合はエラーを表示して処理を中断する。
  - `prefix` 不正時: `` `ルール #${ruleNo}: 'prefix' は文字列で指定してください。` ``
  - `suffix` 不正時: `` `ルール #${ruleNo}: 'suffix' は文字列で指定してください。` ``
- ルール自体の型不正や `selector` 不正によってスキップされるエントリは従来どおり警告スキップとし、有効な `selector` を持つルールに対して `prefix`・`suffix` の型検証を行う。

## コンポーネント設計

### 1. `sidepanel.js`

- 定数を定義する。
  - `DEFAULT_PREFIX = ""`
  - `DEFAULT_SUFFIX = ""`
- `parseAndValidateYaml(yamlText)` の各ルール検証で `rawRule.prefix` と `rawRule.suffix` を検証する。
  - `undefined` または `null` のときは `DEFAULT_PREFIX` / `DEFAULT_SUFFIX` を採用する。
  - 上記以外で `typeof value !== "string"` のときは以下の `Error` をスローして処理を中断する。
    - `` `ルール #${ruleNo}: 'prefix' は文字列で指定してください。` ``
    - `` `ルール #${ruleNo}: 'suffix' は文字列で指定してください。` ``
  - 文字列の値は `trim()` せずそのまま採用する。
- `rules.push({ selector, color, padding, prefix, suffix })` として保持し、既存の `APPLY_ANNOTATIONS` メッセージの `rules` 配列に含めて送信する。
- `window.__webpageAnnotatorSidepanel` に `DEFAULT_PREFIX`・`DEFAULT_SUFFIX` を追加公開する。

### 2. `content.js`

- 定数を定義する。
  - `DEFAULT_PREFIX = ""`
  - `DEFAULT_SUFFIX = ""`
- `createAnnotationElements(label, color)` として、第1引数に表示ラベル文字列を受け取り以下を設定する。
  - `boxEl.setAttribute("data-webpage-annotator-box", String(label))`
  - `badgeEl.setAttribute("data-webpage-annotator-badge", String(label))`
  - `badgeEl.textContent = String(label)`
- `applyAnnotations(rules, options = {})` のルールループ内で、`selector` チェック後かつ `document.querySelectorAll(selector)` 実行前に `rawRule.prefix` と `rawRule.suffix` を防御的に検証する。
  - `undefined` または `null` のときは `DEFAULT_PREFIX` / `DEFAULT_SUFFIX` を採用する（既存テストや `prefix` / `suffix` 未指定の直接呼び出しに対する後方互換を維持）。
  - 上記以外で `typeof value !== "string"` のときは `{ ok: false, error: \`ルール #${ruleIndex + 1}: 'prefix' は文字列で指定してください。\` }`（`suffix` も同様）を返して中断する（オーバーレイは生成しない）。
- 描画対象要素ごとに `` const label = `${prefix}${nextIndex}${suffix}`; `` を生成し、`matchedEntries` に `{ element, color, padding, index: nextIndex, label }` として格納する。
- オーバーレイ生成時に `createAnnotationElements(entry.label, entry.color)` を呼び出し、`trackedAnnotations` にも `label: entry.label` を保持する。

### 3. `README.md`

- 「使い方」に、ルールごとに `prefix` / `suffix` で接頭辞・接尾辞を付けられる旨を追記する。
- 「YAML 設定仕様」の設定例およびルール項目表に `prefix`・`suffix` を追記する。
- 「バリデーションとエラー時の挙動」に、`prefix` / `suffix` に文字列以外が指定された場合はエラーを表示して処理を中断する旨を追記する。

## テスト・検証計画

既存の `tests/run-tests.js`（`gjs` 上で実行）に自動テストケースを追加し、テスト駆動開発（Red → Green）で検証する。

### 検証ケース

1. **`sidepanel.js` (`parseAndValidateYaml`)**
   - `prefix` / `suffix` 未指定時はともに `""` が返り、`DEFAULT_PREFIX === ""`・`DEFAULT_SUFFIX === ""` が公開されている。
   - `prefix:` / `suffix:`（`null`）時はともに `""` が返る。
   - `prefix` / `suffix` に通常の文字列・空文字・前後空白を含む文字列・日本語・記号を指定した場合、トリムされずそのまま保持される。
   - `prefix` または `suffix` に不正な型（数値 `123`、真偽値 `true` / `false`、配列 `["a"]`、オブジェクト `{}`）を指定した場合、ルール番号付きの期待エラーメッセージで中断する。
2. **`content.js` (`applyAnnotations`)**
   - `prefix` のみ、`suffix` のみ、両方指定、未指定の各ルールが混在しても、それぞれのラベルがバッジテキスト・`data-webpage-annotator-box`・`data-webpage-annotator-badge` に一致して設定される。
   - 前後空白を含む `prefix` / `suffix` がトリムされずそのまま表示される。
   - `startNumber` および `numberingMode: "global"` / `"perRule"` と組み合わせた際に期待通りのラベルになる。
   - 不正な型の `prefix` / `suffix`（数値、真偽値、配列、オブジェクト）で `{ ok: false, error }` を返し、オーバーレイを生成しない（マッチ 0 件のルールに不正型がある場合も含む）。
3. **結合テスト (`sidepanel.js` → `content.js`)**
   - `sidepanel.js` でルールごとに異なる `prefix` / `suffix` と `numberingMode: "perRule"`・`startNumber: 1` を設定して描画適用を実行すると、`content.js` に正しく伝播して期待するラベルが描画される。
