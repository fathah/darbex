import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

const script = readFileSync(new URL("../extension/content.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../extension/print.css", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url)));
const PRINT_URL = "https://tanseek.ae/manager/example-centre/invoices/example-invoice/print?variant=without-government-fees";
const HIDDEN = "data-darbex-hidden";
const headers = ["#", "Description", "Qty", "Unit price (incl. VAT)", "VAT included (5%)", "Amount"];
const values = ["1", "Example service", "1", "300.00", "2.38", "300.00"];

function fixture(columns = headers, row = values) {
  return `<div class="ip-doc">
    <table class="ip-table"><thead><tr>${columns.map((label) => `<th>${label}</th>`).join("")}</tr></thead>
    <tbody><tr>${row.map((value) => `<td>${value}</td>`).join("")}</tr></tbody></table>
    <section class="ip-closing-grid"><div class="notes"><p>VAT included</p><p>Informational note</p></div>
    <div class="totals">
      <div id="subtotal"><span>Subtotal excluding VAT</span><span>AED 297.62</span></div>
      <div id="vat-summary"><span><span>VAT included</span></span><span>AED 2.38</span></div>
      <div id="total"><span>Total</span><span>AED 300.00</span></div>
      <div id="paid"><span>Paid amount</span><span>AED 300.00</span></div>
      <div id="balance"><span>Balance due</span><span>AED 0.00</span></div>
    </div></section></div>`;
}

function open(html = fixture(), url = PRINT_URL) {
  const dom = new JSDOM(`<!doctype html><html><head><style>${css}</style></head><body>${html}</body></html>`, {
    url,
    runScripts: "outside-only"
  });
  const observers = [];
  const Observer = dom.window.MutationObserver;
  dom.window.MutationObserver = class extends Observer {
    constructor(callback) {
      super(callback);
      observers.push(this);
    }
  };
  dom.dispose = () => {
    for (const observer of observers) observer.disconnect();
    dom.window.close();
  };
  let messageListener;
  dom.window.chrome = {
    runtime: {
      id: "helper-tools-test",
      onMessage: { addListener(listener) { messageListener = listener; } }
    }
  };
  dom.request = (message, sender = { id: "helper-tools-test" }) => {
    let response;
    messageListener?.(message, sender, (value) => { response = value; });
    return response;
  };
  dom.hide = () => dom.request({ type: "helper-tools:hide-tdata" });
  dom.state = () => dom.request({ type: "helper-tools:get-state" });
  dom.window.eval(script);
  return dom;
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
const hidden = (dom, element) => dom.window.getComputedStyle(element).display === "none";

test("removes only the VAT column and summary from layout; preserves all invoice amounts", () => {
  const dom = open();
  try {
    dom.hide();
    const { document } = dom.window;
    const [header, row] = document.querySelector("table").rows;
    for (let column = 0; column < headers.length; column += 1) {
      assert.equal(hidden(dom, header.cells[column]), column === 4);
      assert.equal(hidden(dom, row.cells[column]), column === 4);
    }
    assert.equal(hidden(dom, document.querySelector("#vat-summary")), true);
    for (const id of ["subtotal", "total", "paid", "balance"]) {
      assert.equal(hidden(dom, document.getElementById(id)), false);
    }
    assert.equal(document.querySelector("#subtotal span").textContent, "Subtotal");
    assert.equal(document.querySelector("#subtotal span:last-child").textContent, "AED 297.62");
    assert.equal(hidden(dom, document.querySelector(".totals")), false);
    assert.equal(hidden(dom, document.querySelector(".notes")), false);
    assert.deepEqual([...row.cells].map((cell) => cell.textContent), values);
    assert.equal(document.querySelectorAll(`[${HIDDEN}]`).length, 3);
  } finally { dom.dispose(); }
});

test("finds the VAT column after reordering instead of hiding a fixed position", () => {
  const order = [0, 1, 4, 2, 3, 5];
  const dom = open(fixture(order.map((i) => headers[i]), order.map((i) => values[i])));
  try {
    dom.hide();
    const row = dom.window.document.querySelector("tbody tr");
    assert.equal(hidden(dom, row.cells[2]), true);
    assert.equal(hidden(dom, row.cells[4]), false);
    assert.equal(hidden(dom, row.cells[5]), false);
  } finally { dom.dispose(); }
});

test("handles delayed rendering, added rows and repeated print events without shifting columns", async () => {
  const dom = open("");
  try {
    dom.hide();
    const { document, Event } = dom.window;
    document.body.innerHTML = fixture();
    await settle();
    assert.equal(hidden(dom, document.querySelector("#vat-summary")), true);
    const tbody = document.querySelector("tbody");
    tbody.insertAdjacentHTML("beforeend", "<tr><td>2</td><td>Another service</td><td>1</td><td>40.00</td><td>1.90</td><td>40.00</td></tr>");
    await settle();
    for (let i = 0; i < 3; i += 1) dom.window.dispatchEvent(new Event("beforeprint"));
    for (const row of tbody.rows) {
      assert.equal(row.cells.length, 6);
      assert.equal(hidden(dom, row.cells[4]), true);
      assert.equal(hidden(dom, row.cells[5]), false);
    }
    document.querySelector(".totals").outerHTML = `<div class="totals"><div id="new-vat"><span>VAT included</span><span>AED 4.28</span></div><div id="new-total"><span>Total</span><span>AED 340.00</span></div></div>`;
    await settle();
    assert.equal(hidden(dom, document.querySelector("#new-vat")), true);
    assert.equal(hidden(dom, document.querySelector("#new-total")), false);
  } finally { dom.dispose(); }
});

test("does not hide a similarly placed column when the VAT header is absent", async () => {
  const dom = open();
  try {
    dom.hide();
    const { document } = dom.window;
    document.querySelector("thead tr").cells[4].textContent = "Government fees";
    await settle();
    for (const row of document.querySelector("table").rows) {
      assert.equal(hidden(dom, row.cells[4]), false);
    }
  } finally { dom.dispose(); }
});

test("leaves spanning notes and tables outside the invoice untouched", () => {
  const html = `${fixture()}<table id="other"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody><tr>${values.map((v) => `<td>${v}</td>`).join("")}</tr></tbody></table>`;
  const dom = open(html.replace("</tbody>", '<tr id="note"><td colspan="6">VAT included</td></tr></tbody>'));
  try {
    dom.hide();
    const { document } = dom.window;
    assert.equal(document.querySelector("#note").querySelector(`[${HIDDEN}]`), null);
    assert.equal(document.querySelector("#other").querySelector(`[${HIDDEN}]`), null);
  } finally { dom.dispose(); }
});

test("matches case and whitespace changes and supports definition-list summaries", () => {
  const dom = open(fixture()
    .replace("VAT included (5%)", " VAT   included ( 5 % ) ")
    .replace('<span><span>VAT included</span></span><span>AED 2.38</span>', "<dt> vat included </dt><dd>AED&nbsp;2.38</dd>"));
  try {
    dom.hide();
    const { document } = dom.window;
    assert.equal(hidden(dom, document.querySelector("thead tr").cells[4]), true);
    assert.equal(hidden(dom, document.querySelector("dt")), true);
    assert.equal(hidden(dom, document.querySelector("dd")), true);
  } finally { dom.dispose(); }
});

test("does nothing outside the exact HTTPS Tanseek invoice print route", () => {
  for (const url of [
    PRINT_URL.replace("https:", "http:"),
    PRINT_URL.replace("tanseek.ae", "example.com"),
    PRINT_URL.replace("tanseek.ae", "demo.tanseek.ae"),
    PRINT_URL.replace("tanseek.ae", "tanseek.ae.example.com"),
    PRINT_URL.replace("/print?", "?"),
    PRINT_URL.replace("/print?", "/print-preview?"),
    PRINT_URL.replace("/print?", "/print/extra?"),
    "https://tanseek.ae/manager/example-centre/customers"
  ]) {
    const dom = open(fixture(), url);
    try {
      dom.hide();
      assert.equal(dom.window.document.querySelector(`[${HIDDEN}]`), null, url);
      assert.equal(dom.window.document.documentElement.hasAttribute("data-darbex-active"), false, url);
    } finally { dom.dispose(); }
  }
});

test("supports query variants and restores elements when navigating away", () => {
  for (const suffix of ["", "/", "?variant=without-government-fees", "?format=thermal&variant=without-government-fees"]) {
    const url = PRINT_URL.split("?")[0] + suffix;
    const dom = open(fixture(), url);
    try {
      dom.hide();
      assert.equal(hidden(dom, dom.window.document.querySelector("#vat-summary")), true, url);
      dom.reconfigure({ url: "https://tanseek.ae/manager/example-centre/invoices" });
      dom.window.dispatchEvent(new dom.window.Event("popstate"));
      assert.equal(dom.window.document.querySelector(`[${HIDDEN}]`), null);
      assert.equal(hidden(dom, dom.window.document.querySelector("#vat-summary")), false);
      assert.equal(dom.window.document.querySelector("#subtotal span").textContent, "Subtotal excluding VAT");
    } finally { dom.dispose(); }
  }
});

test("uses Manifest V3 and grants content access only on the specified host and path", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.content_scripts[0].matches, ["https://tanseek.ae/manager/*/invoices/*/print*"]);
  assert.equal(manifest.permissions, undefined);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.background, undefined);
  assert.equal(manifest.action.default_popup, "popup.html");
  assert.equal(css.includes("@media screen"), false);
});

test("leaves VAT fields and the original subtotal label visible until the button action", async () => {
  const dom = open();
  try {
    const { document, Event } = dom.window;
    assert.equal(dom.state().hidden, false);
    dom.window.dispatchEvent(new Event("beforeprint"));
    document.querySelector("tbody").insertAdjacentHTML("beforeend", "<tr><td>2</td><td>Service</td><td>1</td><td>40.00</td><td>1.90</td><td>40.00</td></tr>");
    await settle();
    assert.equal(document.querySelector(`[${HIDDEN}]`), null);
    assert.equal(document.querySelector("#subtotal span").textContent, "Subtotal excluding VAT");
    for (const row of document.querySelector("table").rows) {
      assert.equal(hidden(dom, row.cells[4]), false);
    }
    assert.equal(hidden(dom, document.querySelector("#vat-summary")), false);
    assert.equal(dom.hide().hidden, true);
    assert.equal(hidden(dom, document.querySelector("#vat-summary")), true);
    assert.equal(document.querySelector("#subtotal span").textContent, "Subtotal");
  } finally { dom.dispose(); }
});

test("ignores unrelated messages and other senders", () => {
  const dom = open();
  try {
    assert.equal(dom.request({ type: "other-action" }), undefined);
    assert.equal(dom.request({ type: "helper-tools:hide-tdata" }, { id: "other-extension" }), undefined);
    assert.equal(dom.state().hidden, false);
    assert.equal(dom.window.document.querySelector(`[${HIDDEN}]`), null);
  } finally { dom.dispose(); }
});

test("keeps subtotal text nodes and handles re-rendered labels without repeated mutations", async () => {
  const dom = open(fixture().replace("Subtotal excluding VAT", "  Subtotal Excluding VAT  "));
  try {
    const { document } = dom.window;
    const label = document.querySelector("#subtotal span");
    const originalTextNode = label.firstChild;
    dom.hide();
    await settle();
    assert.equal(label.firstChild, originalTextNode);
    assert.equal(label.textContent, "  Subtotal  ");
    dom.hide();
    assert.equal(label.textContent, "  Subtotal  ");
    label.innerHTML = "<span>Subtotal excluding VAT</span>";
    await settle();
    assert.equal(label.textContent, "Subtotal");
    assert.equal(dom.state().hidden, true);
  } finally { dom.dispose(); }
});

test("resets the action on another invoice URL and after a fresh page load", () => {
  const dom = open();
  const refreshed = open();
  try {
    dom.hide();
    assert.equal(dom.state().hidden, true);
    assert.equal(refreshed.state().hidden, false);
    assert.equal(refreshed.window.document.querySelector(`[${HIDDEN}]`), null);
    dom.reconfigure({ url: PRINT_URL.replace("example-invoice", "another-invoice") });
    dom.window.dispatchEvent(new dom.window.Event("beforeprint"));
    assert.equal(dom.state().hidden, false);
    assert.equal(dom.window.document.querySelector(`[${HIDDEN}]`), null);
    assert.equal(dom.window.document.querySelector("#subtotal span").textContent, "Subtotal excluding VAT");
    assert.equal(dom.hide().hidden, true);
  } finally { dom.dispose(); refreshed.dispose(); }
});
