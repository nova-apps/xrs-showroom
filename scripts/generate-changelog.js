#!/usr/bin/env node

/**
 * generate-changelog.js
 * ---------------------
 * Reads the existing CHANGELOG.md, detects the last documented version,
 * gathers all new git commits since that version's tag (or last deploy commit),
 * and prepends a new version entry to the changelog.
 *
 * Also updates version.json with the new version metadata.
 *
 * Usage:
 *   node scripts/generate-changelog.js [--patch | --minor | --major]
 *
 * Default bump: patch
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ─── Paths ──────────────────────────────────────────────────────────────────
const ROOT = path.resolve(__dirname, '..');
const CHANGELOG_PATH = path.join(ROOT, 'CHANGELOG.md');
const VERSION_JSON_PATH = path.join(ROOT, 'version.json');
const PKG_PATH = path.join(ROOT, 'package.json');

// ─── Helpers ────────────────────────────────────────────────────────────────

function exec(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf-8' }).trim();
}

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

function bumpVersion(current, type) {
  const parts = current.split('.').map(Number);
  switch (type) {
    case 'major':
      return `${parts[0] + 1}.0.0`;
    case 'minor':
      return `${parts[0]}.${parts[1] + 1}.0`;
    case 'patch':
    default:
      return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
  }
}

function getDate() {
  const d = new Date();
  return d.toISOString().split('T')[0]; // YYYY-MM-DD
}

function getShortHash() {
  return exec('git rev-parse --short HEAD');
}

function categorizeCommit(message) {
  const lower = message.toLowerCase();
  if (lower.startsWith('feat:') || lower.startsWith('feat(')) return 'features';
  if (lower.startsWith('fix:') || lower.startsWith('fix(')) return 'fixes';
  if (lower.startsWith('refactor:') || lower.startsWith('refactor(')) return 'refactors';
  if (lower.startsWith('style:') || lower.startsWith('style(')) return 'style';
  if (lower.startsWith('chore:') || lower.startsWith('chore(')) return 'chores';
  if (lower.startsWith('perf:') || lower.startsWith('perf(')) return 'performance';
  if (lower.startsWith('docs:') || lower.startsWith('docs(')) return 'docs';
  if (lower.startsWith('test:') || lower.startsWith('test(')) return 'tests';
  return 'other';
}

function cleanMessage(message) {
  // Remove conventional commit prefix
  return message.replace(/^(feat|fix|refactor|style|chore|perf|docs|test)(\([^)]*\))?:\s*/i, '').trim();
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main() {
  // Parse bump type from args
  const args = process.argv.slice(2);
  let bumpType = 'patch';
  if (args.includes('--major')) bumpType = 'major';
  else if (args.includes('--minor')) bumpType = 'minor';
  else if (args.includes('--patch')) bumpType = 'patch';

  // Read current version
  const versionData = readJSON(VERSION_JSON_PATH);
  const currentVersion = versionData.version;
  const newVersion = bumpVersion(currentVersion, bumpType);
  const date = getDate();
  const commitHash = getShortHash();

  console.log(`\n📦 Bumping version: ${currentVersion} → ${newVersion} (${bumpType})`);
  console.log(`📅 Date: ${date}`);
  console.log(`🔗 Commit: ${commitHash}\n`);

  // Find commits since last version tag, or since the commit hash in version.json
  let commitRange = '';
  const lastTag = versionData.commitHash;

  // Try to use the last recorded commit hash to find new commits
  try {
    // Get full hash from short hash
    const fullHash = exec(`git rev-parse ${lastTag}`);
    commitRange = `${fullHash}..HEAD`;
  } catch {
    // If we can't find the commit, get all commits
    console.log('⚠️  Could not find last deploy commit, including all recent commits');
    commitRange = 'HEAD~10..HEAD'; // last 10 commits as fallback
  }

  // Get commits
  let rawCommits;
  try {
    rawCommits = exec(`git log ${commitRange} --format="%s" --no-merges`);
  } catch {
    rawCommits = '';
  }

  if (!rawCommits) {
    console.log('ℹ️  No new commits found since last version. Skipping changelog update.');
    console.log('   To force a deploy without new changes, bump version manually in version.json.');
    return;
  }

  const commits = rawCommits.split('\n').filter(Boolean);

  // Categorize commits
  const categories = {
    features: [],
    fixes: [],
    refactors: [],
    performance: [],
    style: [],
    chores: [],
    docs: [],
    tests: [],
    other: [],
  };

  commits.forEach((msg) => {
    const cat = categorizeCommit(msg);
    categories[cat].push(cleanMessage(msg));
  });

  // Build new changelog entry
  const sections = [];

  if (categories.features.length) {
    sections.push('### ✨ Features');
    categories.features.forEach((f) => sections.push(`- ${f}`));
    sections.push('');
  }
  if (categories.fixes.length) {
    sections.push('### 🐛 Fixes');
    categories.fixes.forEach((f) => sections.push(`- ${f}`));
    sections.push('');
  }
  if (categories.refactors.length) {
    sections.push('### 🔧 Refactors');
    categories.refactors.forEach((f) => sections.push(`- ${f}`));
    sections.push('');
  }
  if (categories.performance.length) {
    sections.push('### ⚡ Performance');
    categories.performance.forEach((f) => sections.push(`- ${f}`));
    sections.push('');
  }
  if (categories.style.length) {
    sections.push('### 💅 Style');
    categories.style.forEach((f) => sections.push(`- ${f}`));
    sections.push('');
  }
  if (categories.chores.length) {
    sections.push('### 📦 Chores');
    categories.chores.forEach((f) => sections.push(`- ${f}`));
    sections.push('');
  }
  if (categories.docs.length) {
    sections.push('### 📚 Docs');
    categories.docs.forEach((f) => sections.push(`- ${f}`));
    sections.push('');
  }
  if (categories.other.length) {
    sections.push('### 📝 Other');
    categories.other.forEach((f) => sections.push(`- ${f}`));
    sections.push('');
  }

  const newEntry = [
    `## [${newVersion}] — ${date}`,
    '',
    ...sections,
    '---',
    '',
  ].join('\n');

  // Read existing changelog
  let changelog = '';
  if (fs.existsSync(CHANGELOG_PATH)) {
    changelog = fs.readFileSync(CHANGELOG_PATH, 'utf-8');
  }

  // Insert new entry after the header section (after the first ---)
  const headerEndIdx = changelog.indexOf('\n---\n');
  if (headerEndIdx !== -1) {
    const header = changelog.substring(0, headerEndIdx + 5); // include the ---\n
    const rest = changelog.substring(headerEndIdx + 5);
    changelog = header + '\n' + newEntry + rest;
  } else {
    // No header found, prepend
    changelog = newEntry + '\n' + changelog;
  }

  // Write updated changelog
  fs.writeFileSync(CHANGELOG_PATH, changelog);
  console.log(`✅ Updated CHANGELOG.md with v${newVersion}`);

  // Update version.json
  const featureList = categories.features.length
    ? categories.features
    : ['Maintenance and stability improvements'];

  writeJSON(VERSION_JSON_PATH, {
    version: newVersion,
    buildDate: date,
    commitHash: commitHash,
    environment: 'production',
    features: featureList,
  });
  console.log(`✅ Updated version.json`);

  // Update package.json version
  const pkg = readJSON(PKG_PATH);
  pkg.version = newVersion;
  writeJSON(PKG_PATH, pkg);
  console.log(`✅ Updated package.json version`);

  // Create git tag
  try {
    exec(`git add CHANGELOG.md version.json package.json`);
    exec(`git commit -m "chore(release): v${newVersion}"`);
    exec(`git tag v${newVersion}`);
    console.log(`\n🏷️  Tagged as v${newVersion}`);
  } catch (e) {
    console.log(`\n⚠️  Could not auto-commit/tag: ${e.message}`);
    console.log('   You may need to commit and tag manually.');
  }

  console.log(`\n🚀 Ready to deploy v${newVersion}!\n`);
}

main();
