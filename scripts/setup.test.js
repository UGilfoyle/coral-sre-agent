import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  CORAL_DATA_URI_PLACEHOLDER,
  generateCoralSourceSpecs,
  resolveCoralDataUri
} from './setup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

test('resolveCoralDataUri uses project data dir by default', () => {
  const uri = resolveCoralDataUri(projectRoot);
  assert.match(uri, /^file:\/\//);
  assert.ok(uri.endsWith('/src/backend/data/'));
});

test('generateCoralSourceSpecs writes resolved specs without mutating templates', () => {
  const githubTemplate = path.join(projectRoot, 'coral-sources', 'github.yaml');
  const before = fs.readFileSync(githubTemplate, 'utf-8');

  const tmpRoot = fs.mkdtempSync(path.join(projectRoot, '.tmp-setup-test-'));
  try {
    fs.cpSync(path.join(projectRoot, 'coral-sources'), path.join(tmpRoot, 'coral-sources'), {
      recursive: true
    });

    const { generated, dataDirUri } = generateCoralSourceSpecs(tmpRoot);
    assert.ok(generated.length > 0);

    const generatedGithub = fs.readFileSync(
      path.join(tmpRoot, '.coral-generated', 'github.yaml'),
      'utf-8'
    );
    assert.ok(!generatedGithub.includes(CORAL_DATA_URI_PLACEHOLDER));
    assert.ok(generatedGithub.includes(dataDirUri));

    const templateAfter = fs.readFileSync(
      path.join(tmpRoot, 'coral-sources', 'github.yaml'),
      'utf-8'
    );
    assert.equal(templateAfter, before);
    assert.ok(templateAfter.includes(CORAL_DATA_URI_PLACEHOLDER));
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  assert.equal(fs.readFileSync(githubTemplate, 'utf-8'), before);
});
