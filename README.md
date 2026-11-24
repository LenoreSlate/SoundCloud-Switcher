# SoundCloud Switcher

Extension Chrome et Firefox (Manifest V3) pour basculer entre plusieurs comptes SoundCloud en un clic. Les sessions sont chiffrées avec une passphrase (AES-GCM). Interface en anglais, français, espagnol, allemand et chinois, selon la langue du navigateur.

## Développement

Le code est en TypeScript dans `src/` et compilé dans `dist/` (non versionné).

```sh
npm install
npm run build   # ou npm run watch
npm test        # compile, vérifications de sécurité et cohérence des traductions
npm run test:e2e   # charge l’extension dans Chromium et teste tout le parcours
```

Puis dans `chrome://extensions` : **Mode développeur** → **Charger l'extension non empaquetée** → choisir ce dossier.

**Firefox (140+)** : `npm run package` copie dans `build/` uniquement les fichiers livrés. Ensuite, dans `about:debugging#/runtime/this-firefox` → **Charger un module complémentaire temporaire** → choisir `build/manifest.json`. Une installation permanente demande une signature par addons.mozilla.org. `npm run lint:firefox` valide l'extension avec `web-ext lint`, et la CI le lance sur chaque PR. Le même manifest sert aux deux navigateurs : Chrome utilise `background.service_worker`, Firefox `background.scripts`.

Le test de bout en bout utilise ton Chromium installé (`%LOCALAPPDATA%\Chromium`, ou `CHROMIUM_PATH`) avec un profil temporaire, sinon le Chromium de Playwright (`npx playwright install chromium`). Ajoute `-- --headed` pour le regarder tourner. La CI GitHub lance les deux suites sur chaque PR.

Les traductions sont dans `_locales/<langue>/messages.json`. Pour ajouter une langue, copier `en/` et traduire : `npm test` vérifie que les clés et les placeholders correspondent.

## Publier une version

1. Mettre à jour `version` dans `manifest.json` (via une PR fusionnée dans `main`).
2. Créer et pousser le tag correspondant :

```sh
git tag v1.3.0
git push origin v1.3.0
```

Le workflow `Release` relance tous les tests, vérifie que le tag correspond au manifest, puis publie une GitHub Release avec `soundcloud-switcher-v1.3.0.zip`. Ce zip est prêt pour le Chrome Web Store, ou à décompresser et charger via « Charger l'extension non empaquetée ».

## Licence

MIT — voir [LICENSE](LICENSE).
