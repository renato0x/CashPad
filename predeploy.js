const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = __dirname;
const srcPath = path.join(root, 'src');
const indexPath = path.join(srcPath, 'index.html');
const integrityScripts = [
  'vendor/firebase-app-compat.js',
  'vendor/firebase-firestore-compat.js'
];

function normalizeLf(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const normalized = content.replace(/\r\n/g, '\n');
  if (content !== normalized) fs.writeFileSync(filePath, normalized, 'utf8');
  return Buffer.from(normalized, 'utf8');
}

function verifySubresourceIntegrity() {
  const index = normalizeLf(indexPath).toString('utf8');

  integrityScripts.forEach((script) => {
    const scriptPath = path.join(srcPath, ...script.split('/'));
    const bytes = normalizeLf(scriptPath);
    const actual = 'sha384-' + crypto.createHash('sha384').update(bytes).digest('base64');
    const escapedScript = script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tag = index.match(new RegExp('<script[^>]+src="' + escapedScript + '"[^>]+integrity="([^"]+)"[^>]*>'));

    if (!tag) throw new Error('SRI ausente para ' + script);
    if (tag[1] !== actual) {
      throw new Error('SRI invalido para ' + script + ': esperado ' + actual + ', encontrado ' + tag[1]);
    }
  });

  console.log('SRI validado para:', integrityScripts.join(', '));
}

verifySubresourceIntegrity();

const swPath = path.join(__dirname, 'src', 'sw.js');
let content = fs.readFileSync(swPath, 'utf8');
const newVersion = 'cashpad-' + Date.now().toString(36);
content = content.replace(/cashpad-[a-z0-9]+/, newVersion);
fs.writeFileSync(swPath, content);
console.log('SW cache bumped to:', newVersion);
