const fs = require('fs');
const path = require('path');
const swPath = path.join(__dirname, 'src', 'sw.js');
let content = fs.readFileSync(swPath, 'utf8');
const newVersion = 'divideai-' + Date.now().toString(36);
content = content.replace(/divideai-[a-z0-9]+/, newVersion);
fs.writeFileSync(swPath, content);
console.log('SW cache bumped to:', newVersion);
