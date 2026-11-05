# Tanseek Helper Tools

Small helper tools for supported pages. The current release hides the **VAT
included (5%)** invoice column and the **VAT included** summary line on screen
and in browser printing. Prices and totals stay unchanged.

[Download ZIP](https://github.com/fathah/darbex/raw/refs/heads/main/helper-tools.zip)
· [Download CRX](https://github.com/fathah/darbex/raw/refs/heads/main/helper-tools.crx)

## Install in Chrome

For ordinary Chrome installations on macOS and Windows, use the ZIP:

1. Download and extract `helper-tools.zip` into a folder you will keep.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the extracted folder containing `manifest.json`.
4. Refresh the invoice print page.

Use **Print → Save as PDF** for a PDF with the adjusted layout. The website's
separate Download PDF button may generate its own output.

Chrome restricts direct installation of self-hosted CRX files on macOS and
Windows. The signed CRX is provided for environments that support that
distribution method; downloading it from GitHub does not remove Chrome's
installation restrictions. See [Chrome's distribution guidance](https://developer.chrome.com/docs/extensions/how-to/distribute/host-on-linux).

The extension has no popup. It runs automatically on supported invoice print
pages. To restore the original view, disable it and refresh the page. For an
update, replace the extracted files, reload the extension in Chrome, and refresh
the invoice page. These downloads do not provide automatic updates.

## Scope and privacy

The extension is restricted to this HTTPS route:

```text
https://tanseek.ae/manager/{centre}/invoices/{invoice-id}/print
```

Query strings such as `?variant=without-government-fees` are accepted. Element
matching targets the supported English invoice markup. Other sites, subdomains,
and non-print pages are outside its scope. Navigation into a print page without
loading a new document may require a refresh.

It reads page labels and invoice amounts locally to identify which layout
elements to hide. It makes no network requests, stores no invoice data, uses no
analytics, and does not change saved invoice records. Original DOM nodes are
retained to preserve the website's rendering behavior.

## Development

Source files are in `extension/`. Node.js 22.13+ (or 24+) is needed only for
development; it is not needed to install the ZIP.

```sh
npm ci
npm test
npm run pack
```

`npm run pack` creates `helper-tools.crx`, `helper-tools.zip`, and
`SHA256SUMS.txt` at the project root. Only the `extension/` directory is packaged.
The script verifies the CRX3 signature and checks that its embedded ZIP matches
the standalone ZIP.

The private signing key is retained in `.local/helper-tools-signing.pem`, which
is excluded from Git. Keep a private backup and reuse it for future CRX updates.
The downloadable files contain no private signing key.

Automated DOM tests cover URL restrictions, reordered columns, delayed content,
and preserving amounts. The packaged extension still needs an installation and
print-preview check in the target browser.
