import { LOCKED, getLocal, t, type Message, type Reply } from "./shared.js";

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

// Textes statiques de popup.html : data-i18n (texte), data-i18n-title, data-i18n-placeholder.
document.documentElement.lang = chrome.i18n.getUILanguage();
for (const el of document.querySelectorAll<HTMLElement>("[data-i18n]")) el.textContent = t(el.dataset.i18n!);
for (const el of document.querySelectorAll<HTMLElement>("[data-i18n-title]")) el.title = t(el.dataset.i18nTitle!);
for (const el of document.querySelectorAll<HTMLInputElement>("[data-i18n-placeholder]")) el.placeholder = t(el.dataset.i18nPlaceholder!);

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
    passError.textContent = t("passMismatch");
  }
});

passReset.addEventListener("click", async () => {
  if (!confirm(t("resetConfirm"))) return;
  await send({ action: "RESET_VAULT" });
  passDialog.close("cancel");
  showStatus(t("vaultReset"), "success");
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
      ? { title: t("unlockTitle"), allowReset: true, error }
      : { title: t("createTitle"), create: true, error });
    if (passphrase === null) return false;

    const res = await send({ action: "UNLOCK", passphrase });
    if (res?.success) return true;
    error = res?.error || t("unlockError");
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
  if (res?.error === LOCKED) return t("locked");
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
      showStatus(t("loggedOut"), "success");
    } else {
      showStatus(response?.error || t("logoutError"), "error");
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
    accountNameInput.placeholder = t("detected", response.profile.username);
  }
}

// Sauvegarder le compte actif
async function handleSaveAccount() {
  const rawName = accountNameInput.value.trim();

  if (rawName.length > 50) {
    showStatus(t("nameTooLong"), "error");
    return;
  }

  const sanitizedName = rawName.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");

  saveBtn.disabled = true;
  showStatus(t("detecting"), "info");

  const response = await call({ action: "SAVE_ACTIVE_ACCOUNT", name: sanitizedName });
  saveBtn.disabled = false;
  if (response?.success) {
    accountNameInput.value = "";
    showStatus(t("accountSaved", response.name), "success");
    loadAccounts();
  } else {
    showStatus(errorText(response, t("saveError")), "error");
  }
}

// Basculer vers un compte
async function switchToAccount(name: string) {
  showStatus(t("switching", name), "info");

  const response = await call({ action: "SWITCH_ACCOUNT", accountName: name });
  if (response?.success) {
    showStatus(t("activeStatus", name), "success");
    loadAccounts();
  } else {
    showStatus(errorText(response, t("switchError")), "error");
  }
}

// Supprimer un compte avec confirmation
async function deleteAccount(name: string) {
  if (!confirm(t("deleteConfirm", name))) return;

  const response = await send({ action: "DELETE_ACCOUNT", name });
  if (response?.success) {
    showStatus(t("accountDeleted", name), "success");
  }
  loadAccounts();
}

// Exporter les profils en JSON, entièrement chiffré par le background : le
// fichier ne s'ouvre qu'avec la passphrase du coffre.
async function handleExportAccounts() {
  const res = await call({ action: "EXPORT_ACCOUNTS" });
  if (!res?.success) {
    showStatus(errorText(res, t("exportError")), "error");
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

  showStatus(t("exported", res.count), "success");
}

// Importer des profils depuis un fichier JSON
async function handleImportFile() {
  const file = importFileInput.files?.[0];
  // Réinitialiser le file input pour permettre une réimportation si besoin
  importFileInput.value = "";
  if (!file) return;
  if (file.size > MAX_IMPORT_BYTES) {
    showStatus(t("fileTooLarge"), "error");
    return;
  }

  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    showStatus(t("invalidJson"), "error");
    return;
  }

  let passphrase: string | null = null;
  if ((data as { vault?: unknown } | null)?.vault) {
    passphrase = await askPassphrase({ title: t("filePassTitle") });
    if (passphrase === null) return;
  }

  const res = await call({ action: "IMPORT_ACCOUNTS", file: data, passphrase });
  if (res?.success) {
    showStatus(t("imported", res.count), "success");
    loadAccounts();
  } else {
    showStatus(errorText(res, t("invalidFormat")), "error");
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
    emptyText.textContent = t("noAccounts");
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
      dot.title = t("activeAccount");
      infoDiv.appendChild(dot);
    }

    // Actions
    const actionsDiv = document.createElement("div");
    actionsDiv.className = "account-actions";

    const switchBtn = document.createElement("button");
    switchBtn.className = `btn btn-switch ${isActive ? "btn-active-state" : ""}`;
    switchBtn.textContent = isActive ? t("active") : t("activate");
    switchBtn.setAttribute("aria-label", t("switchToLabel", name));
    switchBtn.addEventListener("click", () => switchToAccount(name));

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn-delete";
    deleteBtn.title = t("delete");
    deleteBtn.setAttribute("aria-label", t("deleteLabel", name));
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
