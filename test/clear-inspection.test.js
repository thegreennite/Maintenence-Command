import test from 'node:test';
import assert from 'node:assert/strict';
import { handleInspectionSave } from '../worker/inspections.js';

test('clear all is scoped to the current draft and preserves storage objects', async () => {
  let statements;
  const stop = new Error('stop after inspecting batch');
  const env = { DB: {
    prepare(sql) { return { sql, bind(...params) { this.params = params; return this; }, async first() {
      return sql.includes('FROM buildings') ? {status:'active'} : {id:17,status:'draft'};
    } }; },
    async batch(items) { statements = items; throw stop; },
  }};
  await assert.rejects(handleInspectionSave(new Request('https://test/save', {method:'POST',body:JSON.stringify({clearAll:true})}), {building_id:4,id:8}, env, {}), error => error === stop);
  assert.equal(statements.length,5);
  for (const s of statements.slice(0,4)) assert.deepEqual(s.params,[17]);
  assert.equal(statements[4].params[0],4);
  assert.match(statements[4].params[1], /^\d{4}-\d{2}-\d{2}$/);
  assert.match(statements[4].sql, /date = \?/);
  assert.match(statements[4].sql, /context = 'inspection'/);
});

test('submitted inspections cannot be cleared', async () => {
  const env = { DB: {
    prepare(sql) { return { bind() { return this; }, async first() {
      return sql.includes('FROM buildings') ? {status:'active'} : {id:17,status:'submitted'};
    } }; },
    async batch() { assert.fail('must not mutate a submitted inspection'); },
  }};
  const response = await handleInspectionSave(new Request('https://test/save', {method:'POST',body:JSON.stringify({clearAll:true})}), {building_id:4,id:8}, env, {});
  assert.equal(response.status,409);
});
