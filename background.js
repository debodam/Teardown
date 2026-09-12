// background.js — service worker shell.
// This will eventually own: injecting the page-read script on demand,
// calling Claude for the soft check + 4 fields, and the homepage fallback fetch.
// Nothing here yet — Saturday's build starts with the page-read step.

chrome.runtime.onInstalled.addListener(() => {
  console.log("Teardown extension installed.");
});
