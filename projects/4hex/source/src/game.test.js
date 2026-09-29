import test from 'node:test';
import assert from 'node:assert/strict';
import {fullRoute,findPath,start,end,pads,key,recipeFor,rollQuality,chances} from './data.js';
test('route visits every checkpoint in order and reaches the exit',()=>{const route=fullRoute(new Set());assert.deepEqual(route[0],start);assert.deepEqual(route.at(-1),end);let cursor=0;for(const pad of pads){const i=route.findIndex((p,j)=>j>=cursor&&key(...p)===key(...pad));assert.ok(i>=cursor);cursor=i;}});
test('sealed checkpoint rejects placement',()=>{let blocked=new Set();for(let c=0;c<19;c++)blocked.add(key(c,7));assert.equal(fullRoute(blocked),null);});
test('first hand can form Malachite with any ingredient as anchor',()=>{let towers=['Opal','Emerald','Aquamarine','Ruby','Sapphire'].map(type=>({type,q:0}));for(let t of towers.slice(0,3))assert.equal(recipeFor('Malachite',towers,t).length,3);assert.equal(recipeFor('Malachite',towers,towers[3]),null);});
test('recipes require exact qualities and separate ingredients',()=>{assert.equal(recipeFor('Gold',[{type:'Amethyst',q:4},{type:'Diamond',q:1}]),null);});
test('quality probabilities match provided distribution',()=>{for(let level=0;level<9;level++){const counts=[0,0,0,0,0];for(let i=0;i<100;i++)counts[rollQuality(level,(i+.5)/100)]++;assert.deepEqual(counts,chances[level]);}});
