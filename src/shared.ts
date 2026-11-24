// Contrat partagé entre la popup et le service worker.

export const LOCKED = "LOCKED";

// Données chiffrées AES-GCM (base64).
export type Box = { iv: string; ct: string };
export type Vault = { salt: string; check: Box };

export type Profile = {
  username: string;
  avatarUrl: string;
  permalinkUrl: string;
  followersCount: number;
};

export type Account = {
  name: string;
  username: string;
  avatarUrl: string | null;
  permalinkUrl: string | null;
  secret?: Box; // cookies chiffrés (v1.2+)
  cookies?: unknown[]; // ancien stockage en clair (v1.1.0), migré au déverrouillage
  savedAt?: string;
  lastSynced?: string;
};
export type Accounts = Record<string, Account>;

// Fichier de sauvegarde (v1.3+) : tout le contenu des comptes est dans `data`,
// chiffré avec la clé du coffre. Seuls l'app, la version et la date restent lisibles.
export type ExportFile = {
  app: string;
  version: string;
  exportedAt: string;
  vault: Vault;
  data: Box;
};

// Contenu de chrome.storage.local
export type Local = {
  sc_vault?: Vault;
  sc_accounts?: Accounts;
  sc_active_account?: string | null;
};

export function getLocal<K extends keyof Local>(...keys: K[]): Promise<Pick<Local, K>> {
  return chrome.storage.local.get<Pick<Local, K>>(keys);
}

// Messages popup -> background : action -> [champs de la requête, réponse si succès]
type Ok = { success: true };
export type Failure = { success: false; error: string };
export type VaultState = Ok & { hasVault: boolean; unlocked: boolean; hasLegacy: boolean };

export type Api = {
  SWITCH_ACCOUNT: [{ accountName: string }, Ok];
  CLEAN_LOGOUT: [{}, Ok];
  SAVE_ACTIVE_ACCOUNT: [{ name: string }, Ok & { name: string; profile: Profile | null }];
  DELETE_ACCOUNT: [{ name: string }, Ok];
  IMPORT_ACCOUNTS: [{ file: unknown; passphrase: string | null }, Ok & { count: number }];
  EXPORT_ACCOUNTS: [{}, Ok & { file: ExportFile; count: number }];
  GET_CURRENT_SC_PROFILE: [
    {},
    (Ok & { authenticated: true; profile: Profile | null }) | { success: false; authenticated: false }
  ];
  GET_VAULT_STATE: [{}, VaultState];
  UNLOCK: [{ passphrase: string }, Ok];
  RESET_VAULT: [{}, Ok];
};

export type Action = keyof Api;
export type Message<K extends Action = Action> = { [A in K]: { action: A } & Api[A][0] }[K];
export type Reply<K extends Action> = Api[K][1] | Failure;

// Texte traduit dans la langue du navigateur (_locales/<langue>/messages.json).
export const t = (key: string, ...subs: (string | number)[]): string => chrome.i18n.getMessage(key, subs.map(String));
