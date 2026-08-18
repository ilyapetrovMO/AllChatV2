import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import { createServer } from "vite";

const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const server = await createServer({
  root: desktopRoot,
  configFile: path.join(desktopRoot, "vite.renderer.config.mts"),
  server: { host: "127.0.0.1", port: 0 },
});

let browser;
try {
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string")
    throw new Error("Renderer test server did not expose a port.");

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const styleErrors = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      message.text().toLowerCase().includes("style")
    )
      styleErrors.push(message.text());
  });
  await page.addInitScript(() => {
    window.allchatDesktop = {
      getShellState: async () => ({ instances: [], activeInstanceId: null }),
      addInstance: async () => ({ instances: [], activeInstanceId: null }),
      selectInstance: async () => ({ instances: [], activeInstanceId: null }),
      loginInstance: async () => ({ instances: [], activeInstanceId: null }),
      logoutInstance: async () => ({ instances: [], activeInstanceId: null }),
      loadInstance: async () => {
        throw new Error("No Instance");
      },
      watchInstance: () => () => undefined,
      executeInstance: async () => ({ type: "accepted" }),
    };
  });
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.locator(".shell").waitFor();

  const actual = await page.locator(".shell").evaluate((element) => ({
    display: getComputedStyle(element).display,
    color: getComputedStyle(document.body).color,
  }));
  if (
    actual.display !== "grid" ||
    actual.color !== "rgb(240, 241, 245)" ||
    styleErrors.length
  ) {
    throw new Error(
      `Desktop stylesheet did not load: ${JSON.stringify({ ...actual, styleErrors })}`,
    );
  }
  const blobImageLoaded = await page.evaluate(async () => {
    const url = URL.createObjectURL(
      new Blob(
        ['<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'],
        { type: "image/svg+xml" },
      ),
    );
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return image.naturalWidth === 1;
    } finally {
      URL.revokeObjectURL(url);
    }
  });
  if (!blobImageLoaded)
    throw new Error(
      "Authenticated blob images are blocked by the Desktop CSP.",
    );
  console.log(
    "Desktop development stylesheet loaded under the production CSP.",
  );
} finally {
  await browser?.close();
  await server.close();
}
