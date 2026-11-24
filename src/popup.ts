import { LOCKED, getLocal, type Message, type Reply } from "./shared.js";

// DOM Elements (tous présents dans popup.html)
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const accountNameInput = byId<HTMLInputElement>("accountName");
const saveBtn = byId<HTMLButtonElement>("saveBtn");
const saveStatus = byId<HTMLParagraphElement>("saveStatus");
const accountsList = byId<HTMLDivElement>("accountsList");
const accountCount = byId<HTMLSpanElement>("accountCount");
const openSoundcloudBtn = byId<HTMLButtonElement>("openSoundcloudBtn");
const cleanLogoutBtn = byId<HTMLButtonElement>("cleanLogoutBtn");
const exportBtn = byId<HTMLButtonElement>("exportBtn");
const importBtn = byId<HTMLButtonElement>("importBtn");
const importFileInput = byId<HTMLInputElement>("importFileInput");
const passDialog = byId<HTMLDialogElement>("passDialog");
const passForm = byId<HTMLFormElement>("passForm");
const passTitle = byId<HTMLParagraphElement>("passTitle");
const passInput = byId<HTMLInputElement>("passInput");
const passConfirm = byId<HTMLInputElement>("passConfirm");
const passError = byId<HTMLParagraphElement>("passError");
const passReset = byId<HTMLButtonElement>("passReset");

const MAX_IMPORT_BYTES = 1_000_000;

// Message typé vers le background.
function send<M extends Message>(message: M): Promise<Reply<M["action"]> | undefined> {
  return chrome.runtime.sendMessage(message);
}

// --- Coffre chiffré : passphrase -------------------------------------------

type PassOptions = { title: string; create?: boolean; allowReset?: boolean; error?: string };

// Ouvre la boîte de dialogue ; résout avec la passphrase, ou null si annulé.
function askPassphrase({ title, create = false, allowReset = false, error = "" }: PassOptions): Promise<string | null> {
  return new Promise((resolve) => {
    passTitle.textContent = title;
    passError.textContent = error;
    passInput.value = "";
    passConfirm.value = "";
    passInput.minLength = create ? 8 : 0;
    passInput.autocomplete = create ? "new-password" : "current-password";
    passConfirm.hidden = !create;
    passConfirm.required = create;
    passReset.hidden = !allowReset;
    passDialog.returnValue = "";
    passDialog.onclose = () => resolve(passDialog.returnValue === "ok" ? passInput.value : null);
    passDialog.showModal();
  });
}

passForm.addEventListener("submit", (e) => {
  const submitter = e.submitter as HTMLButtonElement | null;
  if (submitter?.value === "ok" && !passConfirm.hidden && passInput.value !== passConfirm.value) {
    e.preventDefault();
    passError.textContent = "Les passphrases ne correspondent pas";
  }
});

passReset.addEventListener("click", async () => {
  if (!confirm("Supprimer tous les comptes enregistrés et la passphrase ? Cette action est définitive.")) return;
  await send({ action: "RESET_VAULT" });
  passDialog.close("cancel");
  showStatus("Coffre réinitialisé", "success");
  loadAccounts();
});

// Déverrouille (ou crée) le coffre. Renvoie true si c'est fait.
async function unlockFlow(): Promise<boolean> {
  const state = await send({ action: "GET_VAULT_STATE" });
  if (state?.success && state.unlocked) return true;
  const hasVault = state?.success && state.hasVault;

  let error = "";
  for (;;) {
    const passphrase = await askPassphrase(hasVault
      ? { title: "Passphrase pour déverrouiller vos sessions", allowReset: true, error }
      : { title: "Choisissez une passphrase (8 car. min.) pour chiffrer vos sessions. Elle ne peut pas être récupérée.", create: true, error });
    if (passphrase === null) return false;

    const res = await send({ action: "UNLOCK", passphrase });
    if (res?.success) return true;
    error = res?.error || "Erreur de déverrouillage";
  }
}

// Envoie un message au background ; si le coffre est verrouillé, demande la
// passphrase puis relance une fois.
async function call<M extends Message>(message: M) {
  const isLocked = (r: unknown) => (r as { error?: unknown } | undefined)?.error === LOCKED;
  let res = await send(message);
  if (isLocked(res) && await unlockFlow()) {
    res = await send(message);
  }
  return res;
}

function errorText(res: { error?: string } | undefined, fallback: string): string {
  if (res?.error === LOCKED) return "Sessions verrouillées";
  return res?.error || fallback;
}

// Initialisation de la popup
document.addEventListener("DOMContentLoaded", async () => {
  loadAccounts();
  checkCurrentSoundCloudSession();

  saveBtn.addEventListener("click", handleSaveAccount);
  accountNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSaveAccount();
    }
  });

  cleanLogoutBtn.addEventListener("click", async () => {
    const response = await send({ action: "CLEAN_LOGOUT" });
    if (response?.success) {
      showStatus("Déconnecté de SoundCloud", "success");
    } else {
      showStatus(response?.error || "Erreur de déconnexion", "error");
    }
    loadAccounts();
  });

  openSoundcloudBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: "https://soundcloud.com/discover" });
  });

  exportBtn.addEventListener("click", handleExportAccounts);

  importBtn.addEventListener("click", () => importFileInput.click());
  importFileInput.addEventListener("change", handleImportFile);

  // Anciennes sessions stockées en clair (v1.1.0) : chiffrer au plus vite.
  // Après les écouteurs, sinon les clics faits avant la réponse sont perdus.
  const state = await send({ action: "GET_VAULT_STATE" });
  if (state?.success && state.hasLegacy) unlockFlow().then(loadAccounts);
});

// Pré-détecte la session SoundCloud active pour aider l'utilisateur
async function checkCurrentSoundCloudSession() {
  const response = await send({ action: "GET_CURRENT_SC_PROFILE" });
  if (response?.success && response.profile?.username && !accountNameInput.value) {
    accountNameInput.placeholder = `Détecté : ${response.profile.username}`;
  }
}

// Sauvegarder le compte actif
async function handleSaveAccount() {
  const rawName = accountNameInput.value.trim();

  if (rawName.length > 50) {
    showStatus("Nom trop long (max 50 car.)", "error");
    return;
  }

  const sanitizedName = rawName.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");

  saveBtn.disabled = true;
  showStatus("Détection du profil SoundCloud...", "info");

  const response = await call({ action: "SAVE_ACTIVE_ACCOUNT", name: sanitizedName });
  saveBtn.disabled = false;
  if (response?.success) {
    accountNameInput.value = "";
    showStatus(`Compte "${response.name}" enregistré`, "success");
    loadAccounts();
  } else {
    showStatus(errorText(response, "Erreur lors de la sauvegarde"), "error");
  }
}

// Basculer vers un compte
async function switchToAccount(name: string) {
  showStatus(`Bascule vers "${name}"...`, "info");

  const response = await call({ action: "SWITCH_ACCOUNT", accountName: name });
  if (response?.success) {
    showStatus(`Actif : ${name}`, "success");
    loadAccounts();
  } else {
    showStatus(errorText(response, "Erreur lors de la bascule"), "error");
  }
}

// Supprimer un compte avec confirmation
async function deleteAccount(name: string) {
  if (!confirm(`Supprimer le compte "${name}" ?`)) return;

  const response = await send({ action: "DELETE_ACCOUNT", name });
  if (response?.success) {
    showStatus(`Compte "${name}" supprimé`, "success");
  }
  loadAccounts();
}

// Exporter les profils en JSON, entièrement chiffré par le background : le
// fichier ne s'ouvre qu'avec la passphrase du coffre.
async function handleExportAccounts() {
  const res = await call({ action: "EXPORT_ACCOUNTS" });
  if (!res?.success) {
    showStatus(errorText(res, "Erreur lors de l'export"), "error");
    return;
  }

  const blob = new Blob([JSON.stringify(res.file, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `soundcloud_switcher_backup_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showStatus(`${res.count} profil(s) exporté(s) (chiffré)`, "success");
}

// Importer des profils depuis un fichier JSON
async function handleImportFile() {
  const file = importFileInput.files?.[0];
  // Réinitialiser le file input pour permettre une réimportation si besoin
  importFileInput.value = "";
  if (!file) return;
  if (file.size > MAX_IMPORT_BYTES) {
    showStatus("Fichier trop volumineux", "error");
    return;
  }

  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    showStatus("Fichier JSON non valide", "error");
    return;
  }

  let passphrase: string | null = null;
  if ((data as { vault?: unknown } | null)?.vault) {
    passphrase = await askPassphrase({ title: "Passphrase du fichier de sauvegarde" });
    if (passphrase === null) return;
  }

  const res = await call({ action: "IMPORT_ACCOUNTS", file: data, passphrase });
  if (res?.success) {
    showStatus(`${res.count} compte(s) importé(s)`, "success");
    loadAccounts();
  } else {
    showStatus(errorText(res, "Format de fichier invalide"), "error");
  }
}

// Création sécurisée de l'icône SVG poubelle
function createTrashIcon(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "13");
  svg.setAttribute("height", "13");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2");
  svg.appendChild(path);

  return svg;
}

function avatarInitial(name: string): HTMLSpanElement {
  const initial = document.createElement("span");
  initial.className = "account-avatar-initial";
  initial.textContent = name.charAt(0).toUpperCase() || "A";
  return initial;
}

// Chargement sécurisé de la liste des comptes dans le DOM
async function loadAccounts() {
  const { sc_accounts: accounts = {}, sc_active_account: activeAccount } =
    await getLocal("sc_accounts", "sc_active_account");
  const names = Object.keys(accounts);

  accountCount.textContent = String(names.length);
  accountsList.replaceChildren();

  if (names.length === 0) {
    const emptyDiv = document.createElement("div");
    emptyDiv.className = "empty-state";
    const emptyText = document.createElement("p");
    emptyText.textContent = "Aucun compte enregistré";
    emptyDiv.appendChild(emptyText);
    accountsList.appendChild(emptyDiv);
    return;
  }

  for (const name of names) {
    const account = accounts[name];
    const isActive = activeAccount === name;

    const item = document.createElement("div");
    item.className = `account-item ${isActive ? "is-active" : ""}`;

    // Section Info
    const infoDiv = document.createElement("div");
    infoDiv.className = "account-info";

    // Avatar
    const avatarWrap = document.createElement("div");
    avatarWrap.className = "account-avatar-wrap";

    if (account.avatarUrl) {
      const img = document.createElement("img");
      img.className = "account-avatar-img";
      img.src = account.avatarUrl;
      img.alt = name;
      img.onerror = () => {
        img.remove();
        avatarWrap.appendChild(avatarInitial(name));
      };
      avatarWrap.appendChild(img);
    } else {
      avatarWrap.appendChild(avatarInitial(name));
    }

    // Nom & handle
    const textWrap = document.createElement("div");
    textWrap.className = "account-text-wrap";

    const nameSpan = document.createElement("span");
    nameSpan.className = "account-name";
    nameSpan.title = name;
    nameSpan.textContent = name;

    textWrap.appendChild(nameSpan);

    if (account.username && account.username !== name) {
      const subSpan = document.createElement("span");
      subSpan.className = "account-subtext";
      subSpan.textContent = `@${account.username}`;
      textWrap.appendChild(subSpan);
    }

    infoDiv.appendChild(avatarWrap);
    infoDiv.appendChild(textWrap);

    if (isActive) {
      const dot = document.createElement("span");
      dot.className = "active-dot";
      dot.title = "Compte actif";
      infoDiv.appendChild(dot);
    }

    // Actions
    const actionsDiv = document.createElement("div");
    actionsDiv.className = "account-actions";

    const switchBtn = document.createElement("button");
    switchBtn.className = `btn btn-switch ${isActive ? "btn-active-state" : ""}`;
    switchBtn.textContent = isActive ? "Actif" : "Activer";
    switchBtn.setAttribute("aria-label", `Basculer vers ${name}`);
    switchBtn.addEventListener("click", () => switchToAccount(name));

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn-delete";
    deleteBtn.title = "Supprimer";
    deleteBtn.setAttribute("aria-label", `Supprimer le compte ${name}`);
    deleteBtn.appendChild(createTrashIcon());
    deleteBtn.addEventListener("click", () => deleteAccount(name));

    actionsDiv.appendChild(switchBtn);
    actionsDiv.appendChild(deleteBtn);

    item.appendChild(infoDiv);
    item.appendChild(actionsDiv);

    accountsList.appendChild(item);
  }
}

let statusTimeout: ReturnType<typeof setTimeout> | null = null;
function showStatus(text: string, type: "success" | "error" | "info") {
  if (statusTimeout) clearTimeout(statusTimeout);
  saveStatus.textContent = text;
  saveStatus.className = `status-msg ${type}`;

  statusTimeout = setTimeout(() => {
    saveStatus.textContent = "";
    saveStatus.className = "status-msg";
  }, 3200);
}
