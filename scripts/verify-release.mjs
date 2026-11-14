import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT_DIR = path.resolve(__dirname, '..');

/**
 * Parses and validates a git release tag (e.g. "v4.0.3") into an extension manifest version string.
 */
export function parseReleaseTag(rawTag) {
  const tag = String(rawTag ?? '').trim();
  const match = /^v(\d+\.\d+\.\d+(?:\.\d+)?)$/.exec(tag);
  if (!match) {
    throw new Error(
      `Invalid release tag "${tag}". Expected format "vX.Y.Z" (or "vX.Y.Z.W") with numeric segments matching Chrome/Firefox manifest.json.`
    );
  }
  return { tag, version: match[1] };
}

/**
 * Verifies that both apps/extension/src/manifest.json and apps/extension/package.json
 * match the release tag version.
 */
export function verifyExtensionVersions(expectedVersion, rootDir = DEFAULT_ROOT_DIR) {
  const manifestPath = path.join(rootDir, 'apps', 'extension', 'src', 'manifest.json');
  const packageJsonPath = path.join(rootDir, 'apps', 'extension', 'package.json');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

  const errors = [];
  if (manifest.version !== expectedVersion) {
    errors.push(`apps/extension/src/manifest.json has version "${manifest.version}", expected "${expectedVersion}"`);
  }
  if (pkg.version !== expectedVersion) {
    errors.push(`apps/extension/package.json has version "${pkg.version}", expected "${expectedVersion}"`);
  }

  if (errors.length > 0) {
    throw new Error(`Version verification failed:\n - ${errors.join('\n - ')}`);
  }

  return {
    manifestVersion: manifest.version,
    packageVersion: pkg.version,
  };
}

/**
 * Extracts the markdown body for `## [<version>]` from CHANGELOG.md.
 * Falls back to `## [Unreleased]` if a dedicated version section is not yet cut.
 */
export function extractChangelogSection(changelogText, version) {
  const lines = String(changelogText ?? '').split(/\r?\n/);

  const readSection = (headerPrefix) => {
    const startIdx = lines.findIndex((line) => line.trim().startsWith(headerPrefix));
    if (startIdx === -1) return '';

    const collected = [];
    for (let i = startIdx + 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (/^##\s+/.test(line)) break;
      // Stop before horizontal separator right before next section
      if (line.trim() === '---' && i + 1 < lines.length && /^##\s+/.test(lines[i + 1])) {
        break;
      }
      collected.push(line);
    }

    return collected.join('\n').trim();
  };

  const versionNotes = readSection(`## [${version}]`);
  if (versionNotes) {
    return { markdown: versionNotes, source: 'version' };
  }

  const unreleasedNotes = readSection('## [Unreleased]');
  if (unreleasedNotes) {
    return { markdown: unreleasedNotes, source: 'unreleased' };
  }

  return {
    markdown: `Release v${version}. See CHANGELOG.md for details.`,
    source: 'fallback',
  };
}

function parseCliArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--tag' && i + 1 < argv.length) {
      args.tag = argv[++i];
    } else if (token === '--output' && i + 1 < argv.length) {
      args.output = argv[++i];
    } else if (token === '--root' && i + 1 < argv.length) {
      args.root = argv[++i];
    }
  }
  return args;
}

function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const rawTag = args.tag || process.env.GITHUB_REF_NAME;
  const rootDir = args.root ? path.resolve(args.root) : DEFAULT_ROOT_DIR;

  const { tag, version } = parseReleaseTag(rawTag);
  verifyExtensionVersions(version, rootDir);
  console.log(`[OK] Verified tag "${tag}" matches manifest.json and package.json (v${version}).`);

  const changelogPath = path.join(rootDir, 'CHANGELOG.md');
  const changelogText = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, 'utf-8') : '';
  const { markdown, source } = extractChangelogSection(changelogText, version);

  if (source === 'unreleased') {
    console.warn(
      `::warning::Section "## [${version}]" was not found in CHANGELOG.md; falling back to "## [Unreleased]" for release notes.`
    );
  } else if (source === 'fallback') {
    console.warn(
      `::warning::Neither "## [${version}]" nor "## [Unreleased]" had entries in CHANGELOG.md; using default release summary.`
    );
  } else {
    console.log(`[OK] Extracted release notes from CHANGELOG.md section "## [${version}]".`);
  }

  if (args.output) {
    const outputPath = path.resolve(args.output);
    fs.writeFileSync(outputPath, `${markdown}\n`, 'utf-8');
    console.log(`[OK] Wrote release notes to ${outputPath}`);
  }

  const githubOutputPath = process.env.GITHUB_OUTPUT;
  if (githubOutputPath) {
    fs.appendFileSync(githubOutputPath, `tag=${tag}\nversion=${version}\nnotes_source=${source}\n`, 'utf-8');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    console.error(`[ERROR] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

