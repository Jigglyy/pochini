import { prepare } from "./_webview";

// Before any test: make sure no test's WebView2 profile signs in to the
// Windows account (see e2e/_webview.ts for why that locked the account).
export default async function globalSetup() {
  await prepare();
}
