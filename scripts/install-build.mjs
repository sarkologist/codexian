#!/usr/bin/env node
/**
 * Installs the current built plugin artifacts into local Obsidian vaults.
 *
 * Target vaults are resolved in one of two ways:
 *   1. Explicit: install-locations.local.txt (one vault root per line; blank
 *      lines and # comments ignored). Listed vaults are always installed to,
 *      creating the plugin folder if absent (bootstraps a new install).
 *   2. Auto-discovery (when that file is absent): every vault Obsidian
 *      knows about (from its obsidian.json) that ALREADY has this plugin
 *      installed, matched by manifest id. Existing installs are updated in
 *      place; vaults without the plugin are left untouched.
 *
 * Auto-discovery means a fresh checkout with no locations file still deploys to
 * the right places instead of silently no-op'ing, and it matches by manifest id
 * so the plugin's on-disk folder name may differ from the id.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const LOCATIONS_FILE = join(ROOT, 'install-locations.local.txt');
const MANIFEST_PATH = join(ROOT, 'manifest.json');
const FILES = ['main.js', 'manifest.json', 'styles.css'];

/**
 * Vault roots from install-locations.local.txt.
 * Returns null when the file is absent (caller falls back to auto-discovery),
 * or an array (possibly empty) when it exists — a present-but-empty file is an
 * explicit "install nowhere", not a trigger for auto-discovery.
 */
function readLocations() {
  if (!existsSync(LOCATIONS_FILE)) {
    return null;
  }

  return readFileSync(LOCATIONS_FILE, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Path to Obsidian's config file that lists every vault the user has opened. */
function obsidianConfigPath() {
  const home = homedir();
  if (process.platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'obsidian', 'obsidian.json');
  }
  if (process.platform === 'win32') {
    return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'obsidian', 'obsidian.json');
  }
  return join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'obsidian', 'obsidian.json');
}

/** Vault roots Obsidian knows about (best-effort; empty if config is missing/unreadable). */
function readKnownVaults() {
  const configPath = obsidianConfigPath();
  if (!existsSync(configPath)) {
    return [];
  }

  try {
    const config = readJson(configPath);
    return Object.values(config.vaults || {})
      .map(vault => vault?.path)
      .filter(path => typeof path === 'string' && path.length > 0);
  } catch {
    return [];
  }
}

function findExistingPluginDir(pluginsDir, pluginId) {
  if (!existsSync(pluginsDir)) return null;

  for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(pluginsDir, entry.name, 'manifest.json');
    if (!existsSync(manifestPath)) continue;

    try {
      const manifest = readJson(manifestPath);
      if (manifest.id === pluginId) {
        return join(pluginsDir, entry.name);
      }
    } catch {
      // Ignore malformed manifests in unrelated plugin folders.
    }
  }

  return null;
}

function assertBuildArtifacts() {
  for (const file of FILES) {
    const path = join(ROOT, file);
    if (!existsSync(path)) {
      throw new Error(`Missing build artifact: ${file}. Run "npm run build" first.`);
    }
  }
}

/**
 * Copy the built artifacts into a vault's plugin folder.
 * Returns true if it installed, false if it skipped.
 * With createIfMissing=false, a vault that doesn't already have the plugin (or
 * a vault root that no longer exists) is skipped rather than created.
 */
function installToVault(vaultRoot, pluginId, { createIfMissing }) {
  if (!existsSync(vaultRoot) || !statSync(vaultRoot).isDirectory()) {
    if (createIfMissing) {
      throw new Error(`Install location is not a directory: ${vaultRoot}`);
    }
    return false;
  }

  const pluginsDir = join(vaultRoot, '.obsidian', 'plugins');
  const existingDir = findExistingPluginDir(pluginsDir, pluginId);
  if (!existingDir && !createIfMissing) {
    return false;
  }

  const pluginDir = existingDir ?? join(pluginsDir, pluginId);
  mkdirSync(pluginDir, { recursive: true });

  for (const file of FILES) {
    copyFileSync(join(ROOT, file), join(pluginDir, file));
  }

  console.log(`Installed ${pluginId} to ${pluginDir}`);
  return true;
}

function main() {
  const manifest = readJson(MANIFEST_PATH);
  const pluginId = manifest.id;
  if (!pluginId) {
    throw new Error('manifest.json is missing an id');
  }

  assertBuildArtifacts();

  const explicitLocations = readLocations();

  // Explicit file present: install to exactly what it lists (bootstrapping new
  // installs). An empty list is a deliberate "install nowhere".
  if (explicitLocations !== null) {
    if (explicitLocations.length === 0) {
      console.warn(
        'install-locations.local.txt lists no vaults; nothing to install. ' +
        'Delete the file to auto-discover installed vaults instead.',
      );
      return;
    }
    for (const location of explicitLocations) {
      const vaultRoot = resolve(ROOT, location);
      installToVault(vaultRoot, pluginId, { createIfMissing: true });
    }
    return;
  }

  // No file: auto-discover and update every vault that already has the plugin.
  let installed = 0;
  for (const vaultRoot of readKnownVaults()) {
    if (installToVault(resolve(vaultRoot), pluginId, { createIfMissing: false })) {
      installed += 1;
    }
  }

  if (installed === 0) {
    console.warn(
      `No vault has "${pluginId}" installed (searched Obsidian's known vaults).\n` +
      'Install the plugin in a vault first, or list target vault roots in install-locations.local.txt.',
    );
    return;
  }
  console.log(`Auto-discovered ${installed} vault(s) with "${pluginId}" installed.`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
