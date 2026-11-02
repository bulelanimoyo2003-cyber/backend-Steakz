const fs = require('node:fs');
const path = require('node:path');

const sourceDir = path.resolve('src/generated/prisma');
const targetDir = path.resolve('dist/generated/prisma');

fs.mkdirSync(targetDir, { recursive: true });

// Preserve CommonJS compatibility for the generated Prisma client.
fs.writeFileSync(
  path.join(targetDir, 'package.json'),
  JSON.stringify({ type: 'commonjs' })
);

// Copy Prisma's native query engine into the compiled output.
for (const file of fs.readdirSync(sourceDir)) {
  if (file.startsWith('libquery_engine-') && file.endsWith('.so.node')) {
    fs.copyFileSync(
      path.join(sourceDir, file),
      path.join(targetDir, file)
    );
    console.log(`[Prisma] Copied ${file}`);
  }
}
