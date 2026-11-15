import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateBridgeGeometry} from '../models/bridge-assets.js';

const read = name => readFileSync(new URL('../models/'+name, import.meta.url));
const current = JSON.parse(read('waibaidu-r3.json'));

test('public JSON, registration mesh, and download use the same release', () => {
  assert.deepEqual(JSON.parse(read('waibaidu.json')), current);
  assert.equal(validateBridgeGeometry(current, 'waibaidu').revision, 3);
  const glb = read('waibaidu.glb');
  const document = JSON.parse(glb.subarray(20,20+glb.readUInt32LE(12)).toString());
  assert.equal(document.asset.extras.revision, current.revision);
  for (const revision of [1,2]) {
    const historical = JSON.parse(read('waibaidu-v'+revision+'.json'));
    assert.throws(() => validateBridgeGeometry(historical, 'waibaidu'));
    assert.equal(validateBridgeGeometry(historical, 'waibaidu', revision), historical);
  }
});

test('both lateral trusses follow the diagonal layout on the 1977 elevation', () => {
  const members = new Set(current.members.map(({a,b})=>[a,b].sort().join('/')));
  for (const side of ['N','F']) {
    for (const start of [0,11]) {
      for (let panel=0;panel<11;panel++) {
        const a=side+(start+panel), b=side+(start+panel+1);
        const rising=members.has([a+'-B',b+'-U'].sort().join('/'));
        const falling=members.has([a+'-U',b+'-B'].sort().join('/'));
        assert.deepEqual([rising,falling], [
          panel!==1 && panel!==10, panel!==0 && panel!==9
        ], side+' span '+start+' panel '+panel);
      }
    }
  }
});
