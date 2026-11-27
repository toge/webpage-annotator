# ルールごとの固定テキスト指定機能（`text`）設計書

## 概要

YAML 設定の各ルールに任意の `text` キー（文字列）を追加し、指定された場合は連番の採番を行わず指定テキストをそのままバッジに表示できるようにする。

- `text` が未指定、`null`（`text:`）、または空文字列（`""`）の場合は従来どおり採番（`${prefix}${index}${suffix}`）を行う。
- `text` に 1 文字以上の文字列が指定されている場合は、`prefix` / `suffix` を適用せず `text` の文字列そのものを表示し、`numberingMode: "global"` における全体採番カウンタも増やさない。
- 文字列以外の不正な型が指定された場合は自動フォールバックせず、`prefix` / `suffix` と同様にルール番号付きエラーで処理を中断する。

## YAML 設定仕様

### 設定例

```yaml
startNumber: 1
numberingMode: "global"
rules:
  - selector: "a"
    color: "#FF3B30"
    padding: 2
  - selector: "button.primary"
    color: "#FF9500"
    padding: 4
    text: "重要"
  - selector: "button, input[type='submit']"
    color: "#007AFF"
    padding: 4
```

上記の例で `a` が 2 件、`button.primary` が 1 件、その他の `button` が 1 件一致した場合、バッジは順に `1`, `2`, `重要`, `3` となる（`text` 指定ルールは全体採番カウンタを進めない）。

### ルール項目

| キー | 必須 | 型 | デフォルト値 | 説明 |
| --- | --- | --- | --- | --- |
| `selector` | 必須 | 文字列 | なし | 描画対象を指定する CSS セレクタ |
| `color` | 任意 | 文字列 | `"#FF3B30"` | 枠線とバッジ背景の色（HEX、RGB、色名など有効な CSS カラー） |
| `padding` | 任意 | 数値 | `0` | 対象要素の外側へ広げる余白（単位: px、0 以上の数値） |
| `prefix` | 任意 | 文字列 | `""` | 連番の前に付与する接頭辞（前後空白を保持、`text` 指定時は未使用） |
| `suffix` | 任意 | 文字列 | `""` | 連番の後ろに付与する接尾辞（前後空白を保持、`text` 指定時は未使用） |
| `text` | 任意 | 文字列 | なし（`null`） | 採番の代わりに表示する固定テキスト（1 文字以上の文字列指定時に優先、前後空白を保持） |

### 挙動仕様

- **テキスト優先と前後空白の保持**
  - `text` が 1 文字以上の文字列（`typeof value === "string" && value.length > 0`）のとき、採番を行わず `text` をそのまま表示ラベルとする。
  - 前後空白（例: `" NOTE "` や `" "`）は `trim()` せずそのまま保持する。
  - 同一ルールに `prefix` / `suffix` が併記されていても、`text` が有効な場合は `prefix` / `suffix` を付与しない。
- **未指定・空文字時の採番フォールバック**
  - `text` が未指定（`undefined`）、`null`（YAML で `text:` と値なし指定）、または空文字列（`""`）の場合は内部的に `null` へ正規化し、従来どおり `${prefix}${index}${suffix}` で採番する。
- **採番カウンタの扱い**
  - `text` が有効なルールに一致した要素では、全体採番カウンタ（`globalNumberedCount`）およびルール内採番カウンタ（`ruleMatchedCount`）を増やさない。
  - `text` が有効なルールでは連番計算を行わないため、`startNumber` との加算および `Number.isSafeInteger` の上限チェックも実行しない。
  - `numberingMode: "global"` で採番ルール・`text` ルール・採番ルールが混在しても、採番ルールの連番は欠番なく連続する。
  - `numberingMode: "perRule"` では各採番ルールが従来どおり `startNumber` から採番され、`text` ルールは固定テキストを表示する。
- **属性・件数・要素除外**
  - 表示ラベル（`text` または `${prefix}${index}${suffix}`）は以下すべてに一致して設定する。
    - `badgeEl.textContent`（プレーンテキストとして設定）
    - `data-webpage-annotator-box` 属性
    - `data-webpage-annotator-badge` 属性
  - 重複除外（`seenElements` による先頭ルール優先）、オーバーレイ要素除外（`isOverlayNode`）、非表示要素スキップ（`isElementVisible`）は `text` ルールでも従来どおり適用する。
  - `applyAnnotations()` が返す `count` は、`text` ルールによる描画要素も含めた総描画件数とする。

### バリデーション規則

- `text` が未指定（`undefined`）、`null`、または `""` の場合はデフォルト値 `null`（未指定扱い）とする。
- 上記以外で `typeof value !== "string"`（数値、真偽値、配列、オブジェクト等）の場合は、エラーメッセージ `` `ルール #${ruleNo}: 'text' は文字列で指定してください。` `` を表示して処理を中断する。
- ルール自体の型不正や `selector` 不正によってスキップされるエントリは従来どおり警告スキップとし、有効な `selector` を持つルールに対して `prefix`・`suffix`・`text` の型検証を行う。
- 同一ルールに有効な `text` と不正な型の `prefix` または `suffix` が混在している場合も、設定ミスを早期検出するため従来どおりエラーで中断する。

## コンポーネント設計

### 1. `sidepanel.js`

- 定数 `DEFAULT_TEXT = null` を定義する。
- `parseAndValidateYaml(yamlText)` の各ルール検証で `rawRule.text` を検証・正規化する。
  - `rawRule.text === undefined || rawRule.text === null` のときは `DEFAULT_TEXT`（`null`）とする。
  - `typeof rawRule.text !== "string"` のときは `Error(\`ルール #${ruleNo}: 'text' は文字列で指定してください。\`)` をスローして中断する。
  - `rawRule.text !== ""` のとき `text = rawRule.text` とし、`""` のときは `DEFAULT_TEXT`（`null`）のままとする。
- `rules.push({ selector, color, padding, prefix, suffix, text })` として保持し、`APPLY_ANNOTATIONS` メッセージの `rules` 配列に含めて送信する。
- `window.__webpageAnnotatorSidepanel` に `DEFAULT_TEXT` を追加公開する。

### 2. `content.js`

- 定数 `DEFAULT_TEXT = null` を定義する。
- `applyAnnotations(rules, options = {})` で全体採番カウンタ `let globalNumberedCount = 0;` を導入する。
- ルールループ内で、`prefix`・`suffix` の検証に続けて `rawRule.text` を防御的に検証・正規化する。
  - `rawRule.text === undefined || rawRule.text === null` のときは `DEFAULT_TEXT`（`null`）とする（後方互換を維持）。
  - `typeof rawRule.text !== "string"` のときは `{ ok: false, error: \`ルール #${ruleIndex + 1}: 'text' は文字列で指定してください。\` }` を返して中断する（オーバーレイは生成しない）。
  - `rawRule.text !== ""` のとき `text = rawRule.text` とし、`""` のときは `DEFAULT_TEXT`（`null`）とする。
- 各要素のマッチング処理で `seenElements`・`isOverlayNode`・`isElementVisible` チェック通過後、以下に分岐する。
  - `text !== null` の場合:
    - `seenElements.add(element)`
    - `matchedEntries.push({ element, color, padding, index: null, label: text })`
  - `text === null` の場合:
    - `const offset = numberingMode === NUMBERING_MODE_PER_RULE ? ruleMatchedCount : globalNumberedCount;`
    - `const nextIndex = startNumber + offset;`
    - `if (!Number.isSafeInteger(nextIndex)) { return { ok: false, error: "連番が安全な整数の上限を超えました。" }; }`
    - `seenElements.add(element)`
    - `globalNumberedCount += 1`
    - `ruleMatchedCount += 1`
    - `matchedEntries.push({ element, color, padding, index: nextIndex, label: \`${prefix}${nextIndex}${suffix}\` })`
- オーバーレイ生成ループでは既存の `createAnnotationElements(entry.label, entry.color)` をそのまま利用し、`trackedAnnotations` には `index: entry.index`（`text` 時は `null`）、`label: entry.label` を保持する。

### 3. `README.md`

- 「使い方」に、各ルールの `text` で採番の代わりに固定テキストを表示できる旨を追記する。
- 「YAML 設定仕様」の設定例およびルール項目表に `text` を追記する（`prefix`・`suffix` 欄にも `text` 指定時は未使用である旨を補足する）。
- 「バリデーションとエラー時の挙動」に、ルールの `text` に文字列以外が指定された場合はエラーを表示して処理を中断する旨を追記する。

## テスト・検証計画

既存の `tests/run-tests.js`（`gjs` 上で実行）に自動テストケースを追加し、テスト駆動開発（Red → Green）で検証する。

### 検証ケース

1. **`sidepanel.js` (`parseAndValidateYaml`)**
   - `text` 未指定、`text:`（`null`）、`text: ""`（空文字列）はいずれも `null` に正規化され、`DEFAULT_TEXT === null` が公開されている。
   - `text` に通常文字列・前後空白を含む文字列・空白のみの文字列・日本語・記号を指定した場合、トリムされずそのまま保持される。
   - `text` に不正な型（数値 `123`、真偽値 `true` / `false`、配列 `["a"]`、オブジェクト `{}`）を指定した場合、`ルール #2: 'text' は文字列で指定してください。` で中断する。
2. **`content.js` (`applyAnnotations`)**
   - `text` 指定ルール単独で一致要素すべてに同じ固定テキストが設定され、`badgeEl.textContent`・`data-webpage-annotator-box`・`data-webpage-annotator-badge` が一致する（前後空白も保持）。
   - `numberingMode: "global"` で採番ルール → `text` ルール → 採番ルールが混在する場合、`text` ルールは採番カウンタを増やさず連番が連続する（例: `1, 2, "重要", "重要", 3`）。
   - `numberingMode: "perRule"` で採番ルールと `text` ルールが混在する場合、採番ルールはそれぞれ `startNumber` から採番され、`text` ルールは固定テキストを表示する。
   - 同一ルールに `text` と `prefix` / `suffix` を同時指定した場合、`prefix` / `suffix` は適用されず `text` のみが表示される。
   - `text: ""` や `text: null` を直接渡した場合は未指定扱いとして採番（および `prefix` / `suffix` 適用）が行われる。
   - `text` ルールと採番ルールで重複する要素は先頭ルールが優先され、非表示要素もスキップされる。また `res.count` は `text` ルール分も含む総描画件数になる。
   - `startNumber: Number.MAX_SAFE_INTEGER` のとき、`text` ルールで複数件描画しても上限超過エラーにならず、直後の採番ルール 1 件目が `Number.MAX_SAFE_INTEGER` として正常に描画される。
   - 不正な型の `text`（数値、真偽値、配列、オブジェクト）で `{ ok: false, error: "ルール #N: 'text' は文字列で指定してください。" }` を返し、オーバーレイを生成しない（マッチ 0 件のルールに不正型がある場合も含む）。
3. **結合テスト (`sidepanel.js` → `content.js`)**
   - `sidepanel.js` で `numberingMode: "global"` かつ採番ルール・`text` ルール（`prefix`/`suffix` 併記）・後続採番ルール・`text: ""` ルールを設定して描画適用を実行すると、`content.js` に正しく伝播し、採番カウンタが増えずに期待通りのラベルが描画される。
