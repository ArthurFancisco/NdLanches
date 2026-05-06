const { execSync } = require('child_process');

console.log('Minificando CSS...');
execSync('npx esbuild style.css --minify --outfile=style.min.css');
execSync('npx esbuild styleAdmin.css --minify --outfile=styleAdmin.min.css');

console.log('Minificando JS...');
execSync('npx esbuild app.js --minify --outfile=app.min.js');
execSync('npx esbuild appAdmin.js --minify --outfile=appAdmin.min.js');

console.log('Build concluído! Agora faça commit e deploy.');

// Para rodar este script, use: node build.js