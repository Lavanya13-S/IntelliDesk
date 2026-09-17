/**
 * app/api/classify-all/test/route.ts
 *
 * Regression test runner for the classification taxonomy engine.
 * Runs all test cases from classification-test-cases.ts and reports:
 *   - Pass/fail per case
 *   - Overall pass rate
 *   - Failures list
 *
 * GET /api/classify-all/test
 * GET /api/classify-all/test?id=TC001
 */

import { NextRequest, NextResponse } from 'next/server';
import { CLASSIFICATION_TEST_CASES, TestCase } from '../../../../lib/ai/classification-test-cases';
import { classifyByTaxonomy } from '../../../../lib/ai/classification-engine';

interface TestResult {
  id: string;
  subject: string;
  expected: TestCase['expected'];
  actual: {
    intent: string;
    department: string;
    subteam: string;
    priority: string;
    riskLevel: string;
    decision: string;
    confidence: number;
  };
  passed: boolean;
  failures: string[];
}

function runTestCase(tc: TestCase): TestResult {
  const result = classifyByTaxonomy(tc.subject, tc.body);

  const failures: string[] = [];

  if (tc.expected.intent && result.intent !== tc.expected.intent) {
    failures.push(`intent: expected "${tc.expected.intent}", got "${result.intent}"`);
  }
  if (tc.expected.department && result.department !== tc.expected.department) {
    failures.push(`department: expected "${tc.expected.department}", got "${result.department}"`);
  }
  if (tc.expected.priority && result.priority !== tc.expected.priority) {
    failures.push(`priority: expected "${tc.expected.priority}", got "${result.priority}"`);
  }
  if (tc.expected.decision && result.decision !== tc.expected.decision) {
    failures.push(`decision: expected "${tc.expected.decision}", got "${result.decision}"`);
  }
  if (tc.expected.riskLevel && result.riskLevel !== tc.expected.riskLevel) {
    failures.push(`riskLevel: expected "${tc.expected.riskLevel}", got "${result.riskLevel}"`);
  }

  return {
    id: tc.id,
    subject: tc.subject,
    expected: tc.expected,
    actual: {
      intent: result.intent,
      department: result.department,
      subteam: result.subteam,
      priority: result.priority,
      riskLevel: result.riskLevel,
      decision: result.decision,
      confidence: result.confidence,
    },
    passed: failures.length === 0,
    failures,
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const filterId = searchParams.get('id');

  const cases = filterId
    ? CLASSIFICATION_TEST_CASES.filter((tc) => tc.id === filterId)
    : CLASSIFICATION_TEST_CASES;

  const results = cases.map(runTestCase);
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const passRate = cases.length > 0 ? ((passed / cases.length) * 100).toFixed(1) : '0';

  const failures = results.filter((r) => !r.passed);

  console.log(`[classify-all/test] ${cases.length} tests — ${passed} passed, ${failed} failed (${passRate}%)`);

  return NextResponse.json({
    summary: {
      total: cases.length,
      passed,
      failed,
      passRate: `${passRate}%`,
    },
    failures,
    results,
  });
}
