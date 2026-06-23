#!/usr/bin/env node
/**
 * Installs the current built plugin artifacts into local Obsidian vaults.
 *
 * Vault roots are read from install-locations.local.txt, one path per line.
 * Blank lines and # comments are ignored.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const LOCATIONS_FILE = join(ROOT, 'install-locations.local.txt');
const MANIFEST_PATH = join(ROOT, 'manifest.json');
const FILES = ['main.js', 'manifest.json', 'styles.css'];

function readLocations() {
  if (!existsSync(LOCATIONS_FILE)) {
    throw new Error('Missing install-locations.local.txt');
  }

  return readFileSync(LOCATIONS_FILE, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
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
      throw new Error(`Missing build artifact: ${file}`);
    }
  }
}

function assertVaultRoot(path) {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error(`Install location is not a directory: ${path}`);
  }
}

function installToVault(vaultRoot, pluginId) {
  const pluginsDir = join(vaultRoot, '.obsidian', 'plugins');
  const pluginDir = findExistingPluginDir(pluginsDir, pluginId) ?? join(pluginsDir, pluginId);

  mkdirSync(pluginDir, { recursive: true });

  for (const file of FILES) {
    copyFileSync(join(ROOT, file), join(pluginDir, file));
  }

  console.log(`Installed ${pluginId} to ${pluginDir}`);
}

function main() {
  const manifest = readJson(MANIFEST_PATH);
  const pluginId = manifest.id;
  if (!pluginId) {
    throw new Error('manifest.json is missing an id');
  }

  assertBuildArtifacts();

  const locations = readLocations();
  if (locations.length === 0) {
    throw new Error('install-locations.local.txt has no install locations');
  }

  for (const location of locations) {
    const vaultRoot = resolve(ROOT, location);
    assertVaultRoot(vaultRoot);
    installToVault(vaultRoot, pluginId);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
