const fs = require('fs');
const path = require('path');
const swPath = path.join(__dirname, 'src', 'sw.js');
let content = fs.readFileSync(swPath, 'utf8');
const newVersion = 'cashpad-' + Date.now().toString(36);
content = content.replace(/cashpad-[a-z0-9]+/, newVersion);
fs.writeFileSync(swPath, content);
console.log('SW cache bumped to:', newVersion);
