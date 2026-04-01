console.log('process.versions.electron=', process.versions.electron);
const electron = require('electron');
console.log('electron type=', typeof electron);
console.log('electron keys=', electron && typeof electron === 'object' ? Object.keys(electron).slice(0,20) : electron);
