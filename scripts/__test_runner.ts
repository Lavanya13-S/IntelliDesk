import { CLASSIFICATION_TEST_CASES } from "../lib/ai/classification-test-cases";
import { classifyByTaxonomy } from "../lib/ai/classification-engine";

const failures: Array<Record<string, unknown>> = [];
let passed = 0;
let failed = 0;

for (const tc of CLASSIFICATION_TEST_CASES) {
  const result = classifyByTaxonomy(tc.subject, tc.body);
  const fieldFailures: string[] = [];

  if (tc.expected.intent && result.intent !== tc.expected.intent)
    fieldFailures.push(`intent: expected "${tc.expected.intent}", got "${result.intent}"`);
  if (tc.expected.department && result.department !== tc.expected.department)
    fieldFailures.push(`dept: expected "${tc.expected.department}", got "${result.department}"`);
  if (tc.expected.priority && result.priority !== tc.expected.priority)
    fieldFailures.push(`priority: expected "${tc.expected.priority}", got "${result.priority}"`);
  if (tc.expected.decision && result.decision !== tc.expected.decision)
    fieldFailures.push(`decision: expected "${tc.expected.decision}", got "${result.decision}"`);
  if (tc.expected.riskLevel && result.riskLevel !== tc.expected.riskLevel)
    fieldFailures.push(`risk: expected "${tc.expected.riskLevel}", got "${result.riskLevel}"`);

  if (fieldFailures.length === 0) {
    passed++;
  } else {
    failed++;
    failures.push({
      id: tc.id,
      subject: tc.subject,
      bodySnippet: tc.body.substring(0, 120),
      expected: tc.expected,
      actual: {
        intent: result.intent,
        department: result.department,
        subteam: result.subteam,
        priority: result.priority,
        riskLevel: result.riskLevel,
        decision: result.decision,
        confidence: result.confidence.toFixed(3),
      },
      failures: fieldFailures,
    });
  }
}

const total = CLASSIFICATION_TEST_CASES.length;
console.log("=== RESULTS ===");
console.log(`Total: ${total}  Passed: ${passed}  Failed: ${failed}  Rate: ${((passed / total) * 100).toFixed(1)}%`);
console.log("\n=== FAILURES ===");
for (const f of failures as any[]) {
  console.log(`\n[${f.id}] ${f.subject}`);
  console.log(`  Body: ${f.bodySnippet}`);
  for (const x of f.failures) console.log(`  FAIL: ${x}`);
  console.log(`  Actual: intent="${(f.actual as any).intent}" dept="${(f.actual as any).department}" conf=${(f.actual as any).confidence}`);
}
