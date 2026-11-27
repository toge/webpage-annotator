"use strict";

(() => {
  if (window.__webpageAnnotatorInitialized) {
    return;
  }
  window.__webpageAnnotatorInitialized = true;

  const CONTAINER_ID = "__webpage-annotator-overlay-root";
  const CONTAINER_ATTR = "data-webpage-annotator-overlay";
  const DEFAULT_COLOR = "#FF3B30";
  const DEFAULT_PADDING = 0;
  const BADGE_HEIGHT = 18;
  const BORDER_WIDTH = 2;
  const MAX_Z_INDEX = 2147483647;

  let overlayContainer = null;
  let trackedAnnotations = [];
  let rafId = null;
  let listenersAttached = false;

  const isOverlayNode = (node) => {
    return (
      node instanceof Element &&
      (node.id === CONTAINER_ID || node.closest(`[${CONTAINER_ATTR}="true"]`) !== null)
    );
  };

  const isElementVisible = (element) => {
    if (!(element instanceof Element) || !element.isConnected) {
      return false;
    }

    const computed = window.getComputedStyle(element);
    if (computed.display === "none") {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }

    return true;
  };

  const createOverlayContainer = () => {
    const existing = document.getElementById(CONTAINER_ID);
    if (existing) {
      existing.remove();
    }

    const container = document.createElement("div");
    container.id = CONTAINER_ID;
    container.setAttribute(CONTAINER_ATTR, "true");
    container.style.cssText = [
      "position: fixed",
      "top: 0",
      "left: 0",
      "width: 100%",
      "height: 100%",
      "margin: 0",
      "padding: 0",
      "border: 0",
      "background: transparent",
      "pointer-events: none",
      "overflow: hidden",
      `z-index: ${MAX_Z_INDEX}`,
    ].join("; ");

    document.body.appendChild(container);
    return container;
  };

  const applyBoxPosition = (item) => {
    const { element, padding, boxEl, badgeEl } = item;
    if (!isElementVisible(element)) {
      boxEl.style.display = "none";
      return;
    }

    const rect = element.getBoundingClientRect();
    const boxLeft = rect.left - padding;
    const boxTop = rect.top - padding;
    const boxWidth = rect.width + padding * 2;
    const boxHeight = rect.height + padding * 2;

    boxEl.style.display = "block";
    boxEl.style.left = `${boxLeft}px`;
    boxEl.style.top = `${boxTop}px`;
    boxEl.style.width = `${boxWidth}px`;
    boxEl.style.height = `${boxHeight}px`;

    const isClippedAtTop = boxTop < BADGE_HEIGHT;
    if (isClippedAtTop) {
      badgeEl.style.top = "0px";
      badgeEl.style.bottom = "auto";
      badgeEl.style.left = "0px";
      badgeEl.style.borderRadius = "0 0 3px 0";
      badgeEl.dataset.placement = "inside";
    } else {
      badgeEl.style.top = "auto";
      badgeEl.style.bottom = "100%";
      badgeEl.style.left = `-${BORDER_WIDTH}px`;
      badgeEl.style.borderRadius = "3px 3px 0 0";
      badgeEl.dataset.placement = "outside";
    }
  };

  const updateAllPositions = () => {
    rafId = null;
    if (!overlayContainer || !overlayContainer.isConnected) {
      return;
    }
    for (const item of trackedAnnotations) {
      applyBoxPosition(item);
    }
  };

  const schedulePositionUpdate = () => {
    if (rafId !== null) {
      return;
    }
    rafId = window.requestAnimationFrame(updateAllPositions);
  };

  const attachListeners = () => {
    if (listenersAttached) {
      return;
    }
    window.addEventListener("resize", schedulePositionUpdate, { passive: true });
    window.addEventListener("scroll", schedulePositionUpdate, { passive: true, capture: true });
    listenersAttached = true;
  };

  const detachListeners = () => {
    if (!listenersAttached) {
      return;
    }
    window.removeEventListener("resize", schedulePositionUpdate);
    window.removeEventListener("scroll", schedulePositionUpdate, { capture: true });
    listenersAttached = false;
  };

  const clearAnnotations = () => {
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }
    detachListeners();
    trackedAnnotations = [];

    if (overlayContainer && overlayContainer.isConnected) {
      overlayContainer.remove();
    }
    overlayContainer = null;

    const leftover = document.getElementById(CONTAINER_ID);
    if (leftover) {
      leftover.remove();
    }
  };

  const createAnnotationElements = (index, color) => {
    const boxEl = document.createElement("div");
    boxEl.setAttribute("data-webpage-annotator-box", String(index));
    boxEl.style.cssText = [
      "position: absolute",
      "box-sizing: border-box",
      `border: ${BORDER_WIDTH}px solid ${color}`,
      "margin: 0",
      "padding: 0",
      "background: transparent",
      "pointer-events: none",
    ].join("; ");

    const badgeEl = document.createElement("span");
    badgeEl.setAttribute("data-webpage-annotator-badge", String(index));
    badgeEl.textContent = String(index);
    badgeEl.style.cssText = [
      "position: absolute",
      "box-sizing: border-box",
      "display: inline-flex",
      "align-items: center",
      "justify-content: center",
      `height: ${BADGE_HEIGHT}px`,
      "min-width: 18px",
      "padding: 0 5px",
      "margin: 0",
      "border: 0",
      `background-color: ${color}`,
      "color: #FFFFFF",
      "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif",
      "font-size: 11px",
      "font-weight: 700",
      "line-height: 1",
      "white-space: nowrap",
      "pointer-events: none",
      "user-select: none",
    ].join("; ");

    boxEl.appendChild(badgeEl);
    return { boxEl, badgeEl };
  };

  const applyAnnotations = (rules) => {
    clearAnnotations();

    if (!document.body) {
      return { ok: false, error: "document.body が存在しません。" };
    }

    if (!Array.isArray(rules)) {
      return { ok: false, error: "ルール配列が不正です。" };
    }

    const seenElements = new Set();
    const warnings = [];
    const matchedEntries = [];

    rules.forEach((rawRule, ruleIndex) => {
      if (!rawRule || typeof rawRule.selector !== "string" || !rawRule.selector.trim()) {
        return;
      }

      const selector = rawRule.selector.trim();
      const color =
        typeof rawRule.color === "string" && rawRule.color.trim()
          ? rawRule.color.trim()
          : DEFAULT_COLOR;
      const paddingValue = Number(rawRule.padding);
      const padding = Number.isFinite(paddingValue) && paddingValue >= 0 ? paddingValue : DEFAULT_PADDING;

      let elements;
      try {
        elements = document.querySelectorAll(selector);
      } catch (error) {
        warnings.push(
          `ルール #${ruleIndex + 1}: 不正なCSSセレクタ "${selector}" をスキップしました (${error.message})。`
        );
        return;
      }

      for (const element of elements) {
        if (seenElements.has(element) || isOverlayNode(element)) {
          continue;
        }
        if (!isElementVisible(element)) {
          continue;
        }
        seenElements.add(element);
        matchedEntries.push({
          element,
          color,
          padding,
          index: matchedEntries.length + 1,
        });
      }
    });

    if (matchedEntries.length === 0) {
      return { ok: true, count: 0, warnings };
    }

    overlayContainer = createOverlayContainer();
    const fragment = document.createDocumentFragment();

    for (const entry of matchedEntries) {
      const { boxEl, badgeEl } = createAnnotationElements(entry.index, entry.color);
      const item = {
        element: entry.element,
        color: entry.color,
        padding: entry.padding,
        index: entry.index,
        boxEl,
        badgeEl,
      };
      applyBoxPosition(item);
      fragment.appendChild(boxEl);
      trackedAnnotations.push(item);
    }

    overlayContainer.appendChild(fragment);
    attachListeners();

    return { ok: true, count: trackedAnnotations.length, warnings };
  };

  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || typeof message.type !== "string") {
        return false;
      }

      if (message.type === "APPLY_ANNOTATIONS") {
        try {
          const result = applyAnnotations(message.rules);
          sendResponse(result);
        } catch (error) {
          sendResponse({
            ok: false,
            error: error && error.message ? error.message : String(error),
          });
        }
        return false;
      }

      if (message.type === "CLEAR_ANNOTATIONS") {
        try {
          clearAnnotations();
          sendResponse({ ok: true });
        } catch (error) {
          sendResponse({
            ok: false,
            error: error && error.message ? error.message : String(error),
          });
        }
        return false;
      }

      return false;
    });
  }

  window.__webpageAnnotatorEngine = {
    applyAnnotations,
    clearAnnotations,
    updateAllPositions,
  };
})();
