// Tiny JSON-file storage. Each "store" is one file in data/. Writes are batched so
// busy features (like XP on every message) don't hammer the disk.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
mkdirSync(DATA_DIR, { recursive: true });

const stores = new Map(); // name -> { data, timer }

function load(name) {
  try {
    return JSON.parse(readFileSync(join(DATA_DIR, `${name}.json`), "utf8"));
  } catch {
    return {};
  }
}

function writeNow(name) {
  const s = stores.get(name);
  if (!s) return;
  clearTimeout(s.timer);
  s.timer = null;
  const file = join(DATA_DIR, `${name}.json`);
  writeFileSync(file + ".tmp", JSON.stringify(s.data));
  renameSync(file + ".tmp", file); // atomic: never leaves a half-written file
}

/** The whole object for a store (created on first use). Mutate it, then call persist(name). */
export function db(name) {
  if (!stores.has(name)) stores.set(name, { data: load(name), timer: null });
  return stores.get(name).data;
}

/** Schedule a save. delay=0 saves right away. */
export function persist(name, delay = 3000) {
  const s = stores.get(name);
  if (!s) return;
  if (delay === 0) return writeNow(name);
  if (!s.timer) s.timer = setTimeout(() => writeNow(name), delay);
}

/** Per-server sub-object of a store, e.g. bucket("levels", guildId)[userId]. */
export function bucket(name, guildId) {
  const d = db(name);
  return (d[guildId] ??= {});
}

export function flushAll() {
  for (const [name, s] of stores) if (s.timer) writeNow(name);
}

// ---- server settings ("guilds" store) -------------------------------------

/** Mutable settings object for a server. Call saveConfig() after changing it. */
export const config = (guildId) => bucket("guilds", guildId);
export const saveConfig = () => persist("guilds", 0);
export const getGuild = (guildId) => db("guilds")[guildId] || {};
export function setGuild(guildId, patch) {
  Object.assign(config(guildId), patch);
  saveConfig();
}

// ---- linked game accounts -------------------------------------------------

export const getLinks = (userId) => db("links")[userId] || {};
export const getLink = (userId, game) => db("links")[userId]?.[game];
export const allLinks = () => Object.entries(db("links"));

export function setLink(userId, game, account) {
  const links = db("links");
  links[userId] = { ...links[userId], [game]: account };
  persist("links", 0);
}

export function removeLink(userId, game) {
  const links = db("links");
  if (!links[userId]?.[game]) return false;
  delete links[userId][game];
  if (!Object.keys(links[userId]).length) delete links[userId];
  persist("links", 0);
  return true;
}
