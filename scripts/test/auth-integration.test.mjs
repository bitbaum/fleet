import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkAuthIntegration } from './auth-integration.mjs';
test('product checks are optional, bounded, and propagate actual failures', async () => {
  const dir=mkdtempSync(join(tmpdir(),'auth-integration-'));
  const other=mkdtempSync(join(tmpdir(),'auth-integration-outside-'));
  try {
    await checkAuthIntegration('',{},dir);
    writeFileSync(join(dir,'valid.mjs'),'export async function run(context) { context.ran = true; }');
    const context={};await checkAuthIntegration('valid.mjs',context,dir);assert.equal(context.ran,true);
    writeFileSync(join(dir,'broken.mjs'),'export async function run() { throw new Error("regression"); }');
    await assert.rejects(checkAuthIntegration('broken.mjs',{},dir),/regression/);
    writeFileSync(join(dir,'no-export.mjs'),'export const other = true;');
    await assert.rejects(checkAuthIntegration('no-export.mjs',{},dir),/export run/);
    writeFileSync(join(other,'outside.mjs'),'export async function run() {}');
    symlinkSync(join(other,'outside.mjs'),join(dir,'escape.mjs'));
    await assert.rejects(checkAuthIntegration('escape.mjs',{},dir),/within this product/);
    await assert.rejects(checkAuthIntegration(join(other,'outside.mjs'),{},dir),/within this product/);
    await assert.rejects(checkAuthIntegration('absent.mjs',{},dir),/ENOENT/);
  } finally {rmSync(dir,{recursive:true,force:true});rmSync(other,{recursive:true,force:true});}
});
