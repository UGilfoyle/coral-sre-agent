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

function main() {
  console.log('=== Coral SRE Agent: portable source setup ===');

  const { dataDirUri, outDir, generated } = generateCoralSourceSpecs();

  console.log(`Project root: ${projectRoot}`);
  console.log(`Data URI: ${dataDirUri}`);
  console.log(`Generated specs: ${outDir}`);

  try {
    execSync('coral --version', { stdio: 'ignore' });
  } catch {
    console.error(
      '❌ Coral CLI not found. Install: brew install withcoral/tap/coral'
    );
    process.exit(1);
  }

  for (const { file, outPath } of generated) {
    try {
      console.log(`Registering ${file}...`);
      execSync(`coral source add --file "${outPath}"`, { stdio: 'inherit' });
    } catch (err) {
      console.error(`❌ Failed to register ${file}:`, err.message);
    }
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
