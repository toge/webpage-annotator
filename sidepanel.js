"use strict";

(() => {
  const STORAGE_KEY = "yamlConfig";
  const DEFAULT_COLOR = "#FF3B30";
  const DEFAULT_PADDING = 0;
  const DEFAULT_START_NUMBER = 1;
  const DEFAULT_PREFIX = "";
  const DEFAULT_SUFFIX = "";
  const NUMBERING_MODE_GLOBAL = "global";
  const NUMBERING_MODE_PER_RULE = "perRule";
  const DEFAULT_NUMBERING_MODE = NUMBERING_MODE_GLOBAL;
  const VALID_NUMBERING_MODES = new Set([NUMBERING_MODE_GLOBAL, NUMBERING_MODE_PER_RULE]);
  const DEFAULT_YAML = [
    "rules:",
    '  - selector: "a"',
    '    color: "#FF3B30"',
    "    padding: 2",
    "  - selector: \"button, input[type='submit']\"",
    '    color: "#007AFF"',
    "    padding: 4",
  ].join("\n");

  const yamlInput = document.getElementById("yaml-input");
  const applyBtn = document.getElementById("apply-btn");
  const clearBtn = document.getElementById("clear-btn");
  const statusBox = document.getElementById("status-message");
  const errorBox = document.getElementById("error-message");

  let saveTimerId = null;

  const setBoxMessage = (box, text, type) => {
    if (!text) {
      box.textContent = "";
      box.className = "message-box";
      return;
    }
    box.textContent = text;
    box.className = `message-box visible ${type}`;
  };

  const clearMessages = () => {
    setBoxMessage(statusBox, "", "");
    setBoxMessage(errorBox, "", "");
  };

  const showStatus = (text) => {
    setBoxMessage(statusBox, text, "success");
  };

  const showError = (text) => {
    setBoxMessage(errorBox, text, "error");
  };

  const showWarning = (text) => {
    setBoxMessage(errorBox, text, "warning");
  };

  const isValidCssColor = (color) => {
    if (typeof CSS !== "undefined" && typeof CSS.supports === "function") {
      return CSS.supports("color", color);
    }
    const probe = document.createElement("span");
    probe.style.color = "";
    probe.style.color = color;
    return probe.style.color !== "";
  };

  const parseAndValidateYaml = (yamlText) => {
    if (typeof window.jsyaml === "undefined" || typeof window.jsyaml.load !== "function") {
      throw new Error("js-yaml ライブラリの読み込みに失敗しました。");
    }

    if (!yamlText.trim()) {
      throw new Error("YAMLを入力してください。");
    }

    let parsed;
    try {
      parsed = window.jsyaml.load(yamlText);
    } catch (error) {
      throw new Error(`YAML構文エラー: ${error.message}`);
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("YAMLのルートは 'rules' キーを持つオブジェクトである必要があります。");
    }

    if (!Array.isArray(parsed.rules)) {
      throw new Error("'rules' は配列で指定してください。");
    }

    let startNumber = DEFAULT_START_NUMBER;
    if (parsed.startNumber !== undefined && parsed.startNumber !== null) {
      if (
        typeof parsed.startNumber !== "number" ||
        !Number.isSafeInteger(parsed.startNumber) ||
        parsed.startNumber < 0
      ) {
        throw new Error("'startNumber' は 0 以上の整数で指定してください。");
      }
      startNumber = parsed.startNumber;
    }

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

    const rules = [];
    const warnings = [];
    const selectorValidator = document.createDocumentFragment();

    parsed.rules.forEach((rawRule, index) => {
      const ruleNo = index + 1;
      if (!rawRule || typeof rawRule !== "object" || Array.isArray(rawRule)) {
        warnings.push(`ルール #${ruleNo}: オブジェクトではないためスキップしました。`);
        return;
      }

      if (typeof rawRule.selector !== "string" || !rawRule.selector.trim()) {
        warnings.push(`ルール #${ruleNo}: 'selector' が未指定または空のためスキップしました。`);
        return;
      }

      const selector = rawRule.selector.trim();
      try {
        selectorValidator.querySelector(selector);
      } catch (selectorError) {
        warnings.push(
          `ルール #${ruleNo}: 不正なCSSセレクタ "${selector}" をスキップしました (${selectorError.message})。`
        );
        return;
      }

      let color = DEFAULT_COLOR;
      if (rawRule.color !== undefined && rawRule.color !== null && String(rawRule.color).trim() !== "") {
        const candidateColor = String(rawRule.color).trim();
        if (isValidCssColor(candidateColor)) {
          color = candidateColor;
        } else {
          warnings.push(
            `ルール #${ruleNo}: 不正な色 "${candidateColor}" のためデフォルト色 (${DEFAULT_COLOR}) を使用します。`
          );
        }
      }

      let padding = DEFAULT_PADDING;
      if (rawRule.padding !== undefined && rawRule.padding !== null && rawRule.padding !== "") {
        const candidatePadding = Number(rawRule.padding);
        if (Number.isFinite(candidatePadding) && candidatePadding >= 0) {
          padding = candidatePadding;
        } else {
          warnings.push(
            `ルール #${ruleNo}: 不正な padding "${rawRule.padding}" のためデフォルト値 (${DEFAULT_PADDING}) を使用します。`
          );
        }
      }

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
    });

    if (rules.length === 0) {
      const detail = warnings.length > 0 ? `\n${warnings.join("\n")}` : "";
      throw new Error(`有効なルールがありません。${detail}`);
    }

    return { rules, startNumber, numberingMode, warnings };
  };

  const saveYamlImmediate = async (value) => {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: value });
    } catch (error) {
      console.error("[Webpage Annotator] Failed to save YAML:", error);
    }
  };

  const scheduleSaveYaml = (value) => {
    if (saveTimerId !== null) {
      window.clearTimeout(saveTimerId);
    }
    saveTimerId = window.setTimeout(() => {
      saveTimerId = null;
      saveYamlImmediate(value);
    }, 200);
  };

  const restoreYaml = async () => {
    try {
      const stored = await chrome.storage.local.get([STORAGE_KEY]);
      if (typeof stored[STORAGE_KEY] === "string") {
        yamlInput.value = stored[STORAGE_KEY];
      } else {
        yamlInput.value = DEFAULT_YAML;
      }
    } catch (error) {
      console.error("[Webpage Annotator] Failed to restore YAML:", error);
      yamlInput.value = DEFAULT_YAML;
    }
  };

  const getActiveTab = async () => {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tabs.length > 0 && tabs[0].id !== undefined) {
      return tabs[0];
    }
    const fallbackTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (fallbackTabs.length > 0 && fallbackTabs[0].id !== undefined) {
      return fallbackTabs[0];
    }
    return null;
  };

  const sendMessageToTab = async (tabId, message) => {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (_initialError) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      });
      return await chrome.tabs.sendMessage(tabId, message);
    }
  };

  const formatTabError = (error) => {
    const message = error && error.message ? error.message : String(error);
    if (
      message.includes("Cannot access") ||
      message.includes("ExtensionsSettings") ||
      message.includes("chrome://") ||
      message.includes("Receiving end does not exist")
    ) {
      return (
        "対象タブに描画できませんでした。chrome:// や Chrome ウェブストア等の保護されたページではないこと" +
        "（ローカルの file:// ページの場合は拡張機能の詳細画面で「ファイルの URL へのアクセスを許可する」が有効であること）を確認してください。\n" +
        `詳細: ${message}`
      );
    }
    return `実行エラー: ${message}`;
  };

  const setBusy = (busy) => {
    applyBtn.disabled = busy;
    clearBtn.disabled = busy;
  };

  const handleApply = async () => {
    clearMessages();
    const yamlText = yamlInput.value;
    await saveYamlImmediate(yamlText);

    let parsedResult;
    try {
      parsedResult = parseAndValidateYaml(yamlText);
    } catch (error) {
      showError(error.message);
      return;
    }

    setBusy(true);
    try {
      const tab = await getActiveTab();
      if (!tab) {
        showError("アクティブなタブが見つかりませんでした。");
        return;
      }

      const response = await sendMessageToTab(tab.id, {
        type: "APPLY_ANNOTATIONS",
        rules: parsedResult.rules,
        startNumber: parsedResult.startNumber,
        numberingMode: parsedResult.numberingMode,
      });

      if (!response || !response.ok) {
        showError((response && response.error) || "描画処理で不明なエラーが発生しました。");
        return;
      }

      const allWarnings = [...parsedResult.warnings, ...(response.warnings || [])];
      showStatus(`${response.count} 件の要素にオーバーレイを描画しました。`);
      if (allWarnings.length > 0) {
        showWarning(allWarnings.join("\n"));
      }
    } catch (error) {
      showError(formatTabError(error));
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    clearMessages();
    setBusy(true);
    try {
      const tab = await getActiveTab();
      if (!tab) {
        showError("アクティブなタブが見つかりませんでした。");
        return;
      }

      const response = await sendMessageToTab(tab.id, {
        type: "CLEAR_ANNOTATIONS",
      });

      if (!response || !response.ok) {
        showError((response && response.error) || "クリア処理で不明なエラーが発生しました。");
        return;
      }

      showStatus("オーバーレイをクリアしました。");
    } catch (error) {
      showError(formatTabError(error));
    } finally {
      setBusy(false);
    }
  };

  yamlInput.addEventListener("input", () => {
    scheduleSaveYaml(yamlInput.value);
  });

  yamlInput.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      handleApply();
    }
  });

  applyBtn.addEventListener("click", handleApply);
  clearBtn.addEventListener("click", handleClear);

  if (typeof window !== "undefined") {
    window.__webpageAnnotatorSidepanel = {
      parseAndValidateYaml,
      DEFAULT_COLOR,
      DEFAULT_PADDING,
      DEFAULT_START_NUMBER,
      DEFAULT_NUMBERING_MODE,
      DEFAULT_PREFIX,
      DEFAULT_SUFFIX,
    };
  }

  restoreYaml();
})();
