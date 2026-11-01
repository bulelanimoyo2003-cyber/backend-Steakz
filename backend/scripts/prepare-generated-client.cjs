const fs = require('node:fs');
const path = require('node:path');

const clientPackage = path.resolve('dist/generated/prisma/package.json');
fs.writeFileSync(clientPackage, JSON.stringify({ type: 'commonjs' }));
