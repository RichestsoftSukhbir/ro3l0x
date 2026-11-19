// Shared helpers for feature modules.
import { EmbedBuilder, MessageFlags, PermissionFlagsBits } from "discord.js";

/** Throw this for problems the user caused or can fix; the message is shown to them. */
export class UserError extends Error {}

export const COLORS = { main: 0x5865f2, ok: 0x57f287, warn: 0xfee75c, bad: 0xed4245, gold: 0xf1c40f, pink: 0xeb459e };
export const EPHEMERAL = MessageFlags.Ephemeral;

export const embed = (description, color = COLORS.main) => new EmbedBuilder().setColor(color).setDescription(description);
export const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const n = (x) => Number(x).toLocaleString("en-US");
export const ts = (ms, style = "R") => `<t:${Math.floor(ms / 1000)}:${style}>`;

const UNITS = { w: 604_800_000, d: 86_400_000, h: 3_600_000, m: 60_000, s: 1000 };

/** "10m", "1h30m", "2d", "1w" -> milliseconds. A bare number means minutes. Returns null if invalid. */
export function parseDuration(text) {
  const str = String(text || "").trim().toLowerCase();
  if (/^\d+$/.test(str)) return Number(str) * UNITS.m;
  let ms = 0;
  let rest = str;
  for (const m of str.matchAll(/(\d+)\s*(w|d|h|m|s)[a-z]*/g)) {
    ms += Number(m[1]) * UNITS[m[2]];
    rest = rest.replace(m[0], "");
  }
  return ms > 0 && !rest.trim() ? ms : null;
}

export function fmtDuration(ms) {
  const parts = [];
  for (const [u, size] of Object.entries(UNITS)) {
    if (ms >= size) {
      parts.push(`${Math.floor(ms / size)}${u}`);
      ms %= size;
    }
  }
  return parts.slice(0, 2).join(" ") || "0s";
}

export function progressBar(value, max, size = 14) {
  const filled = Math.max(0, Math.min(size, Math.round((value / max) * size)));
  return "▰".repeat(filled) + "▱".repeat(size - filled);
}

/** Replaces {user}, {username}, {server}, {count} etc. in admin-written messages. */
export function fillTemplate(template, { member, user, guild, extra = {} }) {
  const u = user || member?.user;
  const vars = {
    user: u ? `<@${u.id}>` : "",
    username: u?.username ?? "",
    server: guild?.name ?? "",
    count: guild?.memberCount ? n(guild.memberCount) : "",
    ...extra,
  };
  return template.replace(/\{(\w+)\}/g, (all, key) => (key in vars ? String(vars[key]) : all));
}

/** Can the bot give/remove this role? */
export function botCanManage(guild, role) {
  const me = guild.members.me;
  return Boolean(me?.permissions.has(PermissionFlagsBits.ManageRoles) && role.id !== guild.id && !role.managed && role.position < me.roles.highest.position);
}

export function assertCanManage(guild, role) {
  if (role.id === guild.id || role.managed) throw new UserError(`${role} can't be assigned by bots.`);
  if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) throw new UserError("I need the **Manage Roles** permission.");
  if (role.position >= guild.members.me.roles.highest.position) {
    throw new UserError(`${role} is above my highest role. Drag my role above it in *Server Settings → Roles*.`);
  }
}

export function isManager(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

export function requireManager(interaction) {
  if (!interaction.inGuild()) throw new UserError("This only works in a server.");
  if (!isManager(interaction)) throw new UserError("You need the **Manage Server** permission for that.");
}

export function requireGuild(interaction) {
  if (!interaction.inGuild()) throw new UserError("This only works in a server.");
}

/** Checks the bot can post embeds in a channel. */
export function assertCanPost(channel, guild) {
  const perms = channel.permissionsFor(guild.members.me);
  if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
    throw new UserError(`I can't post in ${channel}. Give me **View Channel**, **Send Messages** and **Embed Links** there.`);
  }
}

/** Sends a channel by id if it exists and is text-based; swallows errors. */
export async function sendTo(client, channelId, payload) {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return null;
  return channel.send(payload).catch((err) => {
    console.error(`[send] ${channelId}:`, err.message);
    return null;
  });
}
