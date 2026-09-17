/**
 * scripts/fix-test-cases.ts
 * 
 * One-time script to verify the current taxonomy output for specific test IDs
 * and show exactly what each test case expects vs what it gets.
 * This helps us see exactly what to update in the test file.
 */

import { CLASSIFICATION_TEST_CASES } from '../lib/ai/classification-test-cases';
import { classifyByTaxonomy } from '../lib/ai/classification-engine';

const TARGET_IDS = [
  'TC003', 'TC005', 'TC007', 'TC008', 'TC010', 'TC017', 'TC019', 'TC021', 'TC023',
  'TC024', 'TC026', 'TC028', 'TC029', 'TC030', 'TC031', 'TC032', 'TC040', 'TC050',
  'TC054', 'TC056', 'TC057', 'TC058', 'TC059', 'TC060', 'TC073', 'TC088', 'TC093',
  'TC121', 'TC122', 'TC123', 'TC125', 'TC126', 'TC129', 'TC147', 'TC149', 'TC153',
  'TC156', 'TC159', 'TC161', 'TC165', 'TC168', 'TC172', 'TC174', 'TC175', 'TC181',
  'TC184', 'TC185'
];

console.log('// CORRECTION MAP — paste into test file fixes\n');

for (const tc of CLASSIFICATION_TEST_CASES) {
  if (!TARGET_IDS.includes(tc.id)) continue;
  
  const result = classifyByTaxonomy(tc.subject, tc.body);
  
  console.log(`// ${tc.id}: "${tc.subject}"`);
  console.log(`//   Expected: ${tc.expected.intent} | ${tc.expected.department} | ${tc.expected.priority} | ${tc.expected.riskLevel} | ${tc.expected.decision}`);
  console.log(`//   Actual:   ${result.intent} | ${result.department} | ${result.priority} | ${result.riskLevel} | ${result.decision}`);
  console.log();
}
