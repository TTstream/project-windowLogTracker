for (const name of ['electron/main', 'node:electron', 'node:electron/main']) {
  try {
    const mod = require(name);
    console.log(name, 'ok', typeof mod, mod && typeof mod === 'object' ? Object.keys(mod).slice(0,10) : mod);
  } catch (error) {
    console.log(name, 'fail', error.message);
  }
}
