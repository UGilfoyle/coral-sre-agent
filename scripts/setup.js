import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');

/** Placeholder in committed coral-sources/*.yaml — replaced at setup time only. */
export const CORAL_DATA_URI_PLACEHOLDER = '__CORAL_DATA_URI__';

/**
 * Resolve a file:// URI for the JSONL data directory.
 * Override with CORAL_DATA_DIR (absolute path) for custom layouts.
 */
export function resolveCoralDataUri(root = projectRoot) {
  const dataDir = process.env.CORAL_DATA_DIR
    ? path.resolve(process.env.CORAL_DATA_DIR)
    : path.join(root, 'src', 'backend', 'data');

  const raw = dataDir.replace(/\\/g, '/');
  return raw.startsWith('/') ? `file://${raw}/` : `file:///${raw}/`;
}

/**
 * Read template YAML from coral-sources/ and write resolved specs to .coral-generated/.
 * Committed templates are never modified.
 */
export function generateCoralSourceSpecs(root = projectRoot) {
  const sourcesDir = path.join(root, 'coral-sources');
  const outDir = path.join(root, '.coral-generated');
  const dataDirUri = resolveCoralDataUri(root);

  if (!fs.existsSync(sourcesDir)) {
    throw new Error(`coral-sources directory not found: ${sourcesDir}`);
  }

  fs.mkdirSync(outDir, { recursive: true });

  const yamlFiles = fs
    .readdirSync(sourcesDir)
    .filter((f) => f.endsWith('.yaml'));

  const generated = [];

  for (const file of yamlFiles) {
    const templatePath = path.join(sourcesDir, file);
    let content = fs.readFileSync(templatePath, 'utf-8');

    if (!content.includes(CORAL_DATA_URI_PLACEHOLDER)) {
      console.warn(
        `⚠ ${file}: missing placeholder ${CORAL_DATA_URI_PLACEHOLDER}; skipping generation`
      );
      continue;
    }

    content = content.replaceAll(
      `"${CORAL_DATA_URI_PLACEHOLDER}"`,
      `"${dataDirUri}"`
    );

    const outPath = path.join(outDir, file);
    fs.writeFileSync(outPath, content, 'utf-8');
    generated.push({ file, outPath });
  }

  return { dataDirUri, outDir, generated };
}

function sourceNameFromFile(file) {
  return file.replace(/\.yaml$/, '');
}

function ensureCoralPath() {
  const home = process.env.HOME || '';
  const extra = [
    process.env.CORAL_INSTALL_DIR,
    path.join(home, '.local', 'bin'),
    '/root/.local/bin',
    '/usr/local/bin'
  ].filter(Boolean);
  process.env.PATH = [...extra, process.env.PATH || ''].join(':');
}

function hasCoralCli() {
  try {
    execSync('coral --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function main() {
  console.log('=== Coral SRE Agent: portable source setup ===');

  const { dataDirUri, outDir, generated } = generateCoralSourceSpecs();

  console.log(`Project root: ${projectRoot}`);
  console.log(`Data URI: ${dataDirUri}`);
  console.log(`Generated specs: ${outDir}`);

  ensureCoralPath();

  if (!hasCoralCli()) {
    if (process.env.SKIP_CORAL_CLI === 'true') {
      console.warn('⚠ Coral CLI not found — skipping source registration (SKIP_CORAL_CLI=true).');
      console.warn('  Demo will use Neon Postgres when DATABASE_URL is set.');
      return;
    }
    console.error(
      '❌ Coral CLI not found. Install: brew install withcoral/tap/coral'
    );
    process.exit(1);
  }

  let failed = false;

  for (const { file, outPath } of generated) {
    const name = sourceNameFromFile(file);
    try {
      console.log(`\nLinting ${file}...`);
      execSync(`coral source lint "${outPath}"`, { stdio: 'inherit' });

      console.log(`Registering ${file}...`);
      execSync(`coral source add --file "${outPath}"`, { stdio: 'inherit' });

      console.log(`Testing ${name}...`);
      execSync(`coral source test ${name}`, { stdio: 'inherit' });
    } catch (err) {
      failed = true;
      console.error(`❌ Setup failed for ${file}:`, err.message);
    }
  }

  if (failed) {
    console.error('\n❌ One or more Coral sources failed lint, install, or test.');
    process.exit(1);
  }

  console.log('\n=== Setup complete ===');
  console.log("Run 'pnpm run dev' to start the application.");
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  main();
}
