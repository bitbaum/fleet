import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currencyToolchain } from './currency-toolchain.mjs';
const choose = (bumps, files) => currencyToolchain(bumps.map(path => ({path})), path => path in files, path => files[path]);
test('Fleet starter uses its own declaration without a root package.json', () => {
  assert.deepEqual(choose(['templates/app/package.json'], {'templates/app/package.json': {packageManager: 'pnpm@11.25.0'},'templates/app/pnpm-lock.yaml': {}}), {needed:true,manifest:'templates/app/package.json'});
});
test('nested workspace uses the declared root toolchain', () => {
  assert.deepEqual(choose(['apps/web/package.json'], {'package.json': {packageManager:'pnpm@11.25.0'},'pnpm-lock.yaml':{},'apps/web/package.json':{}}), {needed:true,manifest:'package.json'});
});
test('npm projects require no pnpm setup', () => {
  assert.deepEqual(choose(['frontend/package.json'], {'frontend/package.json':{},'frontend/package-lock.json':{}}), {needed:false,manifest:''});
});
test('missing declarations and locks fail instead of inventing a version', () => {
  assert.throws(() => choose(['package.json'], {'package.json':{},'pnpm-lock.yaml':{}}), /No declared pnpm/);
  assert.throws(() => choose(['app/package.json'], {'app/package.json':{}}), /No supported lockfile/);
});
test('mixed independent projects still select an actual pnpm declaration', () => {
  assert.deepEqual(choose(['api/package.json','web/package.json'], {'api/package-lock.json':{},'api/package.json':{},'web/package.json':{packageManager:'pnpm@11.25.0'},'web/pnpm-lock.yaml':{}}), {needed:true,manifest:'web/package.json'});
});
