# 枠の角丸指定機能（`rounded`）設計書

## 概要

YAML 設定のルートに任意の `rounded` キー（真偽値）を追加し、オーバーレイ描画時の枠線を角丸にするかどうかをグローバルに指定できるようにする。指定がなければ従来どおり `false`（直角の枠線）として動作する。

不正な値が指定された場合は自動フォールバックせず、`startNumber` や `numberingMode` と同様にエラーとして処理を中断する。

## YAML 設定仕様

### 設定例

```yaml
startNumber: 1
numberingMode: "global"
rounded: true # true: 枠線を角丸にする / false（省略時）: 従来の直角枠
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
| `rounded` | 任意 | 真偽値 | `false` | 枠線を角丸にするかどうか（`true`: 角丸、`false`: 直角） |
| `rules` | 必須 | 配列 | なし | 描画ルールの配列 |

### 描画挙動

連番バッジとの接続部に隙間やはみ出しが生じないよう、角丸半径を `6px`（内径 `6px - 2px = 4px`）としてバッジ配置（`outside` / `inside`）に応じて以下のように描画する。

| `rounded` | バッジ配置 | 枠（`boxEl`）の `border-radius` | バッジ（`badgeEl`）の `border-radius` |
| --- | --- | --- | --- |
| `false`（デフォルト） | 外側（`outside`） | `0px` | `3px 3px 0 0` |
| `false`（デフォルト） | 内側（`inside`） | `0px` | `0 0 3px 0` |
| `true` | 外側（`outside`） | `0 6px 6px 6px` | `3px 3px 0 0` |
| `true` | 内側（`inside`） | `6px` | `4px 0 3px 0` |

- `rounded: true` かつ外側配置（`outside`）では、枠の左上角のみ `0` とすることで、枠の上辺に接する連番バッジと隙間なく一体に接続する。
- `rounded: true` かつ内側配置（`inside`）では、枠の 4 角すべてに `6px` を適用し、内側バッジの左上角も CSS の内径計算式（`max(0, outerRadius - borderWidth) = 4px`）に揃えることで、枠の外側へバッジがはみ出さないようにする。
- スクロールやリサイズに伴う `updateAllPositions()` / `applyBoxPosition()` の再計算時に `outside` ↔ `inside` が切り替わった場合も、上記の `border-radius` を動的に追従させる。

### バリデーション規則

- `rounded` が未指定（`undefined`）または YAML 上で値が空（`rounded:` → `null`）の場合はデフォルト値 `false` を使用する。
- それ以外の場合は `typeof value === "boolean"` を満たす必要がある（YAML 1.2 における `true` / `false`）。
- 文字列（`"true"`, `"false"`, `""`, `"yes"`, `"no"`, `yes`, `no` 等）、数値（`1`, `0` 等）、配列、オブジェクトなど真偽値以外が指定された場合は、エラーメッセージ `'rounded' は真偽値（true または false）で指定してください。` を表示して処理を中断する。

## コンポーネント設計

### 1. `sidepanel.js`

- 定数 `DEFAULT_ROUNDED = false` を定義する。
- `parseAndValidateYaml(yamlText)` に `parsed.rounded` のバリデーションを追加する。
  - `parsed.rounded === undefined || parsed.rounded === null` のときは `DEFAULT_ROUNDED` を採用する。
  - 上記以外で `typeof parsed.rounded !== "boolean"` のときは `Error("'rounded' は真偽値（true または false）で指定してください。")` をスローする。
- `parseAndValidateYaml(yamlText)` の戻り値を `{ rules, startNumber, numberingMode, rounded, warnings }` とする。
- `handleApply()` から送信するメッセージを `{ type: "APPLY_ANNOTATIONS", rules: parsedResult.rules, startNumber: parsedResult.startNumber, numberingMode: parsedResult.numberingMode, rounded: parsedResult.rounded }` に拡張する。
- `window.__webpageAnnotatorSidepanel` に `DEFAULT_ROUNDED` を追加公開する。

### 2. `content.js`

- 定数を定義する。
  - `DEFAULT_ROUNDED = false`
  - `ROUNDED_BORDER_RADIUS = 6`
  - `ROUNDED_INNER_BADGE_RADIUS = Math.max(0, ROUNDED_BORDER_RADIUS - BORDER_WIDTH)`（`4`）
- `applyAnnotations(rules, options = {})` で `options.rounded` を受け取り検証する。
  - `options.rounded === undefined || options.rounded === null` のときは `DEFAULT_ROUNDED` を採用する（既存呼び出しとの後方互換を維持）。
  - 上記以外で `typeof options.rounded !== "boolean"` のときは `{ ok: false, error: "'rounded' は真偽値（true または false）で指定してください。" }` を返して中断する（オーバーレイは生成しない）。
- `trackedAnnotations` の各 `item` に `rounded` を保持する。
- `applyBoxPosition(item)` で `item.rounded` と `isClippedAtTop` に応じて `boxEl.style.borderRadius` および `badgeEl.style.borderRadius` を設定する。
  - `isClippedAtTop`（`inside`）:
    - `rounded` が `true`: `boxEl.style.borderRadius = `${ROUNDED_BORDER_RADIUS}px``、`badgeEl.style.borderRadius = `${ROUNDED_INNER_BADGE_RADIUS}px 0 3px 0``
    - `rounded` が `false`: `boxEl.style.borderRadius = "0px"`、`badgeEl.style.borderRadius = "0 0 3px 0"`
  - `!isClippedAtTop`（`outside`）:
    - `rounded` が `true`: `boxEl.style.borderRadius = `0 ${ROUNDED_BORDER_RADIUS}px ${ROUNDED_BORDER_RADIUS}px ${ROUNDED_BORDER_RADIUS}px``、`badgeEl.style.borderRadius = "3px 3px 0 0"`
    - `rounded` が `false`: `boxEl.style.borderRadius = "0px"`、`badgeEl.style.borderRadius = "3px 3px 0 0"`
- `chrome.runtime.onMessage` リスナーの `APPLY_ANNOTATIONS` 分岐で `applyAnnotations(message.rules, { startNumber: message.startNumber, numberingMode: message.numberingMode, rounded: message.rounded })` を呼び出す。

### 3. `README.md`

- 「使い方」に `rounded` で枠の角丸を切り替えられる旨を追記する。
- 「YAML 設定仕様」の設定例およびルート項目表に `rounded` を追記する。
- 「バリデーションとエラー時の挙動」に、`rounded` に真偽値以外が指定された場合はエラーを表示して処理を中断する旨を追記する。

## テスト・検証計画

既存の `tests/run-tests.js`（`gjs` 上で実行）に自動テストケースを追加し、テスト駆動開発（Red → Green）で検証する。

### 検証ケース

1. **`sidepanel.js` (`parseAndValidateYaml`)**
   - `rounded` 未指定で `false` が返り、`DEFAULT_ROUNDED === false` が公開されている。
   - `rounded:`（`null`）で `false` が返る。
   - `rounded: true` で `true` が返る。
   - `rounded: false` で `false` が返る。
   - 不正値（`"true"`, `"false"`, `""`, `yes`, `no`, `1`, `0`, `[]`, `{}`）がいずれも `'rounded' は真偽値（true または false）で指定してください。` をスローする。
2. **`content.js` (`applyAnnotations`、`updateAllPositions` およびメッセージハンドラ)**
   - `rounded` 省略（後方互換）および `{ rounded: false }` で、外側配置時に枠 `0px`・バッジ `3px 3px 0 0`、内側配置時に枠 `0px`・バッジ `0 0 3px 0` が適用される。
   - `{ rounded: true }` で、外側配置時に枠 `0 6px 6px 6px`・バッジ `3px 3px 0 0`、内側配置時に枠 `6px`・バッジ `4px 0 3px 0` が適用される。
   - `{ rounded: true }` で要素位置が変化して `updateAllPositions()` が呼ばれた際、`outside` → `inside` および `inside` → `outside` の切り替えに連動して枠・バッジ双方の `borderRadius` が正しく更新される。
   - 不正な `rounded`（`"true"`, `""`, `1`, `0`, `[]`, `{}`）で `{ ok: false, error: "'rounded' は真偽値（true または false）で指定してください。" }` を返し、オーバーレイを生成しない。
3. **結合テスト (`sidepanel.js` → `content.js`)**
   - `sidepanel.js` で `rounded: true` を指定して描画適用を実行すると、`APPLY_ANNOTATIONS` メッセージに `rounded: true` が含まれ、`content.js` で角丸の枠線が描画される。
