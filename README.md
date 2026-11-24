# SoundCloud Switcher

Extension Chrome (Manifest V3) pour basculer entre plusieurs comptes SoundCloud en un clic. Les sessions sont chiffrées avec une passphrase (AES-GCM).

## Développement

Le code est en TypeScript dans `src/` et compilé dans `dist/` (non versionné).

```sh
npm install
npm run build   # ou npm run watch
npm test        # compile puis lance les vérifications de sécurité
npm run test:e2e   # charge l’extension dans Chromium et teste tout le parcours
```

Puis dans `chrome://extensions` : **Mode développeur** → **Charger l'extension non empaquetée** → choisir ce dossier.

Le test de bout en bout utilise ton Chromium installé (`%LOCALAPPDATA%\Chromium`, ou `CHROMIUM_PATH`) avec un profil temporaire, sinon le Chromium de Playwright (`npx playwright install chromium`). Ajoute `-- --headed` pour le regarder tourner. La CI GitHub lance les deux suites sur chaque PR.

## Licence

MIT — voir [LICENSE](LICENSE).
