# SoundCloud Switcher

Extension Chrome (Manifest V3) pour basculer entre plusieurs comptes SoundCloud en un clic. Les sessions sont chiffrées avec une passphrase (AES-GCM).

## Développement

Le code est en TypeScript dans `src/` et compilé dans `dist/` (non versionné).

```sh
npm install
npm run build   # ou npm run watch
npm test        # compile puis lance les vérifications de sécurité
```

Puis dans `chrome://extensions` : **Mode développeur** → **Charger l'extension non empaquetée** → choisir ce dossier.

## Licence

MIT — voir [LICENSE](LICENSE).
