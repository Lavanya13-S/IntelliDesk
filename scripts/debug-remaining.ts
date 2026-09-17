import { classifyByTaxonomy } from '../lib/ai/classification-engine';
import { INTENT_TAXONOMY } from '../lib/ai/classification-taxonomy';

// TC003
const r3 = classifyByTaxonomy('Sick Leave Application', 'I am not well today and need to take a sick day. I have a fever and my doctor has advised rest.');
console.log('TC003 result:', r3.intent, '|', r3.department, '|', r3.priority);

// Check what sick leave intent scores
const sickDef = INTENT_TAXONOMY.find(d => d.id === 'hr.leave.sick')!;
const text = 'sick leave application i am not well today and need to take a sick day. i have a fever and my doctor has advised rest.';
const matches = sickDef.semanticTokens.filter(t => {
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped.replace(/\s+/g, '\\s+');
  const regex = new RegExp(`(?:^|\\b|\\s)${pattern}(?:\\b|\\s|$)`, 'i');
  return regex.test(text);
});
console.log('Sick leave matches:', matches);
const negMatches = sickDef.negativeExclusions.filter(t => text.toLowerCase().includes(t.toLowerCase()));
console.log('Negative hits:', negMatches);
const rawScore = matches.length;
const normalizedScore = rawScore / sickDef.semanticTokens.length;
const penalty = negMatches.length * 0.40;
const effectiveScore = Math.max(0, normalizedScore - penalty);
console.log(`rawScore=${rawScore}, normalizedScore=${normalizedScore.toFixed(3)}, penalty=${penalty}, effectiveScore=${effectiveScore.toFixed(3)}`);

// Now TC017
const r17 = classifyByTaxonomy('Incorrect amount paid', 'I noticed that my salary this month is less than my usual amount. I also noticed my payslip shows a deduction that was not communicated to me.');
console.log('TC017 result:', r17.intent, '|', r17.department);

// TC093
const r93 = classifyByTaxonomy('Ex-employee still has system access', 'I have noticed that a former employee who left 2 weeks ago still appears to be able to access our internal systems. This is a security concern.');
console.log('TC093 result:', r93.intent, '|', r93.department);

// TC153
const r153 = classifyByTaxonomy('Toilet not working', 'The toilet in the men restroom on the 3rd floor is not flushing properly. The flush mechanism seems broken.');
console.log('TC153 result:', r153.intent, '|', r153.department);

// TC175
const r175 = classifyByTaxonomy('Database down', 'The production database server is unreachable. All business applications that rely on this database are down. Immediate assistance required.');
console.log('TC175 result:', r175.intent, '|', r175.department, '|', r175.decision);

// TC059
const r59 = classifyByTaxonomy('Cannot access HR self-service portal', 'I am unable to log into the HR self-service portal to check my leave balance and payslips. I keep getting an authentication error.');
console.log('TC059 result:', r59.intent, '|', r59.department);
