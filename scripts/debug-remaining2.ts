import { INTENT_TAXONOMY } from '../lib/ai/classification-taxonomy';

function tokenMatch(token: string, text: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped.replace(/\s+/g, '\\s+');
  const regex = new RegExp(`(?:^|\\b|\\s)${pattern}(?:\\b|\\s|$)`, 'i');
  return regex.test(text);
}

function debugIntent(id: string, text: string) {
  const def = INTENT_TAXONOMY.find(d => d.id === id)!;
  const matches = def.semanticTokens.filter(t => tokenMatch(t, text));
  const negMatches = def.negativeExclusions.filter(t => tokenMatch(t, text));
  const rawScore = matches.length;
  const normalizedScore = rawScore / def.semanticTokens.length;
  const penalty = negMatches.length * 0.40;
  const effectiveScore = Math.max(0, normalizedScore - penalty);
  console.log(`\n[${id}] "${def.intent}"`);
  console.log(`  Matches (${matches.length}):`, matches.slice(0,5).join(', '));
  console.log(`  NegHits (${negMatches.length}):`, negMatches.join(', '));
  console.log(`  Score: raw=${rawScore}, norm=${normalizedScore.toFixed(3)}, penalty=${penalty}, effective=${effectiveScore.toFixed(3)}`);
}

// TC017: "salary this month is less than my usual amount. payslip shows a deduction that was not communicated"
const t17 = 'incorrect amount paid i noticed that my salary this month is less than my usual amount. i also noticed my payslip shows a deduction that was not communicated to me.';
console.log('\n=== TC017 ===');
debugIntent('hr.payroll.incorrect', t17);
debugIntent('hr.payroll.payslip', t17);

// TC021: "overtime pay not included in payslip"
const t21 = 'overtime pay not included my payslip for this month does not show the overtime compensation. i worked 15 hours of overtime last month during the year-end rush, but the overtime pay is not included.';
console.log('\n=== TC021 ===');
debugIntent('hr.payroll.incorrect', t21);
debugIntent('hr.payroll.payslip', t21);
debugIntent('hr.attendance.overtime', t21);

// TC093: "former employee still has system access"
const t93 = 'ex-employee still has system access i have noticed that a former employee who left 2 weeks ago still appears to be able to access our internal systems. this is a security concern.';
console.log('\n=== TC093 ===');
debugIntent('security.access_revoke', t93);

// TC059: "HR self-service portal"
const t59 = 'cannot access hr self-service portal i am unable to log into the hr self-service portal to check my leave balance and payslips. i keep getting an authentication error.';
console.log('\n=== TC059 ===');
debugIntent('it.collab.sharepoint', t59);
debugIntent('hr.policy', t59);

// TC175: "production database server unreachable"
const t175 = 'database down the production database server is unreachable. all business applications that rely on this database are down. immediate assistance required.';
console.log('\n=== TC175 ===');
debugIntent('it.network.outage', t175);
// find database access request id
const dbDef = INTENT_TAXONOMY.find(d => d.intent.toLowerCase().includes('database access'))!;
if (dbDef) debugIntent(dbDef.id, t175);
