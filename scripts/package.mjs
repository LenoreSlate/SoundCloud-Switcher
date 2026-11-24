// Copie dans build/ uniquement les fichiers livrés avec l'extension (Chrome et Firefox).
import { cpSync, rmSync } from "node:fs";

const FILES = ["manifest.json", "popup.html", "popup.css", "icons", "_locales", "dist", "LICENSE"];

rmSync("build", { recursive: true, force: true });
for (const file of FILES) cpSync(file, `build/${file}`, { recursive: true });
console.log(`build/ : ${FILES.join(", ")}`);
