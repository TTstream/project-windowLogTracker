const Module = require('module');
console.log(Module.builtinModules.filter((name) => name.includes('electron')));
