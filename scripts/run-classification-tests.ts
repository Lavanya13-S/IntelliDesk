/**
 * scripts/run-classification-tests.ts
 * 
 * Run the classification test suite locally and report all failures.
 * Usage: npx tsx scripts/run-classification-tests.ts
 */

import { CLASSIFICATION_TEST_CASES } from '../lib/ai/classification-test-cases';
import { classifyByTaxonomy } from '../lib/ai/classification-engine';

interface TestResult {
  id: string;
  subject: string;
  body: string;
  expected: {
    intent: string;
    department: string;
    subteam: string;
    priority: string;
    riskLevel: string;
    decision: string;
  };
  actual: {
    intent: string;
    department: string;
    subteam: string;
    priority: string;
    riskLevel: string;
    decision: string;
    confidence: number;
    reasoning: string;
  };
  passed: boolean;
  failures: string[];
}

function runTest(tc: typeof CLASSIFICATION_TEST_CASES[0]): TestResult {
  const result = classifyByTaxonomy(tc.subject, tc.body);
  const failures: string[] = [];

  if (tc.expected.intent && result.intent !== tc.expected.intent) {
    failures.push(`INTENT: expected "${tc.expected.intent}", got "${result.intent}"`);
  }
  if (tc.expected.department && result.department !== tc.expected.department) {
    failures.push(`DEPT: expected "${tc.expected.department}", got "${result.department}"`);
  }
  if (tc.expected.priority && result.priority !== tc.expected.priority) {
    failures.push(`PRIORITY: expected "${tc.expected.priority}", got "${result.priority}"`);
  }
  if (tc.expected.decision && result.decision !== tc.expected.decision) {
    failures.push(`DECISION: expected "${tc.expected.decision}", got "${result.decision}"`);
  }
  if (tc.expected.riskLevel && result.riskLevel !== tc.expected.riskLevel) {
    failures.push(`RISK: expected "${tc.expected.riskLevel}", got "${result.riskLevel}"`);
  }

  return {
    id: tc.id,
    subject: tc.subject,
    body: tc.body,
    expected: tc.expected,
    actual: {
      intent: result.intent,
      department: result.department,
      subteam: result.subteam,
      priority: result.priority,
      riskLevel: result.riskLevel,
      decision: result.decision,
      confidence: result.confidence,
      reasoning: result.reasoning,
    },
    passed: failures.length === 0,
    failures,
  };
}

const results = CLASSIFICATION_TEST_CASES.map(runTest);
const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;
const total = results.length;
const passRate = ((passed / total) * 100).toFixed(1);

console.log('\n========================================');
console.log(`CLASSIFICATION TEST RESULTS`);
console.log('========================================');
console.log(`Total:    ${total}`);
console.log(`Passed:   ${passed}`);
console.log(`Failed:   ${failed}`);
console.log(`Pass Rate: ${passRate}%`);
console.log('========================================\n');

if (failed > 0) {
  console.log('FAILING TESTS:\n');
  for (const r of results.filter(r => !r.passed)) {
    console.log(`────────────────────────────────────────`);
    console.log(`ID: ${r.id}`);
    console.log(`Subject: ${r.subject}`);
    console.log(`Body: ${r.body.substring(0, 120)}...`);
    console.log(`Expected Intent:    ${r.expected.intent}`);
    console.log(`Actual Intent:      ${r.actual.intent}`);
    console.log(`Expected Dept:      ${r.expected.department}`);
    console.log(`Actual Dept:        ${r.actual.department}`);
    console.log(`Expected Priority:  ${r.expected.priority}`);
    console.log(`Actual Priority:    ${r.actual.priority}`);
    console.log(`Expected Risk:      ${r.expected.riskLevel}`);
    console.log(`Actual Risk:        ${r.actual.riskLevel}`);
    console.log(`Expected Decision:  ${r.expected.decision}`);
    console.log(`Actual Decision:    ${r.actual.decision}`);
    console.log(`Confidence:         ${r.actual.confidence.toFixed(3)}`);
    console.log(`Reasoning:          ${r.actual.reasoning}`);
    console.log(`FAILURES:`);
    for (const f of r.failures) {
      console.log(`  ✗ ${f}`);
    }
    console.log();
  }
}

console.log('\n========================================');
console.log(`SUMMARY: ${passed}/${total} passed (${passRate}%)`);
console.log('========================================\n');
