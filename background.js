"use strict";

const configureSidePanelBehavior = async () => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.error("[Webpage Annotator] Failed to set side panel behavior:", error);
  }
};

chrome.runtime.onInstalled.addListener(() => {
  configureSidePanelBehavior();
});

chrome.runtime.onStartup.addListener(() => {
  configureSidePanelBehavior();
});

configureSidePanelBehavior();
