/**
 * Builds a sideloadable .vsix without pulling in vsce.
 *
 * A vsix is a plain zip: `extension/` holds the files listed by
 * `.vscodeignore`, plus the two required manifests at the root.
 *
 * Usage: node scripts/package.mjs
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZip } from './zip.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

const ALWAYS_SKIP = new Set([
  '.git',
  '.github',
  '.vscode',
  '.vscode-test',
  '.npm-cache',
  '.npm-tmp',
  '.npm-logs',
  'node_modules',
  'src',
  'scripts',
  'fixtures',
  '.vsix-staging',
  'tsconfig.json',
  'esbuild.mjs',
  '.gitignore',
  '.npmrc',
  '.vscodeignore',
]);

function readIgnorePatterns() {
  const file = path.join(root, '.vscodeignore');
  if (!existsSync(file)) {
    return [];
  }
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function globToRegExp(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function collectFiles(patterns) {
  // `git ls-files` would be ideal, but this workspace is not necessarily a repo,
  // so enumerate with find and filter afterwards.
  const listed = execFileSync('find', ['.', '-type', 'f', '-not', '-path', './.git/*'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\n')
    .map((line) => line.replace(/^\.\//, '').trim())
    .filter(Boolean);

  const matchers = patterns.map(globToRegExp);
  return listed.filter((file) => {
    if (ALWAYS_SKIP.has(file) || file.endsWith('.vsix') || file.endsWith('.map')) {
      return false;
    }
    if (
      file.startsWith('node_modules/') ||
      file.startsWith('.npm-cache/') ||
      file.startsWith('src/') ||
      file.startsWith('scripts/') ||
      file.startsWith('fixtures/') ||
      file.startsWith('.vsix-staging/') ||
      file.endsWith('.ts')
    ) {
      return false;
    }
    return !matchers.some((matcher) => matcher.test(file));
  });
}

function contentTypesXml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="js" ContentType="application/javascript" />
  <Default Extension="mjs" ContentType="application/javascript" />
  <Default Extension="css" ContentType="text/css" />
  <Default Extension="html" ContentType="text/html" />
  <Default Extension="png" ContentType="image/png" />
  <Default Extension="pfb" ContentType="application/octet-stream" />
  <Default Extension="ttf" ContentType="application/octet-stream" />
  <Default Extension="md" ContentType="text/markdown" />
  <Default Extension="txt" ContentType="text/plain" />
  <Default Extension="vsixmanifest" ContentType="text/xml" />
</Types>
`;
}

/**
 * Builds the manifest.
 *
 * `GeneratedDate` is deliberately the zip epoch rather than the current time:
 * the .vsix is committed to the repository, and a timestamp that changes on
 * every build would make each packaging run look like a source change.
 */
function vsixManifest(fileCount) {
  const generatedDate = '1980-01-01T00:00:00Z';
  const prop = (id, value) => `<Property Id="${id}" Value="${value}" />`;
  return `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${pkg.name}" Version="${pkg.version}" Publisher="${pkg.publisher}" />
    <DisplayName>${pkg.displayName}</DisplayName>
    <Description xml:space="preserve">${pkg.description}</Description>
    <Tags>${(pkg.keywords ?? []).join(',')}</Tags>
    <Categories>${(pkg.categories ?? []).join(',')}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      ${prop('Microsoft.VisualStudio.Code.Engine', pkg.engines.vscode)}
      ${prop('Microsoft.VisualStudio.Code.ExtensionDependencies', '')}
      ${prop('Microsoft.VisualStudio.Code.ExtensionPack', '')}
      ${prop('Microsoft.VisualStudio.Code.ExtensionKind', 'workspace,ui')}
      ${prop('Microsoft.VisualStudio.Services.Links.Source', '')}
      ${prop('Microsoft.VisualStudio.Services.Links.Getstarted', '')}
      ${prop('Microsoft.VisualStudio.Services.GitHubFlavoredMarkdown', 'true')}
    </Properties>
    <License>extension/LICENSE.txt</License>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE.txt" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/media/icon.png" Addressable="true" />
  </Assets>
  <PackageManifestVersion>2.0.0</PackageManifestVersion>
  <GeneratedDate>${generatedDate}</GeneratedDate>
  <PackageSize>0</PackageSize>
  <FileCount>${fileCount}</FileCount>
</packageManifest>`;
}

const patterns = readIgnorePatterns();
const staging = path.join(root, '.vsix-staging');
// Clean before enumerating: a leftover staging directory must never be packaged.
rmSync(staging, { recursive: true, force: true });
mkdirSync(path.join(staging, 'extension'), { recursive: true });

const files = collectFiles(patterns);
for (const required of ['package.json', 'dist/extension.js', 'media/webview/main.js', 'media/activity-icon.svg', 'README.md', 'LICENSE.txt']) {
  if (!files.includes(required)) {
    console.error(`[package] missing required file: ${required}`);
    process.exit(1);
  }
}

for (const file of files) {
  const target = path.join(staging, 'extension', file);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(path.join(root, file), target);
}

writeFileSync(path.join(staging, '[Content_Types].xml'), contentTypesXml());

const outName = `${pkg.name}-${pkg.version}.vsix`;
const outPath = path.join(root, outName);
rmSync(outPath, { force: true });

// Collect every staged file relative to the archive root, then zip it up.
const collectStaged = (directory, prefix = '') => {
  const out = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(directory, entry.name);
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...collectStaged(absolute, relative));
    } else {
      out.push({ name: relative, data: readFileSync(absolute) });
    }
  }
  return out;
};

// The manifest's <PackageSize> is informative only — VS Code does not validate
// it. A single deterministic pass is used instead of measuring the archive,
// because a two-pass build re-orders entries between passes and made the output
// non-reproducible.
writeFileSync(path.join(staging, 'extension.vsixmanifest'), vsixManifest(files.length));
writeFileSync(outPath, createZip(collectStaged(staging)));
rmSync(staging, { recursive: true, force: true });

const bytes = statSync(outPath).size;
const sha = createHash('sha256').update(readFileSync(outPath)).digest('hex').slice(0, 16);
console.log(`[package] ${outName}`);
console.log(`[package] ${files.length} files, ${(bytes / 1024 / 1024).toFixed(2)} MB, sha256:${sha}`);
console.log(`[package] install with: code --install-extension "${outPath}"`);
