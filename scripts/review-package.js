const { execSync } = require('child_process');
const base = process.argv[2];
const head = process.argv[3];
const packagePath = `.superpowers/sdd/review-package-${head.slice(0,7)}.md`;
const log = execSync(`git log --oneline ${base}..${head}`).toString();
const stat = execSync(`git diff --stat ${base}..${head}`).toString();
const diff = execSync(`git diff -U10 ${base}..${head}`).toString();
fs.writeFileSync(packagePath, `${log}\n\n${stat}\n\n${diff}`);
console.log(packagePath);
