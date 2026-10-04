const assert = require('node:assert/strict');
const adapter = require('../candidate-app/js/categoryPersistenceAdapter.js');
assert.equal(typeof adapter.loadMaster, 'function');
assert.equal(typeof adapter.saveCategory, 'function');
assert.equal(typeof adapter.replaceMaster, 'function');
assert.equal(typeof adapter.saveClubMetadata, 'function');
assert.equal(typeof adapter.diffMasterAgainstBaseline, 'function');
console.log('PASS: candidate category adapter exports required persistence operations');
