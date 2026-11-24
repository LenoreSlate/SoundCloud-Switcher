// Traductions : mêmes clés et mêmes placeholders dans toutes les langues, et
// chaque clé utilisée par le code ou popup.html existe. npm test
import assert from "node:assert";
import { readFileSync, readdirSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const locales = Object.fromEntries(
  readdirSync(new URL("../_locales", import.meta.url)).map((lang) => [lang, JSON.parse(read(`_locales/${lang}/messages.json`))])
);
const placeholders = (entry) => JSON.stringify(Object.keys(entry.placeholders ?? {}).sort());

const en = locales.en;
for (const [lang, messages] of Object.entries(locales)) {
  assert.deepStrictEqual(Object.keys(messages).sort(), Object.keys(en).sort(), `${lang} : clés différentes de en`);
  for (const [key, entry] of Object.entries(messages)) {
    assert.ok(entry.message.trim(), `${lang}.${key} vide`);
    assert.strictEqual(placeholders(entry), placeholders(en[key]), `${lang}.${key} : placeholders différents`);
    for (const [, name] of entry.message.matchAll(/\$(\w+)\$/g)) {
      assert.ok(entry.placeholders?.[name.toLowerCase()], `${lang}.${key} : $${name}$ non déclaré`);
    }
  }
}

const used = [
  ...[read("src/popup.ts"), read("src/background.ts")].flatMap((src) => [...src.matchAll(/\bt\("(\w+)"/g)].map((m) => m[1])),
  ...[...read("popup.html").matchAll(/data-i18n(?:-title|-placeholder)?="(\w+)"/g)].map((m) => m[1]),
  ...[...read("manifest.json").matchAll(/__MSG_(\w+)__/g)].map((m) => m[1])
];
for (const key of used) assert.ok(en[key], `clé "${key}" utilisée mais absente des traductions`);
const unused = Object.keys(en).filter((key) => !used.includes(key));
assert.deepStrictEqual(unused, [], `clés inutilisées : ${unused}`);

console.log(`OK : ${Object.keys(locales).length} langues, ${Object.keys(en).length} clés cohérentes`);
