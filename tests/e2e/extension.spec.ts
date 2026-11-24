// Test de bout en bout : l'extension compilée (dist/) chargée dans Chromium.
// Profil temporaire jetable ; SoundCloud n'est jamais contacté (réponses bouchonnées).
//   npm run test:e2e              (headless)
//   npm run test:e2e -- --headed  (pour regarder)
import { test as base, expect, chromium, type BrowserContext, type Page, type Worker } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const EXTENSION = join(import.meta.dirname, "..", "..");

// Ton Chromium installé s'il existe (ou CHROMIUM_PATH), sinon celui de Playwright (CI).
const localChromium = process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Chromium", "Application", "chrome.exe");
const executablePath = process.env.CHROMIUM_PATH || (localChromium && existsSync(localChromium) ? localChromium : undefined);

const TOKEN_A = "2-111111-aaaaaa-TOKEN-ALPHA";
const TOKEN_B = "2-222222-bbbbbb-TOKEN-BETA";
const PASS = "correct horse battery";

const test = base.extend<{ context: BrowserContext; sw: Worker; popup: Page }>({
  context: async ({ headless }, use) => {
    const context = await chromium.launchPersistentContext("", {
      ...(executablePath ? { executablePath } : { channel: "chromium" }),
      headless,
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`]
    });
    await context.route(/^https?:\/\/([^/]+\.)?soundcloud\.com\//, (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<title>SoundCloud (bouchon)</title>" })
    );
    await use(context);
    await context.close();
  },
  sw: async ({ context }, use) => {
    await use(context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker")));
  },
  popup: async ({ context, sw }, use) => {
    const page = await context.newPage();
    page.on("dialog", (d) => d.accept()); // confirm() natifs
    await page.goto(`chrome-extension://${new URL(sw.url()).host}/popup.html`);
    await use(page);
  }
});

const login = (context: BrowserContext, token: string) =>
  context.addCookies([{ name: "oauth_token", value: token, domain: ".soundcloud.com", path: "/", secure: true }]);

const currentToken = async (context: BrowserContext) =>
  (await context.cookies("https://soundcloud.com")).find((c) => c.name === "oauth_token")?.value;

// Remplit la boîte de dialogue de passphrase dont le titre contient `title`.
async function passphrase(popup: Page, title: string, value: string) {
  await expect(popup.locator("#passDialog")).toBeVisible();
  await expect(popup.locator("#passTitle")).toContainText(title);
  await popup.fill("#passInput", value);
  if (await popup.locator("#passConfirm").isVisible()) await popup.fill("#passConfirm", value);
  await popup.locator("#passDialog").getByRole("button", { name: "Valider" }).click();
}

test("coffre, bascule, verrouillage, export et import", async ({ context, sw, popup }) => {
  const status = popup.locator("#saveStatus");
  const switchTo = (name: string) => popup.getByRole("button", { name: `Basculer vers ${name}` }).click();
  const storage = () => sw.evaluate(() => chrome.storage.local.get(null));
  const badge = () => sw.evaluate(() => chrome.action.getBadgeText({}));

  await test.step("premier compte : création du coffre", async () => {
    await login(context, TOKEN_A);
    await popup.fill("#accountName", "Alpha");
    await popup.click("#saveBtn");
    await passphrase(popup, "Choisissez une passphrase", PASS);
    await expect(status).toHaveText('Compte "Alpha" enregistré');
    expect(JSON.stringify(await storage())).not.toContain(TOKEN_A);
  });

  await test.step("déconnexion puis second compte", async () => {
    await popup.click("#cleanLogoutBtn");
    await expect(status).toHaveText("Déconnecté de SoundCloud");
    expect(await currentToken(context)).toBeUndefined();

    await login(context, TOKEN_B);
    await popup.fill("#accountName", "Beta");
    await popup.click("#saveBtn");
    await expect(status).toHaveText('Compte "Beta" enregistré');
    await expect(popup.locator(".account-item")).toHaveCount(2);
    expect(await badge()).toBe("BET");
  });

  await test.step("bascule entre les comptes", async () => {
    await switchTo("Alpha");
    await expect(status).toHaveText("Actif : Alpha");
    await expect.poll(() => currentToken(context)).toBe(TOKEN_A);
    expect(await badge()).toBe("ALP");

    await switchTo("Beta");
    await expect(status).toHaveText("Actif : Beta");
    await expect.poll(() => currentToken(context)).toBe(TOKEN_B);
  });

  await test.step("redémarrage navigateur : passphrase redemandée", async () => {
    await sw.evaluate(() => chrome.storage.session.remove("sc_key"));
    await switchTo("Alpha");
    await passphrase(popup, "déverrouiller", "mauvaise passphrase");
    await expect(popup.locator("#passError")).toHaveText("Passphrase incorrecte.");
    await passphrase(popup, "déverrouiller", PASS);
    await expect(status).toHaveText("Actif : Alpha");
    await expect.poll(() => currentToken(context)).toBe(TOKEN_A);
  });

  let backup = "";
  await test.step("export chiffré", async () => {
    const [download] = await Promise.all([popup.waitForEvent("download"), popup.click("#exportBtn")]);
    const stream = await download.createReadStream();
    for await (const chunk of stream) backup += chunk;
    expect(backup).not.toContain(TOKEN_A);
    expect(backup).not.toContain(TOKEN_B);
    expect(backup).not.toContain("Alpha");
    expect(backup).not.toContain("Beta");
    expect(JSON.parse(backup).data.ct).toBeTruthy();
  });

  await test.step("passphrase oubliée : réinitialisation", async () => {
    await sw.evaluate(() => chrome.storage.session.remove("sc_key"));
    await switchTo("Beta");
    await expect(popup.locator("#passDialog")).toBeVisible();
    await popup.click("#passReset");
    await expect(status).toHaveText("Coffre réinitialisé");
    await expect(popup.locator(".account-item")).toHaveCount(0);
  });

  await test.step("import dans un nouveau coffre", async () => {
    const file = { name: "backup.json", mimeType: "application/json", buffer: Buffer.from(backup) };

    await popup.setInputFiles("#importFileInput", file);
    await passphrase(popup, "fichier de sauvegarde", "mauvaise passphrase");
    await passphrase(popup, "Choisissez une passphrase", "nouvelle passphrase");
    await expect(status).toHaveText("Passphrase du fichier incorrecte.");

    await popup.setInputFiles("#importFileInput", file);
    await passphrase(popup, "fichier de sauvegarde", PASS);
    await expect(status).toHaveText("2 compte(s) importé(s)");
    await expect(popup.locator(".account-item")).toHaveCount(2);

    await switchTo("Alpha");
    await expect(status).toHaveText("Actif : Alpha");
    await expect.poll(() => currentToken(context)).toBe(TOKEN_A);
    expect(JSON.stringify(await storage())).not.toContain(TOKEN_A);
  });
});
