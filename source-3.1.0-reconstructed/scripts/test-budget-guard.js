'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = {window: {}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'generation', 'budget-guard.js'), 'utf8'), sandbox, {filename: 'budget-guard.js'});
const guard = sandbox.window.FutureAIBudgetGuard;

const ledger = [
  {projectId: 'p1', day: '2026-08-09', currency: 'USD', estimatedAmount: 3, actualRequests: 1},
  {projectId: 'p1', day: '2026-08-08', currency: 'USD', estimatedAmount: 7, actualRequests: 2},
  {projectId: 'p2', day: '2026-08-09', currency: 'USD', estimatedAmount: 9, actualRequests: 1}
];

const decision = guard.evaluateBudget({
  estimates: [{currency: 'USD', amount: 4}],
  currency: 'USD', singleLimit: 3, dailyLimit: 6, projectLimit: 10,
  projectId: 'p1', day: '2026-08-09', ledger
});
assert.equal(decision.allowed, false);
assert.deepEqual(Array.from(decision.exceededScopes), ['single', 'daily', 'project']);
assert.equal(decision.usage.daily, 12);
assert.equal(decision.usage.project, 10);

const mismatch = guard.evaluateBudget({
  estimates: [{currency: 'CNY', amount: 1}], currency: 'USD', singleLimit: 5,
  projectId: 'p1', day: '2026-08-09', ledger
});
assert.equal(mismatch.allowed, false);
assert.equal(mismatch.currencyMismatch, true);

const unlimited = guard.evaluateBudget({
  estimates: [{currency: 'USD', amount: 1000}], currency: 'USD',
  singleLimit: 0, dailyLimit: 0, projectLimit: 0,
  projectId: 'p1', day: '2026-08-09', ledger
});
assert.equal(unlimited.allowed, true);

const ranged = guard.evaluateBudget({
  estimates: [{currency: 'USD', amount: 2, minAmount: 1.5, maxAmount: 4.5}],
  currency: 'USD', singleLimit: 4,
  projectId: 'p1', day: '2026-08-09', ledger: []
});
assert.equal(ranged.estimate, 4.5);
assert.equal(ranged.allowed, false);

const added = guard.recordEstimate(ledger, {
  id: 'b1', projectId: 'p1', day: '2026-08-09', currency: 'USD', estimatedAmount: 2, estimatedMinAmount: 1.5, estimatedMaxAmount: 2.5, kind: 'image', model: 'test'
});
assert.equal(added.length, 4);
assert.equal(added[3].status, 'submitted');
assert.equal(added[3].estimatedMinAmount, 1.5);
assert.equal(added[3].estimatedMaxAmount, 2.5);
const completed = guard.completeEntry(added, 'b1', {actualRequests: 2, actualAmount: 3.5, status: 'failed', differenceReason: 'fallback'});
assert.equal(completed[3].actualRequests, 2);
assert.equal(completed[3].differenceReason, 'fallback');
assert.equal(completed[3].actualAmount, 3.5);
assert.equal(completed[3].differenceAmount, 1.5);
assert.equal(guard.routeSuggestions([
  {modelId: 'cheap', price: 1, latencyMs: 5000, quality: 70},
  {modelId: 'fast', price: 4, latencyMs: 500, quality: 80}
], 'price')[0].modelId, 'cheap');

console.log('Budget guard tests passed.');
