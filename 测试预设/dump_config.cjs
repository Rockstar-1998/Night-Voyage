const { execSync } = require('child_process');
const output = execSync('git show HEAD~3:"测试预设/Night Voyage 默认预设.nvpreset.json"');
const data = JSON.parse(output.toString('utf8'));
const startNode = data.preset.blueprintGraph.nodes.find(n => n.type === 'start');
const endNode = data.preset.blueprintGraph.nodes.find(n => n.type === 'end');
console.log('Start config:', startNode.config);
console.log('End config:', endNode.config);
