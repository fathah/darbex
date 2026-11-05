import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

const html = readFileSync(new URL("../extension/popup.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../extension/popup.js", import.meta.url), "utf8");
const settle = () => new Promise((resolve) => setImmediate(resolve));

async function open({ state = { supported: true, hidden: false, matchedCount: 0 }, unavailable = false, failAction = false } = {}) {
  const dom = new JSDOM(html, { url: "https://extension.test/popup.html", runScripts: "outside-only" });
  const messages = [];
  dom.window.chrome = {
    tabs: {
      async query(options) {
        assert.deepEqual({ ...options }, { active: true, currentWindow: true });
        return [{ id: 42 }];
      },
      async sendMessage(tabId, message) {
        assert.equal(tabId, 42);
        messages.push(message.type);
        if (unavailable || (failAction && message.type === "helper-tools:hide-tdata")) {
          throw new Error("No receiver");
        }
        return message.type === "helper-tools:hide-tdata"
          ? { supported: true, hidden: true, matchedCount: 4 }
          : state;
      }
    }
  };
  dom.window.eval(script);
  await settle();
  return {
    dom, messages,
    button: dom.window.document.querySelector("button"),
    status: dom.window.document.querySelector("#status")
  };
}

test("opening the popup only checks state; the Hide TData button triggers the action", async () => {
  const { dom, messages, button, status } = await open();
  try {
    assert.equal(button.textContent.trim(), "Hide TData");
    assert.equal(button.disabled, false);
    assert.deepEqual(messages, ["helper-tools:get-state"]);
    button.click();
    await settle();
    assert.deepEqual(messages, ["helper-tools:get-state", "helper-tools:hide-tdata"]);
    assert.equal(button.disabled, true);
    assert.equal(button.hasAttribute("aria-busy"), false);
    assert.match(status.textContent, /hidden for this page/i);
    assert.equal(button.textContent.trim(), "Hide TData");
  } finally { dom.window.close(); }
});

test("unsupported pages keep the button disabled and explain where to use it", async () => {
  const { dom, messages, button, status } = await open({ unavailable: true });
  try {
    button.click();
    assert.equal(button.disabled, true);
    assert.deepEqual(messages, ["helper-tools:get-state"]);
    assert.match(status.textContent, /supported invoice print page/i);
  } finally { dom.window.close(); }
});

test("reopening the popup on an already-hidden page does not apply the action again", async () => {
  const { dom, messages, button, status } = await open({ state: { supported: true, hidden: true, matchedCount: 4 } });
  try {
    assert.equal(button.disabled, true);
    assert.deepEqual(messages, ["helper-tools:get-state"]);
    assert.match(status.textContent, /refresh to restore/i);
  } finally { dom.window.close(); }
});

test("handles navigation or extension reload during the button action", async () => {
  const { dom, button, status } = await open({ failAction: true });
  try {
    button.click();
    await settle();
    assert.equal(button.disabled, true);
    assert.equal(button.hasAttribute("aria-busy"), false);
    assert.equal(dom.window.document.body.hasAttribute("data-error"), true);
    assert.match(status.textContent, /refresh the invoice page/i);
  } finally { dom.window.close(); }
});
