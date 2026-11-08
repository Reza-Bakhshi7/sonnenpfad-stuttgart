import fs from 'node:fs';

const requiredFiles = [
  'README.md',
  'GOVERNANCE.md',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'CHANGELOG.md',
  '.github/CODEOWNERS',
  '.github/pull_request_template.md',
  '.github/workflows/ci.yml',
  'docs/access-and-secrets.md',
  'docs/architecture.md',
  'docs/operations-runbook.md',
  'docs/release-process.md',
  'docs/roadmap.md',
  'docs/adr/0001-cloudflare-browser-first.md',
];

for (const file of requiredFiles) {
  if (!fs.existsSync(file)) throw new Error(`Required project file is missing: ${file}`);
}

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
if (pkg.version !== '0.16.1') throw new Error(`Expected release baseline 0.16.1, found ${pkg.version}`);

const wrangler = fs.readFileSync('wrangler.jsonc', 'utf8');
if (!wrangler.includes('sonnenpfad-stuttgart')) throw new Error('Unexpected Cloudflare project configuration.');

const readme = fs.readFileSync('README.md', 'utf8');
if (!readme.includes('sonnenpfad-stuttgart.mohammadreza-bakhshi.workers.dev')) {
  throw new Error('Production URL is not documented.');
}

console.log('Governance baseline verification passed');


