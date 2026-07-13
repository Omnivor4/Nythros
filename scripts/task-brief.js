const fs = require('fs');
const planFile = process.argv[2];
const taskNum = process.argv[3];
const plan = fs.readFileSync(planFile, 'utf8');
const tasks = plan.split('### Task');
const task = tasks[taskNum];
const briefPath = `.superpowers/sdd/task-${taskNum}-brief.md`;
fs.writeFileSync(briefPath, `### Task${task}`);
console.log(briefPath);
