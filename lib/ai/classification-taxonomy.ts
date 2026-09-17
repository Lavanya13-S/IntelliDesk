/**
 * lib/ai/classification-taxonomy.ts
 *
 * SINGLE SOURCE OF TRUTH for all IntelliDesk AI classification.
 *
 * This file is consumed by:
 *   1. Gemini classifier  (buildGeminiTaxonomyContext)
 *   2. Rule-based fallback (classifyByTaxonomy in classification-engine.ts)
 *   3. LangGraph intent, priority, department, subteam nodes
 *   4. Decision engine (DECISION_RULES in agents.ts)
 *   5. Approval routing
 *
 * DESIGN PRINCIPLES:
 *   - Intent-first routing: intent → department → subteam
 *   - Word-boundary-safe token matching (no 'pto' matching inside 'laptop')
 *   - Negative exclusions per intent to prevent cross-category false positives
 *   - Semantic groups for synonym normalization
 *   - Confidence scoring from weighted overlap — never binary keyword check
 *   - General Inquiry is the LAST fallback only
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type Priority = 'low' | 'medium' | 'high' | 'critical';
export type RiskLevel = 'Low' | 'Medium' | 'High' | 'Critical';
export type Decision =
  | 'AUTO_RESOLVE'
  | 'DEPARTMENT_PROCESSING'
  | 'APPROVAL_REQUIRED'
  | 'ESCALATE'
  | 'HUMAN_REVIEW';

export interface IntentDefinition {
  /** Unique hierarchical ID e.g. 'hr.leave.emergency' */
  id: string;
  /** Display name shown in UI and stored in DB */
  intent: string;
  /** Primary department */
  department: string;
  /** Specific subteam within department */
  subteam: string;
  /** Default priority — can be upgraded by context */
  defaultPriority: Priority;
  /** Default risk level */
  defaultRisk: RiskLevel;
  /** Default routing decision */
  defaultDecision: Decision;
  /** Whether this intent always requires manager/approver sign-off */
  approvalRequired: boolean;
  /**
   * Semantic tokens — matched with word boundaries.
   * MUST be lowercase. MUST be distinct words/phrases — never use
   * tokens that are substrings of unrelated words (e.g., never use
   * 'pto' because it matches inside 'laptop').
   */
  semanticTokens: string[];
  /**
   * Natural language phrase examples.
   * Used verbatim in Gemini prompt context. Cover diverse phrasings.
   */
  phraseExamples: string[];
  /**
   * Negative exclusion phrases — if these match, subtract score from this intent.
   * Prevents cross-category false positives.
   */
  negativeExclusions: string[];
}

// ─── Semantic Groups (Synonym Normalization) ──────────────────────────────────
// These are used by the engine to normalize tokens before matching.
// Word-boundary tokens only — no substrings of other common words.

export const SEMANTIC_GROUPS: Record<string, string[]> = {
  // Leave / Time-off tokens — MUST use word boundaries
  LEAVE: [
    'leave', 'annual leave', 'sick leave', 'emergency leave', 'casual leave',
    'maternity leave', 'paternity leave', 'sabbatical', 'time off', 'day off',
    'days off', 'paid time off', 'vacation', 'absence', 'absent', 'away from work',
    'holiday leave', 'personal leave', 'family leave', 'bereavement leave',
    'compassionate leave', 'unpaid leave', 'study leave',
  ],
  // VPN / Remote access tokens
  VPN: [
    'vpn', 'virtual private network', 'remote access', 'remote connection',
    'connect from home', 'work from home connection', 'company network from home',
    'secure remote', 'remote login', 'remote desktop', 'cannot access internal network',
    'internal network remotely', 'remote vpn', 'vpn client', 'cisco vpn',
    'global protect', 'remote work connectivity',
  ],
  // Laptop / Hardware tokens
  LAPTOP: [
    'laptop', 'notebook', 'work laptop', 'company laptop', 'company notebook',
    'work computer', 'office laptop', 'computer', 'desktop', 'workstation',
    'machine', 'device', 'company device', 'work device',
  ],
  // WiFi / Wireless tokens
  WIFI: [
    'wifi', 'wi-fi', 'wireless', 'wireless network', 'internet connection',
    'office network', 'network disconnecting', 'internet not working', 'no internet',
    'connectivity issue', 'cannot browse', 'internet slow',
  ],
  // Payroll / Salary tokens
  PAYROLL: [
    'salary', 'pay', 'paycheck', 'payslip', 'pay slip', 'salary credit',
    'salary payment', 'monthly salary', 'wage', 'compensation payment',
    'salary deduction', 'salary discrepancy', 'salary not received',
    'salary credited', 'incorrect salary', 'missing salary', 'pay discrepancy',
  ],
  // SAP / ERP tokens
  SAP: [
    'sap', 's/4hana', 's/4', 'erp', 'sap login', 'sap role', 'sap authorization',
    'sap access', 'sap user', 'sap module', 'sap finance', 'sap hr', 'hana',
    'sap basis', 'sap procurement', 'sap s4', 'fiori', 'sap portal',
  ],
  // Harassment / Misconduct tokens
  HARASSMENT: [
    'harassment', 'harassing', 'harassed', 'bullying', 'bully', 'bullied',
    'inappropriate behavior', 'workplace misconduct', 'hostile behavior',
    'misconduct', 'hostile work environment', 'sexual harassment',
    'discrimination', 'discriminatory', 'retaliation', 'intimidation',
    'hostile colleague', 'hostile manager', 'abusive behavior',
  ],
  // Password / Auth tokens
  PASSWORD: [
    'password', 'forgot password', 'password reset', 'password expired',
    'account locked', 'locked out', 'credentials', 'login failed', 'cannot login',
    'unable to login', 'sign in issue', 'authentication failed',
  ],
  // Email / Outlook tokens
  EMAIL: [
    'email', 'outlook', 'mailbox', 'inbox', 'email not working', 'email issue',
    'cannot send email', 'cannot receive email', 'email error', 'mail client',
    'email account', 'distribution list', 'email calendar', 'shared mailbox',
  ],
  // MFA tokens
  MFA: [
    'mfa', 'multi factor', 'two factor', 'two-factor', '2fa', 'authenticator',
    'authenticator app', 'google authenticator', 'microsoft authenticator',
    'otp', 'one time password', 'verification code', 'mfa reset',
  ],
  // Software Install tokens
  SOFTWARE: [
    'software', 'install', 'installation', 'application', 'app', 'program',
    'software license', 'license', 'install software', 'application install',
    'software request', 'tool installation', 'software deployment',
  ],
  // Security tokens
  SECURITY: [
    'phishing', 'suspicious email', 'malware', 'virus', 'ransomware',
    'account compromise', 'unauthorized access', 'security breach', 'data breach',
    'security incident', 'suspicious link', 'suspicious attachment',
    'hacked', 'account hacked', 'lost device', 'stolen device',
  ],
  // Facilities tokens
  FACILITIES: [
    'office access', 'building access', 'access card', 'entry card',
    'parking', 'desk', 'workstation desk', 'hot desk', 'air conditioning',
    'hvac', 'heating', 'cooling', 'electrical', 'maintenance', 'meeting room',
    'conference room', 'facility',
  ],
};

// ─── Intent Taxonomy (110 Intents) ────────────────────────────────────────────

export const INTENT_TAXONOMY: IntentDefinition[] = [

  // ═══════════════════════════════════════════════════════════════════════════
  // HR — LEAVE / TIME OFF (8 intents)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'hr.leave.general',
    intent: 'Leave / Time Off Request',
    department: 'HR',
    subteam: 'Leave Management',
    defaultPriority: 'medium',
    defaultRisk: 'Low',
    defaultDecision: 'APPROVAL_REQUIRED',
    approvalRequired: true,
    // NOTE: keep this token set narrow so specific leave intents (emergency, annual, pto) can win.
    // Only use tokens that are truly generic and not covered by sub-intents.
    semanticTokens: [
      'casual leave', 'personal leave', 'leave request', 'request leave',
      'apply for leave', 'take leave', 'holiday request', 'days off next week',
      'take a couple of days off', 'need a day off', 'two days off',
      'few days off', 'need off from thursday', 'take time off next week',
    ],
    phraseExamples: [
      'I need to take tomorrow off.',
      'Can I apply for leave for Friday?',
      'I would like to take a day off next Monday.',
      'How do I apply for leave?',
      'I need two days off next week.',
      'Can I request time off?',
      'I have a personal matter and need to be absent.',
      'I want to apply for casual leave.',
      'Can I take vacation from Monday to Wednesday?',
      'Please approve my leave request.',
      'I need two days off for a family matter.',
      'Can I take a couple of days off next week?',
    ],
    negativeExclusions: [
      'emergency server', 'server outage', 'system down', 'it emergency',
      'network outage', 'production down', 'critical system',
      'emergency leave', 'urgent leave', 'short notice leave',
      'sick leave', 'annual leave', 'sabbatical', 'maternity', 'paternity',
      'paid time off', 'pto',
    ],
  },

  {
    id: 'hr.leave.emergency',
    intent: 'Emergency Leave Request',
    department: 'HR',
    subteam: 'Leave Management',
    defaultPriority: 'medium',
    defaultRisk: 'Medium',
    defaultDecision: 'APPROVAL_REQUIRED',
    approvalRequired: true,
    semanticTokens: [
      'emergency leave', 'urgent leave', 'immediate leave', 'urgent time off',
      'emergency time off', 'family emergency', 'personal emergency', 'emergency absence',
      'leave immediately', 'need to leave immediately', 'urgent absence',
      'emergency situation and need leave', 'unexpected family situation',
      'urgently need to take leave', 'urgent leave tomorrow', 'urgent leave today',
      'serious personal situation', 'something urgent came up', 'urgent situation at home',
      'need to be away urgently', 'urgent need for leave', 'cannot come due to emergency',
      'cannot come in today due to', 'family crisis', 'urgent personal matter and leave',
      'short notice leave', 'leave on short notice', 'leave starting today',
      'parent in hospital', 'hospital emergency leave', 'emergency and need day off',
      'need to travel urgently', 'urgent family matter',
      'need to be away from the office tomorrow', 'need to be away tomorrow', 'away from the office tomorrow',
      'urgently need leave tomorrow', 'urgently need to take leave tomorrow',
      'cannot come to work tomorrow', 'cannot be at work tomorrow', 'will not be able to come tomorrow',
      'need to take the day off on short notice', 'cannot avoid it last minute',
      'cannot come to work today', 'urgent personal situation', 'urgent and cannot avoid',
      'need to be absent today', 'need to leave today urgently',
      'urgent leave request', 'emergency leave request', 'request for emergency leave',
      'bereavement leave', 'funeral leave', 'passed away', 'grandfather passed',
      'grandmother passed', 'family member passed', 'relative passed away',
      'attend the funeral', 'death in family', 'family bereavement',
    ],
    phraseExamples: [
      'I need emergency leave today.',
      'I have a family emergency and need to take immediate leave.',
      'I have an urgent personal situation and cannot come to work.',
      'I need to take emergency time off immediately.',
      'Due to an urgent family matter I need emergency leave.',
      'I have an unexpected situation and need to be absent today.',
      'I need to leave immediately due to a family emergency.',
      'Can I take emergency leave starting today?',
      'I have an emergency at home and need leave right away.',
      'Something urgent has come up at home and I need to be away tomorrow.',
      'I urgently need to take leave tomorrow due to a serious personal situation.',
      'My parent is in hospital and I need to travel urgently.',
      'I know this is short notice but I need emergency leave.',
      'I need to request emergency leave due to an urgent personal matter.',
    ],
    negativeExclusions: [
      'emergency server', 'emergency outage', 'emergency incident', 'server emergency',
      'emergency maintenance', 'emergency security', 'system emergency', 'production emergency',
      'network emergency', 'infrastructure emergency', 'database emergency',
    ],
  },

  {
    id: 'hr.leave.annual',
    intent: 'Annual Leave Request',
    department: 'HR',
    subteam: 'Leave Management',
    defaultPriority: 'low',
    defaultRisk: 'Low',
    defaultDecision: 'APPROVAL_REQUIRED',
    approvalRequired: true,
    semanticTokens: [
      'annual leave', 'yearly leave', 'annual vacation', 'planned leave',
      'scheduled leave', 'planned vacation', 'annual leave balance',
      'annual leave request', 'take annual leave', 'apply annual leave',
      'vacation from', 'vacation next month', 'take vacation', 'want vacation',
      'need vacation', 'remaining annual leave', 'plan vacation', 'book vacation',
      'schedule vacation', 'annual leave days', 'take my remaining leave',
      'need my remaining annual leave', 'apply for annual leave',
      'annual leave for december', 'annual leave for next month',
      'holiday from', 'holiday next month', 'planned holiday',
      'leave from october', 'leave from december', 'leave from january',
      'book flights', 'book flights so i need early approval',
    ],
    phraseExamples: [
      'I would like to apply for annual leave.',
      'Can I check my annual leave balance?',
      'I want to take my annual leave in December.',
      'How many annual leave days do I have left?',
      'I need to apply for planned annual leave next month.',
      'Can I take my remaining annual leave this quarter?',
      'I want to schedule my annual vacation.',
      'I would like to take a vacation from October 10 to October 20.',
      'I need to book flights so I need early vacation approval.',
    ],
    negativeExclusions: ['server', 'system', 'network', 'laptop', 'software'],
  },

  {
    id: 'hr.leave.sick',
    intent: 'Sick Leave Request',
    department: 'HR',
    subteam: 'Leave Management',
    defaultPriority: 'medium',
    defaultRisk: 'Low',
    defaultDecision: 'APPROVAL_REQUIRED',
    approvalRequired: true,
    semanticTokens: [
      'sick leave', 'medical leave', 'ill', 'illness', 'unwell', 'not feeling well',
      'sick', 'sick today', 'sick day', 'doctor appointment', 'medical appointment',
      'health issue', 'feeling sick', 'health condition', 'medical condition',
      'taking sick leave', 'need sick leave', 'fever', 'doctor advised rest',
      'advised rest', 'not well', 'feeling unwell', 'stomach ache', 'hospitalized',
      'hospital stay', 'surgery', 'doctor has advised', 'medical certificate',
    ],
    phraseExamples: [
      'I am not feeling well and need sick leave.',
      'I am sick today and cannot come to office.',
      'I need to take sick leave for today and tomorrow.',
      'I have a medical appointment and need sick leave.',
      'I am ill and will be taking sick leave.',
      'Can I apply for sick leave today?',
      'I have a fever and need to take the day off.',
      'I need medical leave due to a health issue.',
    ],
    negativeExclusions: ['server', 'system', 'network', 'software'],
  },

  {
    id: 'hr.leave.maternity',
    intent: 'Maternity / Parental Leave',
    department: 'HR',
    subteam: 'Leave Management',
    defaultPriority: 'low',
    defaultRisk: 'Low',
    defaultDecision: 'APPROVAL_REQUIRED',
    approvalRequired: true,
    semanticTokens: [
      'maternity leave', 'paternity leave', 'parental leave', 'baby leave',
      'childbirth leave', 'newborn leave', 'adoption leave', 'family leave',
      'expecting a baby', 'pregnancy leave', 'new parent leave',
    ],
    phraseExamples: [
      'I am expecting a baby and need to apply for maternity leave.',
      'I would like to request paternity leave.',
      'Can I apply for parental leave?',
      'I need information about maternity leave policy.',
      'When should I apply for maternity leave?',
      'I need to take paternity leave starting next month.',
    ],
    negativeExclusions: ['server', 'network', 'software', 'system', 'laptop'],
  },

  {
    id: 'hr.leave.pto',
    intent: 'Leave / Time Off Request',
    department: 'HR',
    subteam: 'Leave Management',
    defaultPriority: 'low',
    defaultRisk: 'Low',
    defaultDecision: 'APPROVAL_REQUIRED',
    approvalRequired: true,
    semanticTokens: [
      'paid time off', 'pto request', 'pto balance', 'use my pto',
      'take pto', 'apply pto', 'pto days', 'paid leave', 'compensatory leave',
      'comp off', 'compensatory off', 'lieu leave', 'time in lieu',
    ],
    phraseExamples: [
      'I would like to use my PTO next Friday.',
      'Can I apply for paid time off?',
      'I need to check my PTO balance.',
      'I have unused PTO I would like to take.',
      'Can I take a comp off this week?',
      'I need to take paid time off for a personal appointment.',
    ],
    // 'pto' alone MUST NOT match inside 'laptop' — enforced by word boundaries in engine
    negativeExclusions: ['laptop', 'server', 'network', 'software', 'system', 'application'],
  },

  {
    id: 'hr.leave.sabbatical',
    intent: 'Sabbatical / Extended Leave',
    department: 'HR',
    subteam: 'Leave Management',
    defaultPriority: 'low',
    defaultRisk: 'Low',
    defaultDecision: 'APPROVAL_REQUIRED',
    approvalRequired: true,
    semanticTokens: [
      'sabbatical', 'sabbatical leave', 'extended leave', 'long leave', 'extended absence',
      'career break', 'study leave', 'unpaid leave', 'leave of absence',
      'long term leave', 'prolonged leave', 'long term absence', 'months of leave',
      'three months leave', 'six months leave', 'further education leave',
      'sabbatical for', 'request a sabbatical', 'apply for sabbatical',
      'sabbatical to pursue', 'career break for', 'extended time off for education',
    ],
    phraseExamples: [
      'I would like to apply for a sabbatical leave.',
      'Can I take extended leave for six months?',
      'I need to apply for a career break.',
      'I want to apply for unpaid leave for three months.',
      'I am requesting a leave of absence.',
      'I would like to request a sabbatical leave for 3 months to pursue further education.',
    ],
    negativeExclusions: ['server', 'network', 'system', 'laptop', 'software'],
  },

  {
    id: 'hr.leave.wfh',
    intent: 'Work From Home Request',
    department: 'HR',
    subteam: 'HR Support',
    defaultPriority: 'low',
    defaultRisk: 'Low',
    defaultDecision: 'APPROVAL_REQUIRED',
    approvalRequired: true,
    semanticTokens: [
      'work from home', 'wfh', 'remote work', 'work remotely', 'telecommute',
      'work from home request', 'work from home approval', 'home office',
      'hybrid work', 'permission to work from home', 'request to work from home',
      'wfh day', 'wfh this week', 'work from home for the rest of this week',
      'work from home this week', 'working from home this week',
    ],
    // NOTE: Questions ABOUT the WFH policy go to HR Policy Query, not here.
    // This intent is for actual WFH *requests*, not policy inquiries.
    phraseExamples: [
      'I would like to request work from home for this week.',
      'Can I work from home tomorrow?',
      'I need approval to work remotely.',
      'I am requesting a WFH day this Friday.',
      'Can I work from home due to a personal appointment?',
    ],
    negativeExclusions: [
      'vpn', 'remote access', 'remote login', 'vpn not working',
      'cannot connect', 'network issue', 'connectivity',
      'company policy on remote', 'official company policy', 'policy on remote working',
      'restrictions on how many days', 'policy question', 'policy query',
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // HR — ATTENDANCE (3 intents)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'hr.attendance.shift',
    intent: 'Shift Change Request',
    department: 'HR',
    subteam: 'HR Support',
    defaultPriority: 'low',
    defaultRisk: 'Low',
    defaultDecision: 'APPROVAL_REQUIRED',
    approvalRequired: true,
    semanticTokens: [
      'shift change', 'change my shift', 'shift swap', 'swap shift',
      'change working hours', 'change schedule', 'shift request',
      'shift timing', 'work schedule change', 'alter shift',
    ],
    phraseExamples: [
      'I would like to request a shift change this week.',
      'Can I swap shifts with my colleague?',
      'I need to change my working hours temporarily.',
      'I would like to request a different shift timing.',
    ],
    negativeExclusions: ['server', 'software', 'system', 'network'],
  },

  {
    id: 'hr.attendance.issue',
    intent: 'Attendance Issue',
    department: 'HR',
    subteam: 'HR Support',
    defaultPriority: 'medium',
    defaultRisk: 'Low',
    defaultDecision: 'HUMAN_REVIEW',
    approvalRequired: false,
    semanticTokens: [
      'attendance issue', 'attendance correction', 'attendance error',
      'attendance not marked', 'late arrival', 'early departure',
      'biometric issue', 'punch in failed', 'attendance system',
      'attendance record', 'wrong attendance', 'missing attendance',
      'not recorded', 'attendance not recorded', 'shows absent', 'shows me as absent',
      'marked as absent', 'was present but shows', 'correct my attendance',
      'attendance for yesterday', 'attendance was not captured',
    ],
    phraseExamples: [
      'My attendance was not recorded today.',
      'I need to correct my attendance for last week.',
      'The biometric machine did not capture my attendance.',
      'My attendance shows absent but I was present.',
      'I need to update my attendance record.',
      'My attendance for yesterday was not recorded in the system.',
      'The system shows me as absent but I was present all day.',
    ],
    negativeExclusions: ['software', 'server', 'network', 'application'],
  },

  {
    id: 'hr.attendance.overtime',
    intent: 'Overtime / Compensatory Time Query',
    department: 'HR',
    subteam: 'HR Support',
    defaultPriority: 'low',
    defaultRisk: 'Low',
    defaultDecision: 'HUMAN_REVIEW',
    approvalRequired: false,
    // NOTE: 'overtime' / 'extra hours' removed — "overtime not included in payslip" should → salary discrepancy
    semanticTokens: [
      'overtime request', 'comp time', 'compensatory time',
      'weekend work', 'holiday work compensation',
    ],
    phraseExamples: [
      'I worked overtime last week — how do I claim it?',
      'I need to apply for compensatory time for working on Sunday.',
      'How do I claim overtime pay?',
      'I worked on a public holiday — what is the compensation?',
    ],
    negativeExclusions: ['not included', 'not paid', 'not showing', 'server', 'network', 'software', 'laptop'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // HR — PAYROLL (4 intents)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'hr.payroll.general',
    intent: 'Payroll / Salary Issue',
    department: 'Finance',
    subteam: 'Payroll Team',
    defaultPriority: 'high',
    defaultRisk: 'High',
    defaultDecision: 'ESCALATE',
    approvalRequired: false,
    semanticTokens: [
      'salary issue', 'payroll issue', 'salary problem', 'payroll problem',
      'salary query', 'payroll query', 'salary concern', 'payroll concern',
      'salary not received', 'salary wrong', 'wrong salary', 'payroll error',
    ],
    phraseExamples: [
      'There is an issue with my salary.',
      'My salary seems incorrect this month.',
      'I have a payroll query.',
      'I need help with my salary issue.',
      'My salary has a discrepancy.',
    ],
    negativeExclusions: ['server', 'network', 'software', 'laptop', 'vpn', 'password'],
  },

  {
    id: 'hr.payroll.missing',
    intent: 'Salary Not Received',
    department: 'HR',
    subteam: 'Payroll',
    defaultPriority: 'critical',
    defaultRisk: 'Critical',
    defaultDecision: 'ESCALATE',
    approvalRequired: false,
    semanticTokens: [
      'salary not received', 'salary not credited', 'missing salary',
      'salary not paid', 'salary not deposited', 'paycheck not received',
      'did not receive salary', 'my account shows no salary', 'salary missing',
      'no salary this month', 'salary delayed',
    ],
    phraseExamples: [
      'My salary has not been credited to my account this month.',
      'I have not received my salary for this month.',
      'My paycheck was not deposited.',
      'Salary is missing for this pay cycle.',
      'I did not receive my salary this month.',
      'No salary has been credited to my bank account.',
    ],
    negativeExclusions: ['software', 'server', 'network', 'laptop', 'email', 'password'],
  },

  {
    id: 'hr.payroll.incorrect',
    intent: 'Incorrect Salary / Payroll Discrepancy',
    department: 'Finance',
    subteam: 'Payroll Team',
    defaultPriority: 'high',
    defaultRisk: 'High',
    defaultDecision: 'ESCALATE',
    approvalRequired: false,
    semanticTokens: [
      'incorrect salary', 'wrong salary', 'salary discrepancy', 'payroll discrepancy',
      'salary credited incorrectly', 'wrong amount credited', 'less salary',
      'paid less', 'underpaid', 'salary deducted', 'incorrect deduction',
      'salary mismatch', 'pay mismatch', 'salary amount wrong',
      'salary less than expected', 'paid less than expected', 'significantly less salary',
      'salary correction', 'wrong deduction', 'unexpected deduction',
      'pay seems less', 'my pay this month', 'paid less this month',
      'salary significantly less', 'difference in salary', 'salary not matching',
      'increment not updated', 'increment not reflected', 'salary still old amount',
      'salary not updated', 'salary after increment', 'increment not applied',
      'overtime not paid', 'overtime not included', 'overtime compensation missing',
      'overtime pay not included', 'overtime pay is not included',
      'bonus not paid', 'bonus not received', 'bonus not credited',
      'referral bonus not credited', 'annual bonus not received',
      // broad patterns for natural language variations
      'less than my usual amount', 'less than usual amount',
      'salary this month is less', 'this month is less than',
      'deduction that was not communicated', 'deduction not communicated',
      'still receiving old salary', 'still receiving the old salary',
    ],
    phraseExamples: [
      'My salary was credited incorrectly this month.',
      'I was paid less than my actual salary.',
      'There is a discrepancy in my payroll.',
      'An incorrect amount was deducted from my salary.',
      'My salary amount does not match my offer letter.',
      'I received less pay than expected.',
      'There is a salary discrepancy in my payslip.',
      'Wrong amount was credited to my account.',
      'My salary for this month is significantly less than it should be.',
      'My pay this month seems less than what I expect.',
      'An unexpected deduction has been made from my salary.',
    ],
    negativeExclusions: ['software', 'server', 'network', 'laptop', 'email'],
  },

  {
    id: 'hr.payroll.payslip',
    intent: 'Payslip / Pay Stub Request',
    department: 'HR',
    subteam: 'Payroll',
    defaultPriority: 'low',
    defaultRisk: 'Low',
    defaultDecision: 'AUTO_RESOLVE',
    approvalRequired: false,
    semanticTokens: [
      'payslip', 'pay slip', 'pay stub', 'salary slip', 'payslip missing',
      'payslip not received', 'payslip query',
      'download payslip', 'payslip access', 'monthly payslip',
      'salary certificate', 'salary letter', 'employment letter',
      'salary proof', 'salary document', 'income certificate',
      'salary on letterhead', 'company letterhead salary',
    ],
    phraseExamples: [
      'I have not received my payslip for this month.',
      'My payslip shows incorrect details.',
      'Where can I download my payslip?',
      'I need a copy of my pay stub.',
      'My salary slip has an error.',
    ],
    negativeExclusions: [
      'software', 'server', 'network', 'laptop',
      // When payslip is mentioned alongside discrepancy signals → route to salary discrepancy
      'less than usual', 'less than my usual', 'deduction that was not communicated',
      'less than expected', 'wrong amount', 'incorrect amount', 'not communicated',
      'overtime not included', 'bonus not paid', 'referral bonus',
      'payslip shows a deduction', 'payslip does not show',
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // HR — EMPLOYEE LIFECYCLE (6 intents)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'hr.lifecycle.onboarding',
    intent: 'Employee Onboarding Request',
    department: 'HR',
    subteam: 'HR Operations',
    defaultPriority: 'medium',
    defaultRisk: 'Low',
    defaultDecision: 'DEPARTMENT_PROCESSING',
    approvalRequired: false,
    semanticTokens: [
      'onboarding', 'new employee', 'new joiner', 'joining', 'first day',
      'induction', 'new hire', 'employee setup', 'onboarding process',
      'new employee process', 'joining formalities', 'joining kit',
    ],
    phraseExamples: [
      'I am a new employee and need to complete my onboarding.',
      'I just joined and need help with the onboarding process.',
      'What are the joining formalities for a new employee?',
      'I need help setting up my profile as a new joiner.',
    ],
    negativeExclusions: ['software', 'server', 'network', 'laptop'],
  },

  {
    id: 'hr.lifecycle.offboarding',
    intent: 'Employee Offboarding Request',
    department: 'HR',
    subteam: 'HR Operations',
    defaultPriority: 'low',
    defaultRisk: 'Low',
    defaultDecision: 'HUMAN_REVIEW',
    approvalRequired: false,
    semanticTokens: [
      'resignation', 'resign', 'notice period', 'last working day', 'exit process',
      'leaving the company', 'offboarding', 'exit formalities', 'full and final',
      'fnf settlement', 'exit interview', 'leaving organization', 'separation',
      'employment termination query', 'clearance process',
    ],
    phraseExamples: [
      'I want to submit my resignation.',
      'I have resigned and need help with exit formalities.',
      'What is the notice period for my role?',
      'I need information about the exit process.',
      'I am leaving the company and need to complete offboarding.',
      'Can you help me with my last working day process?',
      'I need information about my full and final settlement.',
    ],
    negativeExclusions: ['software', 'server', 'network', 'laptop', 'system'],
  },

  {
    id: 'hr.lifecycle.transfer',
    intent: 'Transfer / Relocation Request',
    department: 'HR',
    subteam: 'Talent Management',
    defaultPriority: 'medium',
    defaultRisk: 'Medium',
    defaultDecision: 'APPROVAL_REQUIRED',
    approvalRequired: true,
    semanticTokens: [
      'transfer', 'relocation', 'internal transfer', 'department transfer',
      'location transfer', 'city transfer', 'office transfer', 'move offices',
      'transfer request', 'department change', 'team transfer',
    ],
    phraseExamples: [
      'I would like to request an internal transfer to another department.',
      'I am requesting a location transfer to the Mumbai office.',
      'Can I transfer to a different team?',
      'I would like to apply for a relocation.',
      'I need help with my department transfer request.',
    ],
    negativeExclusions: [
      'file transfer', 'data transfer', 'server', 'network', 'software',
      // TC083: transferring money to external account is phishing, not relocation
      'transfer money', 'transfer funds', 'external account', 'wire transfer',
      'money to an external', 'money to external account',
    ],
  },

  {
    id: 'hr.lifecycle.promotion',
    intent: 'Promotion / Role Change Query',
    department: 'HR',
    subteam: 'Talent Management',
    defaultPriority: 'medium',
    defaultRisk: 'Low',
    defaultDecision: 'HUMAN_REVIEW',
    approvalRequired: false,
    semanticTokens: [
      'promotion', 'career growth', 'career advancement', 'role change',
      'appraisal', 'performance review', 'salary hike', 'raise', 'increment',
      'designation change', 'promotion query', 'promotion process',
      'career path', 'internal job posting', 'career opportunity',
    ],
    phraseExamples: [
      'I would like to inquire about my promotion.',
      'When is the next performance appraisal?',
      'I want to discuss my career growth.',
      'I would like to apply for an internal job posting.',
      'Can I request a role change?',
      'I have been with the company for two years and would like to discuss a promotion.',
    ],
    negativeExclusions: [
      'software', 'server', 'network', 'laptop', 'system', 'complaint',
      'discrimination', 'harassment', 'misconduct',
      // TC019: salary not updated after increment → route to salary discrepancy, NOT promotion
      'increment not updated', 'salary not updated after', 'salary still old',
      'still receiving old salary', 'increment not reflected', 'not reflected in salary',
    ],
  },

  {
    id: 'hr.lifecycle.manager_change',
    intent: 'Manager Change Request',
    department: 'HR',
    subteam: 'HR Support',
    defaultPriority: 'low',
    defaultRisk: 'Low',
    defaultDecision: 'HUMAN_REVIEW',
    approvalRequired: false,
    semanticTokens: [
      'manager change', 'change my manager', 'new manager', 'reporting manager',
      'reporting line change', 'change reporting structure', 'manager update',
      'new reporting manager',
    ],
    phraseExamples: [
      'I need to update my reporting manager in the system.',
      'My manager has changed — how do I update this?',
      'Can you change my reporting manager to the new person?',
    ],
    negativeExclusions: ['software', 'server', 'network', 'laptop'],
  },

  {
    id: 'hr.profile.update',
    intent: 'Employee Information / Profile Update',
    department: 'HR',
    subteam: 'HR Support',
    defaultPriority: 'low',
    defaultRisk: 'Low',
    defaultDecision: 'DEPARTMENT_PROCESSING',
    approvalRequired: false,
    semanticTokens: [
      'update my details', 'update personal details', 'update profile',
      'change address', 'update contact', 'bank details update', 'change bank account',
      'update emergency contact', 'personal information update', 'employee record update',
      'update my information', 'change my details',
      'bank account update', 'update salary account', 'salary account details',
      'change my bank account', 'update bank account', 'new bank account',
      'update payroll account', 'change account details', 'update account number',
    ],
    phraseExamples: [
      'I need to update my personal details in the HR system.',
      'How do I change my bank account details?',
      'I need to update my address in my employee profile.',
      'Can I update my emergency contact information?',
      'I need to change my contact number in the records.',
      'I have changed my bank account and need to update my salary account details.',
      'My new bank account number needs to be updated in payroll.',
    ],
    negativeExclusions: ['software', 'server', 'network', 'laptop', 'email'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // HR — RELATIONS / GRIEVANCE (5 intents)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'hr.relations.harassment',
    intent: 'Workplace Harassment Complaint',
    department: 'HR',
    subteam: 'Employee Relations',
    defaultPriority: 'critical',
    defaultRisk: 'Critical',
    defaultDecision: 'ESCALATE',
    approvalRequired: false,
    semanticTokens: [
      'harassment', 'harassing', 'harassed', 'bullying', 'bully', 'bullied',
      'inappropriate behavior', 'workplace misconduct', 'hostile behavior', 'misconduct',
      'hostile work environment', 'sexual harassment', 'discrimination', 'discriminatory',
      'retaliation', 'intimidation', 'abusive behavior', 'hostile colleague',
      'hostile manager', 'uncomfortable workplace', 'manager harassing',
      'discrimination complaint', 'workplace discrimination', 'workplace complaint',
      'file a complaint', 'reporting misconduct', 'raise misconduct',
      'verbally abusive', 'abusive manager', 'manager is abusive',
      'been bullying me', 'bullying me', 'bullying in front of colleagues',
      'discriminatory comments', 'discriminated against',
    ],
    phraseExamples: [
      'I would like to file a workplace harassment complaint.',
      'My manager has been harassing me repeatedly.',
      'I am experiencing bullying from a colleague.',
      'I want to report inappropriate behavior at work.',
      'I am being discriminated against because of my religion.',
      'I feel I am being retaliated against for raising concerns.',
      'My colleague is creating a hostile work environment.',
      'I need to report sexual harassment at the workplace.',
      'I want to raise a formal misconduct complaint.',
      'I am being subjected to unwanted behavior by my manager.',
    ],
    negativeExclusions: ['software', 'server', 'network', 'laptop', 'system'],
  },

  {
    id: 'hr.relations.grievance',
    intent: 'Employee Grievance',
    department: 'HR',
    subteam: 'Employee Relations',
    defaultPriority: 'high',
    defaultRisk: 'High',
    defaultDecision: 'ESCALATE',
    approvalRequired: false,
    semanticTokens: [
      'grievance', 'formal complaint', 'raise a complaint', 'employee complaint',
      'unfair treatment', 'workplace complaint', 'raise concern', 'raise a concern',
      'HR complaint', 'employment complaint', 'workplace issue complaint',
    ],
    phraseExamples: [
      'I want to raise a formal grievance.',
      'I feel I have been treated unfairly at work.',
      'I need to file a formal complaint about my working conditions.',
      'I want to raise a concern about my employment.',
      'I am raising a formal grievance about my team.',
    ],
    negativeExclusions: ['software', 'server', 'network', 'laptop'],
  },

  {
    id: 'hr.relations.performance',
    intent: 'Performance Concern',
    department: 'HR',
    subteam: 'Employee Relations',
    defaultPriority: 'medium',
    defaultRisk: 'Medium',
    defaultDecision: 'HUMAN_REVIEW',
    approvalRequired: false,
    semanticTokens: [
      'performance concern', 'performance improvement', 'pip', 'performance issue',
      'performance review query', 'performance rating', 'low performance rating',
      'performance management', 'performance feedback', 'poor performance review',
    ],
    phraseExamples: [
      'I have concerns about my performance rating.',
      'I want to discuss my performance improvement plan.',
      'I received a poor performance review and want to appeal.',
      'I need help understanding my performance evaluation.',
    ],
    negativeExclusions: ['software', 'server', 'network', 'laptop', 'system performance'],
  },

  {
    id: 'hr.relations.disability',
    intent: 'Disability / Workplace Accommodation Request',
    department: 'HR',
    subteam: 'Employee Relations',
    defaultPriority: 'high',
    defaultRisk: 'High',
    defaultDecision: 'HUMAN_REVIEW',
    approvalRequired: false,
    semanticTokens: [
      'disability', 'accommodation', 'workplace accommodation', 'disability support',
      'accessibility', 'medical accommodation', 'health accommodation',
      'special needs', 'disability adjustment', 'reasonable adjustment',
    ],
    phraseExamples: [
      'I need a workplace accommodation for my disability.',
      'I require reasonable adjustments for my health condition.',
      'I need accessibility support at work.',
      'I have a disability and need workplace support.',
    ],
    negativeExclusions: ['software', 'server', 'network', 'laptop'],
  },

  {
    id: 'hr.policy.query',
    intent: 'HR Policy Query',
    department: 'HR',
    subteam: 'HR Support',
    defaultPriority: 'low',
    defaultRisk: 'Low',
    defaultDecision: 'AUTO_RESOLVE',
    approvalRequired: false,
    semanticTokens: [
      'hr policy', 'company policy', 'leave policy', 'attendance policy',
      'policy question', 'policy query', 'hr rules', 'hr guidelines',
      'employee handbook', 'company handbook', 'hr procedure',
      'how many leave days', 'leave entitlement', 'hr benefit',
      'leave balance', 'annual leave balance', 'current leave balance',
      'how many annual leave', 'leave days remaining', 'annual leave days remaining',
      'leave days left', 'company policy on remote working', 'policy on remote work',
      'remote work policy', 'restrictions on working from home',
      'official company policy', 'official policy on remote', 'official policy on working',
      'company policy on remote work', 'how many days per week can i work from home',
      'restrictions on how many days', 'understand the policy', 'policy clarification',
      'hr question', 'company leave policy', 'work from home policy',
      'policy on leave', 'leave rules', 'wfh days allowed', 'remote policy',
      'how many days wfh', 'number of wfh days', 'hr policy query',
      'promotion letter', 'increment letter', 'appraisal schedule', 'promotion process',
      'office relocation benefits', 'company policy on wfh', 'flexible working policy',
      'leave encashment', 'encash leave', 'leave carryover', 'carry over leave',
      'unused leave', 'unused annual leave', 'leave balance carryover',
      'annual leave carryover', 'leave rollover', 'forfeit leave',
    ],
    phraseExamples: [
      'What is the company leave policy?',
      'How many annual leave days am I entitled to?',
      'What is the attendance policy?',
      'Can you share the employee handbook?',
      'What are the HR guidelines for expense claims?',
      'What is the company policy on WFH?',
      'Can you please tell me my current leave balance?',
      'How many annual leave days do I have remaining?',
      'What is the official company policy on remote working?',
    ],
    negativeExclusions: [
      'software', 'server', 'network', 'laptop', 'application',
      'work from home request', 'work from home approval', 'wfh request',
      'permission to work from home', 'request to work from home',
      // TC059: portal access+auth issues → SharePoint/IT, not HR Policy
      'authentication error', 'cannot log into the portal', 'portal not working',
      'unable to log into', 'cannot access the portal', 'portal error',
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // HR — BENEFITS (3 intents)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'hr.benefits.insurance',
    intent: 'Insurance / Medical Benefits Query',
    department: 'HR',
    subteam: 'Benefits',
    defaultPriority: 'medium',
    defaultRisk: 'Medium',
    defaultDecision: 'HUMAN_REVIEW',
    approvalRequired: false,
    semanticTokens: [
      'insurance', 'medical insurance', 'health insurance', 'medical claim',
      'health claim', 'hospital bills', 'insurance coverage', 'health benefits',
      'medical benefits', 'insurance card', 'mediclaim', 'group insurance',
      'health policy', 'insurance query', 'claim reimbursement', 'cashless treatment',
    ],
    phraseExamples: [
      'I need help with my medical insurance claim.',
      'How do I submit a health insurance claim?',
      'What is covered under my health insurance?',
      'I need my insurance card details.',
      'I was hospitalized and need to claim medical insurance.',
      'Can you help me with my mediclaim process?',
    ],
    negativeExclusions: ['software', 'server', 'network', 'laptop', 'system'],
  },

  {
    id: 'hr.benefits.pension',
    intent: 'Pension / Provident Fund Query',
    department: 'HR',
    subteam: 'Benefits',
    defaultPriority: 'low',
    defaultRisk: 'Low',
    defaultDecision: 'HUMAN_REVIEW',
    approvalRequired: false,
    semanticTokens: [
      'pension', 'provident fund', 'pf', 'epf', 'retirement benefit',
      'gratuity', 'pf withdrawal', 'pf balance', 'pension query',
      'retirement fund', 'superannuation',
    ],
    phraseExamples: [
      'How do I check my provident fund balance?',
      'I need help with my PF withdrawal.',
      'What is my pension contribution?',
      'Can I check my EPF balance?',
    ],
    negativeExclusions: ['software', 'server', 'network', 'laptop'],
  },

  {
    id: 'hr.benefits.general',
    intent: 'Employee Benefits Query',
    department: 'HR',
    subteam: 'Benefits',
    defaultPriority: 'low',
    defaultRisk: 'Low',
    defaultDecision: 'AUTO_RESOLVE',
    approvalRequired: false,
    semanticTokens: [
      'benefits', 'employee benefits', 'perks', 'company benefits',
      'benefit query', 'benefit information', 'what benefits do i have',
      'employee perks', 'compensation benefits', 'benefit package',
    ],
    phraseExamples: [
      'What employee benefits am I entitled to?',
      'Can you explain the company benefits package?',
      'What perks does the company offer?',
    ],
    negativeExclusions: ['software', 'server', 'network', 'laptop'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // IT — HARDWARE (9 intents)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'it.hardware.laptop',
    intent: 'Hardware / Laptop Issue',
    department: 'IT',
    subteam: 'End User Support',
    defaultPriority: 'high',
    defaultRisk: 'High',
    defaultDecision: 'DEPARTMENT_PROCESSING',
    approvalRequired: false,
    semanticTokens: [
      'laptop', 'notebook', 'work laptop', 'company laptop', 'company notebook',
      'laptop issue', 'laptop not working', 'laptop problem', 'laptop broken',
      'laptop crashed', 'laptop screen', 'laptop battery', 'laptop keyboard',
      'laptop slow', 'laptop overheating', 'laptop frozen', 'laptop black screen',
    ],
    phraseExamples: [
      'My laptop is not working.',
      'My work laptop screen is cracked.',
      'My company laptop will not start.',
      'My laptop is running very slowly.',
      'My laptop keeps crashing.',
      'My laptop screen has gone black.',
      'My laptop battery is not charging.',
      'My notebook keyboard is not responding.',
      'My work laptop is showing a blue screen.',
      'The company laptop I received is faulty.',
    ],
    // NOTE: 'pto' MUST NOT match inside 'laptop' — enforced by word-boundary engine
    negativeExclusions: [
      'leave', 'time off', 'vacation', 'absence', 'pto request',
      'refusing to boot', 'will not boot', 'wont boot', 'cannot boot',
      'press the power button and nothing happens', 'power button nothing',
      'not turning on', 'will not turn on',
    ],
  },

  {
    id: 'it.hardware.desktop',
    intent: 'Desktop / Computer Issue',
    department: 'IT',
    subteam: 'End User Support',
    defaultPriority: 'high',
    defaultRisk: 'Medium',
    defaultDecision: 'DEPARTMENT_PROCESSING',
    approvalRequired: false,
    semanticTokens: [
      'desktop', 'desktop computer', 'workstation computer', 'office computer',
      'desktop not working', 'computer not working', 'desktop issue',
      'desktop crashed', 'desktop slow', 'computer problem',
    ],
    phraseExamples: [
      'My desktop computer is not turning on.',
      'My workstation has stopped working.',
      'My office computer is very slow.',
      'My desktop is showing errors.',
    ],
    negativeExclusions: ['leave', 'vacation', 'salary', 'payroll', 'vpn'],
  },

  {
    id: 'it.hardware.nopower',
    intent: 'Device Not Turning On',
    department: 'IT',
    subteam: 'End User Support',
    defaultPriority: 'high',
    defaultRisk: 'High',
    defaultDecision: 'DEPARTMENT_PROCESSING',
    approvalRequired: false,
    semanticTokens: [
      'not turning on', 'will not turn on', 'not starting', 'will not start',
      'not powering on', 'dead', 'no power', 'black screen', 'blank screen',
      'will not boot', 'does not boot', 'boot failure', 'power issue',
      'refusing to boot', 'refuses to boot', 'cannot boot', 'wont boot', 'will not boot up',
      'laptop refusing to boot', 'laptop will not boot', 'computer refusing to boot',
      'press the power button and nothing happens', 'nothing happens when i press power',
      'power button nothing happens', 'press power nothing', 'hold power button',
    ],
    phraseExamples: [
      'My laptop will not turn on.',
      'My computer is not starting.',
      'My device shows a black screen and will not power on.',
      'My laptop is completely dead — no power.',
      'My computer will not boot up.',
      'My device has no power and won\'t turn on.',
    ],
    negativeExclusions: ['leave', 'vacation', 'salary', 'payroll'],
  },

  {
    id: 'it.hardware.monitor',
    intent: 'Monitor / Display Issue',
    department: 'IT',
    subteam: 'End User Support',
    defaultPriority: 'medium',
    defaultRisk: 'Low',
    defaultDecision: 'DEPARTMENT_PROCESSING',
    approvalRequired: false,
    semanticTokens: [
      'monitor', 'display', 'screen', 'external monitor', 'monitor not working',
      'monitor issue', 'display issue', 'flickering screen', 'no display',
      'dual monitor', 'monitor resolution', 'need a monitor', 'new monitor',
    ],
    phraseExamples: [
      'My monitor is not working.',
      'My display is flickering.',
      'I need an additional monitor for my workstation.',
      'The external monitor is not being detected.',
      'My screen has dead pixels.',
    ],
    negativeExclusions: ['leave', 'vacation', 'salary', 'payroll', 'vpn', 'password'],
  },

  {
    id: 'it.hardware.peripheral',
    intent: 'Keyboard / Mouse / Peripheral Issue',
    department: 'IT',
    subteam: 'End User Support',
    defaultPriority: 'medium',
    defaultRisk: 'Low',
    defaultDecision: 'DEPARTMENT_PROCESSING',
    approvalRequired: false,
    semanticTokens: [
      'keyboard', 'mouse', 'peripheral', 'keyboard not working', 'mouse not working',
      'keyboard issue', 'mouse issue', 'usb device', 'usb not working',
      'headset', 'webcam', 'speaker', 'microphone', 'docking station', 'dock',
      'laptop webcam', 'webcam not working', 'webcam not detected', 'camera not detected',
      'camera not showing', 'laptop camera', 'laptop microphone',
      'replacement mouse', 'replacement keyboard',
      'wireless mouse', 'mouse stopped working', 'mouse not responding',
      'webcam not working for video calls', 'webcam shows black screen',
      'camera not working during calls', 'camera not showing in teams',
    ],
    phraseExamples: [
      'My keyboard is not working.',
      'My mouse is not responding.',
      'My USB keyboard is not being detected.',
      'I need a replacement mouse.',
      'My headset is not working with my laptop.',
      'My docking station is not connecting properly.',
      'My laptop webcam is not being detected by Teams or Zoom.',
      'My camera is not working during video calls.',
    ],
    negativeExclusions: ['leave', 'vacation', 'salary', 'payroll'],
  },

  {
    id: 'it.hardware.printer',
    intent: 'Printer / Peripheral Issue',
    department: 'IT',
    subteam: 'End User Support',
    defaultPriority: 'medium',
    defaultRisk: 'Low',
    defaultDecision: 'DEPARTMENT_PROCESSING',
    approvalRequired: false,
    semanticTokens: [
      'printer', 'printing', 'print', 'printer not working', 'cannot print',
      'printer issue', 'printer error', 'scanner', 'scanning', 'scan issue',
      'printer offline', 'printer driver',
    ],
    phraseExamples: [
      'My printer is not working.',
      'I cannot print from my laptop.',
      'The office printer is showing an error.',
      'The printer is offline.',
      'I need to install a printer driver.',
    ],
    negativeExclusions: ['leave', 'vacation', 'salary', 'payroll', 'vpn'],
  },

  {
    id: 'it.hardware.mobile',
    intent: 'Mobile Device Issue',
    department: 'IT',
    subteam: 'End User Support',
    defaultPriority: 'medium',
    defaultRisk: 'Medium',
    defaultDecision: 'DEPARTMENT_PROCESSING',
    approvalRequired: false,
    semanticTokens: [
      'mobile', 'mobile device', 'company phone', 'work phone', 'smartphone',
      'tablet', 'ipad', 'mobile issue', 'phone not working', 'company mobile',
      'corporate mobile', 'mobile data', 'mobile configuration',
    ],
    phraseExamples: [
      'My company mobile phone is not working.',
      'I need help setting up my corporate mobile device.',
      'My work phone has stopped receiving emails.',
      'My tablet needs to be replaced.',
    ],
    negativeExclusions: ['leave', 'vacation', 'salary', 'payroll'],
  },

  {
    id: 'it.hardware.replacement',
    intent: 'Hardware Replacement / IT Asset Request',
    department: 'IT',
    subteam: 'Software & Assets',
    defaultPriority: 'medium',
    defaultRisk: 'Low',
    defaultDecision: 'APPROVAL_REQUIRED',
    approvalRequired: true,
    semanticTokens: [
      'replacement laptop', 'new laptop', 'need a laptop', 'request laptop',
      'new device', 'device replacement', 'hardware replacement', 'asset request',
      'it asset', 'new equipment', 'equipment request', 'new keyboard',
      'new mouse', 'replace hardware', 'laptop allocation',
    ],
    phraseExamples: [
      'I need a replacement laptop.',
      'Can I request a new laptop for my role?',
      'My device needs to be replaced.',
      'I need to request a hardware asset.',
      'I need a new laptop as a new employee.',
    ],
    negativeExclusions: ['leave', 'vacation', 'salary', 'payroll', 'vpn'],
  },

  {
    id: 'it.hardware.newsetup',
    intent: 'New Employee IT Setup',
    department: 'IT',
    subteam: 'End User Support',
    defaultPriority: 'high',
    defaultRisk: 'Low',
    defaultDecision: 'DEPARTMENT_PROCESSING',
    approvalRequired: false,
    semanticTokens: [
      'new employee setup', 'new joiner setup', 'it setup', 'account setup',
      'new user setup', 'set up my accounts', 'set up my computer',
      'new starter setup', 'provisioning', 'new hire it',
    ],
    phraseExamples: [
      'I just joined and need my IT accounts set up.',
      'Can you help me set up my computer as a new employee?',
      'I am a new joiner and need my email and system access configured.',
    ],
    negativeExclusions: ['leave', 'vacation', 'salary'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // IT — NETWORK / CONNECTIVITY (6 intents)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'it.network.wifi',
    intent: 'Network / WiFi Issue', // WiFi / internet connectivity
    department: 'IT',
    subteam: 'Network Operations',
    defaultPriority: 'medium',
    defaultRisk: 'Low',
    defaultDecision: 'DEPARTMENT_PROCESSING',
    approvalRequired: false,
    semanticTokens: [
      'wifi', 'wi-fi', 'wireless', 'wireless network', 'internet connection',
      'office network', 'network disconnecting', 'internet not working',
      'no internet', 'connectivity issue', 'cannot browse', 'internet slow',
      'wifi keeps disconnecting', 'wifi drops', 'wifi not connecting',
      'wireless not working', 'wifi signal', 'wi-fi signal', 'wireless signal',
      'signal weak', 'access point', 'signal strength', 'wifi signal weak', 'weak signal',
      'ethernet cable connected', 'internet connectivity at my workstation',
      'office wireless network keeps disconnecting', 'wireless network drops',
      'no internet connectivity', 'no internet at my desk', 'internet not working at my desk',
      'cannot access internet at desk', 'internet at my workstation',
      'wifi at my workstation', 'wifi at my desk', 'signal at my desk',
      'cannot access any websites', 'cannot access any internal applications from desk',
      'wi-fi signal at my workstation', 'wifi signal at my workstation',
      'wifi signal at my desk', 'no internet connectivity at my workstation',
      'internet not working at workstation', 'no internet at workstation',
      'no network connectivity at my workstation', 'not getting any network',
      'no internet connectivity', 'have no internet connectivity',
      'internet connectivity at workstation', 'workstation internet connectivity',
    ],
    phraseExamples: [
      'The WiFi in the office keeps disconnecting.',
      'I cannot connect to the office wireless network.',
      'The internet is not working at my desk.',
      'WiFi keeps dropping every few minutes.',
      'I have no internet connectivity at the office.',
      'The office network is very slow today.',
      'Wireless network is not working.',
      'I cannot browse the internet from my workstation.',
      'The WiFi signal is too weak at my desk.',
      'Office internet connection is unstable.',
      'I have no internet connectivity at my workstation.',
      'The office wireless network keeps disconnecting.',
    ],
    negativeExclusions: [
      'vpn', 'remote access', 'work from home', 'connect from home',
      'leave', 'vacation', 'salary',
      'company network from home', 'corporate network from home',
    ],
  },

  {
    id: 'it.network.vpn',
    intent: 'VPN / Remote Access Issue',
    department: 'IT',
    subteam: 'Network Operations',
    defaultPriority: 'high',
    defaultRisk: 'Medium',
    defaultDecision: 'DEPARTMENT_PROCESSING',
    approvalRequired: false,
    semanticTokens: [
      'vpn', 'virtual private network', 'remote access', 'remote connection',
      'connect from home', 'work from home connection', 'company network from home',
      'secure remote', 'remote login', 'remote desktop', 'cannot access internal network',
      'internal network remotely', 'remote vpn', 'vpn client', 'cisco vpn',
      'global protect', 'vpn not working', 'vpn keeps disconnecting', 'vpn error',
      'cannot connect to vpn', 'vpn authentication', 'vpn connection failed',
      'company internal network', 'connection to the company network',
      'establish connection to company', 'connect to corporate network from home',
      'corporate network remotely', 'cannot connect to corporate network',
      'cannot establish a connection to the company', 'connection to the company internal network',
      'corporate network from my home', 'connect to the company internal network',
      'establish a connection to the company', 'company network from my home office',
      'internal network from home', 'internal file server from home',
      'vpn client software', 'vpn client installation', 'vpn client not installed',
      'vpn did not install', 'install vpn client', 'vpn install error', 'vpn installation',
    ],
    phraseExamples: [
      'My VPN is not working.',
      'I cannot connect to the VPN from home.',
      'VPN keeps disconnecting.',
      'I cannot establish a VPN connection.',
      'Remote access is not working.',
      'I cannot connect to the corporate network from home.',
      'The VPN client is showing an error.',
      'My VPN keeps failing when I try to work remotely.',
      'I cannot access the internal network from my home.',
      'VPN authentication is failing.',
      'I cannot establish a connection to the company internal network.',
    ],
    negativeExclusions: [
      'leave', 'vacation', 'salary', 'work from home request', 'wfh approval',
      // TC040: "new laptop but VPN not installed" — laptop is the device context, NOT a collision
      // VPN tokens must win when VPN explicitly mentioned alongside laptop
    ],
  },

  {
    id: 'it.network.internet',
    intent: 'Internet Connectivity Issue',
    department: 'IT',
    subteam: 'Network Operations',
    defaultPriority: 'high',
    defaultRisk: 'Medium',
    defaultDecision: 'DEPARTMENT_PROCESSING',
    approvalRequired: false,
    // NOTE: This is for BUILDING-WIDE or ISP-level internet outages.
    // Individual workstation connectivity issues → it.network.wifi
    semanticTokens: [
      'internet down', 'internet outage', 'wan issue',
      'internet service', 'isp issue', 'broadband issue',
      'no one in the building has internet', 'entire office no internet',
      'building-wide internet outage', 'whole office internet down',
    ],
    phraseExamples: [
      'There is a complete internet outage in the office.',
      'No one in the building has internet access.',
      'The internet has been down for the past hour.',
      'We have a network outage affecting the whole floor.',
    ],
    negativeExclusions: [
      'vpn', 'remote access', 'leave', 'vacation', 'salary',
      'at my workstation', 'at my desk', 'my workstation', 'my desk',
      'ethernet cable connected', 'ethernet cable is connected',
    ],
  },

  {
    id: 'it.network.lan',
    intent: 'LAN / Wired Network Issue',
    department: 'IT',
    subteam: 'Network Operations',
    defaultPriority: 'medium',
    defaultRisk: 'Low',
    defaultDecision: 'DEPARTMENT_PROCESSING',
    approvalRequired: false,
    semanticTokens: [
      'lan', 'ethernet', 'wired network', 'network cable', 'ethernet cable',
      'network port', 'wired connection', 'local area network', 'switch',
      'network switch', 'patch cable', 'wired not working',
    ],
    phraseExamples: [
      'My wired ethernet connection is not working.',
      'The network cable at my desk is not connecting.',
      'My LAN connection keeps dropping.',
      'The network port at my desk does not work.',
    ],
    negativeExclusions: ['vpn', 'leave', 'vacation', 'salary'],
  },

  {
    id: 'it.network.general',
    intent: 'Network General Issue',
    department: 'IT',
    subteam: 'Network Operations',
    defaultPriority: 'medium',
    defaultRisk: 'Medium',
    defaultDecision: 'DEPARTMENT_PROCESSING',
    approvalRequired: false,
    // NOTE: This is the GENERIC network fallback — WiFi, VPN, Outage all take priority.
    // Only use tokens that don't appear in more specific network intents.
    semanticTokens: [
      'network issue', 'network problem', 'connectivity problem',
      'experiencing network issues', 'network access problem',
    ],
    phraseExamples: [
      'I am experiencing network issues.',
      'The network is very slow.',
      'I cannot access the company network.',
    ],
    negativeExclusions: [
      'vpn', 'wifi', 'wi-fi', 'wireless', 'leave', 'vacation', 'salary',
      'network outage', 'entire floor', 'all employees', 'nobody can access',
      'lost network connectivity', 'company-wide', 'production down',
    ],
  },

  {
    id: 'it.network.outage',
    intent: 'Network / System Outage',
    department: 'IT',
    subteam: 'Infrastructure',
    defaultPriority: 'critical',
    defaultRisk: 'Critical',
    defaultDecision: 'ESCALATE',
    approvalRequired: false,
    semanticTokens: [
      'outage', 'system down', 'service down', 'server down', 'complete outage',
      'production down', 'entire office', 'all users', 'network outage',
      'company-wide outage', 'multiple users affected', 'all employees affected',
      'entire floor', 'lost network connectivity', 'floor has lost network',
      'nobody can access', 'all work has stopped', 'production server down',
      'customer-facing applications unavailable', 'all users cannot access',
      'floor lost internet', 'entire department down',
      'entire 4th floor', 'entire floor has lost', 'nobody on this floor',
      'affecting around 50 employees', '50 employees', 'all employees on this floor',
      'complete loss of network', 'connectivity on the floor',
      'database server is unreachable', 'production database unreachable',
      'database unreachable', 'database server down', 'all applications down',
      'all business applications down', 'applications relying on this database',
      'production database server is unreachable', 'database is unreachable',
      'applications that rely on this database are down',
      'affecting all users across the organization', 'critical incident affecting all',
    ],
    phraseExamples: [
      'There is a company-wide system outage.',
      'All users in the office cannot access any systems.',
      'Production is down and affecting all employees.',
      'The server is down and nobody can work.',
      'Complete network outage across all offices.',
      'The entire 4th floor has lost network connectivity.',
      'Our production server has gone down completely.',
      'All customer-facing applications are unavailable.',
    ],
    negativeExclusions: ['leave', 'vacation', 'salary', 'emergency leave'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // IT — ACCESS / AUTHENTICATION (6 intents)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'it.access.password',
    intent: 'Password Reset',
    department: 'IT',
    subteam: 'Identity & Access Management',
    defaultPriority: 'high',
    defaultRisk: 'Medium',
    defaultDecision: 'DEPARTMENT_PROCESSING',
    approvalRequired: false,
    semanticTokens: [
      'password', 'password reset', 'forgot password', 'reset my password',
      'password expired', 'change password', 'password not working',
      'cannot login', 'cannot log in', 'login failed', 'credentials',
      'username and password', 'domain password',
    ],
    phraseExamples: [
      'I forgot my password and cannot log in.',
      'My password has expired and I need to reset it.',
      'I need to reset my Windows password.',
      'I cannot log into my computer — password issue.',
      'My login credentials are not working.',
      'I need help resetting my domain account password.',
      'My account password needs to be changed.',
    ],
    negativeExclusions: [
      'leave', 'vacation', 'salary', 'sap password',
      // TC088/TC149: phishing context where credentials were entered → route to Phishing, not Password Reset
      'phishing', 'phishing email', 'suspicious link', 'fake email', 'phishing attempt',
      'realized it was fake', 'i think was a phishing', 'now think was a phishing',
      'suspicious email and entered', 'now realize it was phishing',
    ],
  },

  {
    id: 'it.access.lockout',
    intent: 'Account Lockout',
    department: 'IT',
    subteam: 'Identity & Access Management',
    defaultPriority: 'high',
    defaultRisk: 'Medium',
    defaultDecision: 'DEPARTMENT_PROCESSING',
    approvalRequired: false,
    semanticTokens: [
      'account locked', 'locked out', 'account lockout', 'login locked',
      'too many failed attempts', 'account blocked', 'account disabled',
      'account suspended', 'unable to log in due to lockout',
      'authentication failed', 'login keeps failing', 'login failing',
      'cannot log in to applications', 'all applications failing',
      'cannot log into company applications', 'multiple application login failure',
      'entered password incorrectly', 'account is now locked', 'please unlock',
      'entered wrong password', 'wrong password multiple times',
      'account locked after', 'locked after wrong password',
    ],
    phraseExamples: [
      'My account has been locked.',
      'I am locked out of my account.',
      'I entered the wrong password too many times and my account is now locked.',
      'My Windows account has been disabled.',
      'I cannot log in — account is locked.',
      'I keep getting authentication failed when trying to log in to company applications.',
    ],
    negativeExclusions: ['leave', 'vacation', 'salary', 'sap'],
  },

  {
    id: 'it.access.mfa',
    intent: 'MFA / Two-Factor Authentication Issue',
    department: 'IT',
    subteam: 'Identity & Access Management',
    defaultPriority: 'high',
    defaultRisk: 'Medium',
    defaultDecision: 'DEPARTMENT_PROCESSING',
    approvalRequired: false,
    semanticTokens: [
      'mfa', 'multi factor', 'two factor', 'two-factor', '2fa', 'authenticator',
      'authenticator app', 'google authenticator', 'microsoft authenticator',
      'one time password', 'verification code', 'mfa reset', 'mfa not working',
      'authenticator not generating code', 'lost authenticator', 'new phone mfa',
    ],
    phraseExamples: [
      'My MFA authenticator is not working.',
      'I got a new phone and lost my MFA codes.',
      'I need to reset my two-factor authentication.',
      'The authenticator app is not generating codes.',
      'I cannot log in because MFA is not working.',
      'I need help with my 2FA setup.',
      'My Microsoft Authenticator is not syncing.',
    ],
    negativeExclusions: ['leave', 'vacation', 'salary', 'sap'],
  },

  {
    id: 'it.access.shared',
    intent: 'Shared Drive / File Server Access',
    department: 'IT',
    subteam: 'Identity & Access Management',
    defaultPriority: 'medium',
    defaultRisk: 'Medium',
    defaultDecision: 'APPROVAL_REQUIRED',
    approvalRequired: true,
    semanticTokens: [
      'shared drive', 'file server', 'shared folder', 'network drive',
      'shared storage', 'cannot access shared', 'file share access',
      'sharepoint', 'onedrive', 'google drive access', 'shared resource',
      'shared folder access', 'drive access', 'file access',
      'shared marketing drive', 'shared finance folder', 'shared team drive',
      'access to the shared', 'cannot access the shared drive',
      'access denied to drive', 'access to shared folder',
    ],
    phraseExamples: [
      'I cannot access the shared drive.',
      'I need access to the marketing shared folder.',
      'Can you grant me access to the file server?',
      'I cannot access SharePoint.',
      'I need OneDrive access for my project.',
      'I cannot access the shared marketing drive.',
    ],
    negativeExclusions: ['leave', 'vacation', 'salary', 'sap access'],
  },

  {
    id: 'it.access.cloud',
    intent: 'Cloud / SaaS Application Access',
    department: 'IT',
    subteam: 'Identity & Access Management',
    defaultPriority: 'medium',
    defaultRisk: 'Medium',
    defaultDecision: 'APPROVAL_REQUIRED',
    approvalRequired: true,
    semanticTokens: [
      'cloud access', 'saas application', 'cloud application', 'application access',
      'azure access', 'aws access', 'google cloud', 'salesforce', 'servicenow',
      'jira access', 'confluence', 'office 365', 'microsoft 365', 'cloud portal',
      'portal access', 'web application access', 'cannot access application',
      'azure devops', 'devops access', 'azure', 'devops project',
      'access to our azure', 'development platform', 'access to jira',
    ],
    phraseExamples: [
      'I cannot access the cloud application.',
      'I need access to Salesforce.',
      'Can you give me access to the company portal?',
      'I need access to Jira for my project.',
      'My Microsoft 365 account is not working.',
      'I need access to our Azure DevOps project.',
    ],
    negativeExclusions: ['leave', 'vacation', 'salary', 'sap', 'finance portal'],
  },

  {
    id: 'it.access.database',
    intent: 'Database Access Request',
    department: 'IT',
    subteam: 'Infrastructure',
    defaultPriority: 'medium',
    defaultRisk: 'High',
    defaultDecision: 'APPROVAL_REQUIRED',
    approvalRequired: true,
    semanticTokens: [
      'database access', 'database', 'db access', 'sql access', 'oracle access',
      'database permission', 'database query access', 'production database',
      'dev database', 'database credentials', 'data warehouse',
    ],
    phraseExamples: [
      'I need access to the production database.',
      'Can I get database credentials for the reporting database?',
      'I need SQL Server access for my project.',
      'I need to request database access for my team.',
    ],
    negativeExclusions: ['leave', 'vacation', 'salary', 'sap', 'finance'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // IT — SOFTWARE (5 intents)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'it.software.install',
    intent: 'Software Installation Request',
    department: 'IT',
    subteam: 'Software & Assets',
    defaultPriority: 'medium',
    defaultRisk: 'Low',
    defaultDecision: 'DEPARTMENT_PROCESSING',
    approvalRequired: false,
    semanticTokens: [
      'install software', 'software installation', 'install application',
      'install app', 'need software installed', 'application installation',
      'install a tool', 'software request', 'install on my laptop', 'deploy software',
      'need installed', 'please install', 'install on my computer',
      'need figma', 'need adobe', 'need design tools installed',
      'please install outlook', 'install outlook on my laptop', 'install outlook',
      'does not have outlook installed', 'laptop does not have outlook',
      'install microsoft office', 'install office', 'install teams',
      'software not installed', 'missing software', 'no software installed',
      'tableau', 'tableau desktop', 'install tableau', 'need tableau',
      'power bi installation', 'install power bi',
    ],
    phraseExamples: [
      'Can you install the design software on my computer?',
      'I need a software application installed.',
      'Please install the required tools on my workstation.',
      'I need software X installed for my project.',
      'My laptop does not have Microsoft Outlook installed — please install it.',
      'I need Figma and Adobe Creative Cloud installed on my laptop.',
    ],
    negativeExclusions: [
      'leave', 'vacation', 'salary', 'sap installation', 'vpn',
      'outlook not working', 'outlook crashing', 'outlook issue', 'outlook error',
      'cannot send email', 'cannot receive email', 'email not working',
      'outlook crash', 'outlook keeps crashing', 'outlook crashes',
    ],
  },

  {
    id: 'it.software.license',
    intent: 'Software License Request',
    department: 'IT',
    subteam: 'Software & Assets',
    defaultPriority: 'medium',
    defaultRisk: 'Low',
    defaultDecision: 'APPROVAL_REQUIRED',
    approvalRequired: true,
    semanticTokens: [
      'software license', 'license request', 'license key', 'license expired',
      'license renewal', 'software subscription', 'adobe license', 'office license',
      'microsoft license', 'license allocation', 'need a license',
      'adobe acrobat', 'acrobat license', 'adobe acrobat pro', 'acrobat pro license',
      'allocate a license', 'license for my role', 'need license for',
      'software license for', 'pdf editor license', 'pro license',
      'figma license', 'design tool license', 'additional license',
      'license count maxed', 'procure a license', 'license for design',
      'design software license',
    ],
    phraseExamples: [
      'I need a software license for Adobe Acrobat.',
      'My license has expired — I need a renewal.',
      'Can I get a Microsoft Office license?',
      'I need a license key for the design tool.',
      'I need an Adobe Acrobat Pro license for my role.',
      'Could you please allocate a license to me for Adobe?',
    ],
    negativeExclusions: ['leave', 'vacation', 'salary', 'sap'],
  },

  {
    id: 'it.software.crash',
    intent: 'Application Crash / Software Error',
    department: 'IT',
    subteam: 'End User Support',
    defaultPriority: 'high',
    defaultRisk: 'Medium',
    defaultDecision: 'DEPARTMENT_PROCESSING',
    approvalRequired: false,
    semanticTokens: [
      'application crash', 'app crash', 'software crash', 'application error',
      'application not working', 'software not working', 'app not responding',
      'application freezing', 'application hanging', 'blue screen', 'bsod',
      'error message', 'keeps crashing', 'software error', 'application issue',
    ],
    phraseExamples: [
      'The application keeps crashing.',
      'My software is not responding.',
      'I am getting an error when I open the application.',
      'The app keeps freezing.',
      'I am getting a blue screen of death.',
      'The software shows an error and closes.',
    ],
    negativeExclusions: ['leave', 'vacation', 'salary', 'sap'],
  },

  {
    id: 'it.software.os',
    intent: 'Operating System Issue',
    department: 'IT',
    subteam: 'End User Support',
    defaultPriority: 'high',
    defaultRisk: 'High',
    defaultDecision: 'DEPARTMENT_PROCESSING',
    approvalRequired: false,
    semanticTokens: [
      'windows', 'operating system', 'os issue', 'windows update', 'os update',
      'windows not working', 'windows error', 'system crash', 'windows reinstall',
      'corrupt os', 'boot loop', 'startup issue',
    ],
    phraseExamples: [
      'Windows keeps crashing on my laptop.',
      'My operating system is showing errors.',
      'Windows Update has broken my computer.',
      'My computer is stuck in a boot loop.',
      'My OS needs to be reinstalled.',
    ],
    negativeExclusions: ['leave', 'vacation', 'salary', 'sap'],
  },

  {
    id: 'it.software.browser',
    intent: 'Browser / Web Application Issue',
    department: 'IT',
    subteam: 'End User Support',
    defaultPriority: 'medium',
    defaultRisk: 'Low',
    defaultDecision: 'DEPARTMENT_PROCESSING',
    approvalRequired: false,
    semanticTokens: [
      'browser', 'chrome', 'edge', 'internet explorer', 'firefox',
      'browser issue', 'browser not working', 'website not loading',
      'web application', 'browser extension', 'browser crash',
    ],
    phraseExamples: [
      'My browser keeps crashing.',
      'Websites are not loading in Chrome.',
      'The web application does not work in my browser.',
      'I need a different browser installed.',
    ],
    negativeExclusions: ['leave', 'vacation', 'salary', 'vpn'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // IT — COLLABORATION (4 intents)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'it.collab.email',
    intent: 'Email / Outlook Issue',
    department: 'IT',
    subteam: 'Collaboration Support',
    defaultPriority: 'high',
    defaultRisk: 'Medium',
    defaultDecision: 'DEPARTMENT_PROCESSING',
    approvalRequired: false,
    semanticTokens: [
      'email', 'outlook', 'mailbox', 'inbox', 'email not working',
      'cannot send email', 'cannot receive email', 'email error', 'mail client',
      'email account', 'shared mailbox', 'distribution list', 'email calendar',
      'outlook not opening', 'outlook crash', 'email delivery issue',
      'outlook keeps crashing', 'outlook crashes immediately',
      'cannot access my email', 'stuck in the outbox', 'outbox stuck',
    ],
    phraseExamples: [
      'My Outlook is not working.',
      'I cannot send emails.',
      'I am not receiving any emails.',
      'My email account is not accessible.',
      'Outlook keeps crashing.',
      'I cannot access my mailbox.',
      'My email calendar is not syncing.',
      'I need access to a shared mailbox.',
    ],
    negativeExclusions: [
      'leave', 'vacation', 'salary', 'password reset',
      'please install outlook', 'install outlook on my laptop', 'install outlook',
      'does not have outlook installed', 'laptop does not have outlook installed',
    ],
  },

  {
    id: 'it.collab.teams',
    intent: 'Teams / Video Conference Issue',
    department: 'IT',
    subteam: 'Collaboration Support',
    defaultPriority: 'high',
    defaultRisk: 'Medium',
    defaultDecision: 'DEPARTMENT_PROCESSING',
    approvalRequired: false,
    semanticTokens: [
      'microsoft teams', 'teams', 'video conference', 'video call', 'zoom',
      'webex', 'google meet', 'teams not working', 'cannot join meeting',
      'audio issue', 'video issue', 'meeting issue', 'collaboration tool',
      'cannot join any video conference', 'teams call', 'zoom call',
      'cannot hear', 'teams keeps crashing', 'call not connecting',
    ],
    phraseExamples: [
      'Microsoft Teams is not working.',
      'I cannot join video conferences.',
      'My microphone is not working in Teams.',
      'The camera is not working during video calls.',
      'I cannot hear anything on the call.',
      'Teams keeps crashing during meetings.',
    ],
    negativeExclusions: ['leave', 'vacation', 'salary', 'password'],
  },

  {
    id: 'it.collab.sharepoint',
    intent: 'SharePoint / Intranet Access',
    department: 'IT',
    subteam: 'Collaboration Support',
    defaultPriority: 'medium',
    defaultRisk: 'Low',
    defaultDecision: 'DEPARTMENT_PROCESSING',
    approvalRequired: false,
    semanticTokens: [
      'sharepoint', 'intranet', 'company portal', 'employee portal',
      'sharepoint site', 'sharepoint access', 'intranet access',
      'internal website', 'company website', 'employee self service',
      'hr self-service portal', 'hr portal', 'self service portal',
      'timesheet portal', 'timesheet submission', 'submit timesheet',
      'timesheet not working', 'timesheet system', 'time entry portal',
      'hr system portal', 'hr online portal',
    ],
    phraseExamples: [
      'I cannot access SharePoint.',
      'The company intranet is not loading.',
      'I need access to a SharePoint site.',
      'The employee portal is not working.',
    ],
    negativeExclusions: ['vacation', 'salary'],
  },

  {
    id: 'it.general',
    intent: 'IT General Support',
    department: 'IT',
    subteam: 'End User Support',
    defaultPriority: 'medium',
    defaultRisk: 'Low',
    defaultDecision: 'DEPARTMENT_PROCESSING',
    approvalRequired: false,
    semanticTokens: [
      'it support', 'technical support', 'it help', 'technical help',
      'it issue', 'technical issue', 'system issue', 'general it',
      'it assistance', 'computer help',
    ],
    phraseExamples: [
      'I need IT support.',
      'I have a general technical issue.',
      'Can IT help me with a computer problem?',
    ],
    negativeExclusions: ['leave', 'vacation', 'salary', 'vpn', 'email', 'password'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SAP / ERP (10 intents)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'sap.access',
    intent: 'SAP / ERP Access Request',
    department: 'Finance',
    subteam: 'SAP Basis',
    defaultPriority: 'medium',
    defaultRisk: 'High',
    defaultDecision: 'APPROVAL_REQUIRED',
    approvalRequired: true,
    semanticTokens: [
      'sap access', 'sap s/4hana', 's/4hana access', 'erp access',
      'sap system access', 'need sap access', 'request sap access',
      'sap user creation', 'sap login access', 'fiori access', 'sap portal access',
      'erp system', 'access to the erp', 'access to erp system', 'erp system access',
      'access to the erp system', 'erp system to approve', 'need erp access',
      'erp system for my role', 'access to our erp', 'provision erp',
    ],
    phraseExamples: [
      'I need access to SAP S/4HANA.',
      'Please create my SAP user account.',
      'I need to request SAP access for my role.',
      'Can I be given access to the ERP system?',
      'I need SAP system access to do my job.',
      'Please provision my SAP login.',
    ],
    negativeExclusions: ['leave', 'vacation', 'salary', 'laptop', 'vpn'],
  },

  {
    id: 'sap.role',
    intent: 'SAP Role / Authorization Request',
    department: 'Finance',
    subteam: 'SAP Security',
    defaultPriority: 'medium',
    defaultRisk: 'High',
    defaultDecision: 'APPROVAL_REQUIRED',
    approvalRequired: true,
    semanticTokens: [
      'sap role', 'sap authorization', 'sap roles', 'sap authorizations',
      'role assignment', 'authorization request', 'sap profile', 'sap permission',
      'add sap role', 'change sap role', 'sap role request',
    ],
    phraseExamples: [
      'I need an additional SAP role assigned to my account.',
      'Can you add the purchasing role to my SAP profile?',
      'I need SAP authorization for the finance module.',
      'My SAP roles need to be updated.',
      'I require additional SAP permissions for my new responsibilities.',
    ],
    negativeExclusions: ['leave', 'vacation', 'laptop', 'vpn', 'email'],
  },

  {
    id: 'sap.login',
    intent: 'SAP Login Issue',
    department: 'Finance',
    subteam: 'SAP Basis',
    defaultPriority: 'high',
    defaultRisk: 'Medium',
    defaultDecision: 'DEPARTMENT_PROCESSING',
    approvalRequired: false,
    semanticTokens: [
      'sap login', 'cannot login to sap', 'sap login issue', 'sap login error',
      'sap login failed', 'sap access denied', 'sap not loading', 'sap locked',
      'sap session', 'sap connection',
      'sap s4 not accessible', 'cannot access sap s4', 'sap s4',
      'sap showing connection error', 'cannot access sap this morning',
      'cannot login to sap', 'sap account locked', 'sap access denied when logging',
      'access denied error when logging into sap', 'account locked in sap',
    ],
    phraseExamples: [
      'I cannot log in to SAP.',
      'SAP login is failing.',
      'My SAP account is locked.',
      'I am getting an access denied error in SAP.',
      'SAP is not loading after I enter my credentials.',
      'I cannot access SAP S4 this morning.',
    ],
    negativeExclusions: ['leave', 'vacation', 'laptop', 'vpn'],
  },

  {
    id: 'sap.password',
    intent: 'SAP Password Reset',
    department: 'Finance',
    subteam: 'SAP Basis',
    defaultPriority: 'high',
    defaultRisk: 'Low',
    defaultDecision: 'DEPARTMENT_PROCESSING',
    approvalRequired: false,
    semanticTokens: [
      'sap password', 'sap password reset', 'reset sap password',
      'forgot sap password', 'sap password expired', 'change sap password',
    ],
    phraseExamples: [
      'I forgot my SAP password.',
      'My SAP password has expired.',
      'I need to reset my SAP password.',
      'Can you reset my SAP login password?',
    ],
    negativeExclusions: ['leave', 'vacation', 'laptop'],
  },

  {
    id: 'sap.finance',
    intent: 'SAP Finance Module Issue',
    department: 'Finance',
    subteam: 'SAP Functional Support',
    defaultPriority: 'high',
    defaultRisk: 'High',
    defaultDecision: 'ESCALATE',
    approvalRequired: false,
    semanticTokens: [
      'sap finance', 'sap fi', 'sap co', 'sap fico', 'finance module',
      'general ledger', 'accounts payable sap', 'accounts receivable sap',
      'sap financial', 'cost center', 'profit center', 'sap fi module',
    ],
    phraseExamples: [
      'The SAP finance module is showing errors.',
      'I cannot post a journal entry in SAP.',
      'SAP FI is not working correctly.',
      'I need help with a SAP FICO issue.',
    ],
    negativeExclusions: ['leave', 'vacation', 'laptop', 'vpn'],
  },

  {
    id: 'sap.hr',
    intent: 'SAP HR Module Issue',
    department: 'Finance',
    subteam: 'SAP Functional Support',
    defaultPriority: 'medium',
    defaultRisk: 'Medium',
    defaultDecision: 'DEPARTMENT_PROCESSING',
    approvalRequired: false,
    semanticTokens: [
      'sap hr', 'sap hcm', 'sap personnel', 'hr module sap',
      'sap payroll module', 'sap time management', 'sap leave management',
    ],
    phraseExamples: [
      'There is an issue with the SAP HR module.',
      'SAP HCM is not working.',
      'I have a problem with SAP payroll processing.',
    ],
    negativeExclusions: ['leave request', 'vacation request', 'salary issue'],
  },

  {
    id: 'sap.procurement',
    intent: 'SAP Procurement Issue',
    department: 'Finance',
    subteam: 'SAP Functional Support',
    defaultPriority: 'high',
    defaultRisk: 'High',
    defaultDecision: 'ESCALATE',
    approvalRequired: false,
    semanticTokens: [
      'sap procurement', 'sap mm', 'sap purchase order', 'purchase requisition',
      'sap vendor', 'sap supplier', 'sap materials management', 'po creation',
      'sap sourcing',
    ],
    phraseExamples: [
      'I cannot create a purchase order in SAP.',
      'SAP procurement module is showing errors.',
      'The purchase requisition is not going through in SAP.',
      'SAP MM is not working for vendor creation.',
    ],
    negativeExclusions: ['leave', 'vacation', 'laptop', 'vpn'],
  },

  {
    id: 'sap.general',
    intent: 'SAP / ERP General Issue',
    department: 'Finance',
    subteam: 'SAP Basis',
    defaultPriority: 'medium',
    defaultRisk: 'Medium',
    defaultDecision: 'DEPARTMENT_PROCESSING',
    approvalRequired: false,
    semanticTokens: [
      'sap issue', 'erp issue', 'sap problem', 'sap error', 'sap not working',
      'erp not working', 'sap support', 'erp support', 'sap query',
      'sap has been slow', 'sap very slow', 'sap slow', 'sap taking long',
      'sap transactions slow', 'sap performance slow', 'sap behaving',
      'sap system is slow', 'sap system slow', 'sap system extremely slow',
      'sap slow for past', 'transactions in sap slow', 'sap taking minutes',
      'sap performance issue', 'sap running slow', 'sap performance problem',
      'sap has been very slow', 'sap been very slow', 'sap slow for the past',
      'sap transactions that normally', 'transactions normally take seconds',
      'sap affecting all finance', 'sap affecting finance team',
      'sap slow and affecting', 'sap very slow for past two days',
    ],
    phraseExamples: [
      'I am having a general issue with SAP.',
      'The ERP system has an error.',
      'SAP is behaving unexpectedly.',
      'I need help with an SAP problem.',
      'SAP has been very slow for the past two days.',
      'Transactions in SAP are taking minutes instead of seconds.',
    ],
    negativeExclusions: ['leave', 'vacation', 'laptop', 'vpn', 'email'],
  },

  {
    id: 'sap.basis',
    intent: 'SAP Basis / Infrastructure Issue',
    department: 'Finance',
    subteam: 'SAP Basis',
    defaultPriority: 'critical',
    defaultRisk: 'Critical',
    defaultDecision: 'ESCALATE',
    approvalRequired: false,
    semanticTokens: [
      'sap basis', 'sap server', 'sap system down', 'sap performance',
      'sap landscape', 'sap transport', 'sap refresh', 'abap', 'sap client',
    ],
    phraseExamples: [
      'The SAP system is down completely.',
      'SAP performance is extremely slow for all users.',
      'There is an SAP basis issue affecting production.',
      'The SAP server needs attention.',
    ],
    negativeExclusions: ['leave', 'vacation', 'laptop'],
  },

  {
    id: 'sap.user',
    intent: 'SAP User Creation / Modification',
    department: 'Finance',
    subteam: 'SAP Security',
    defaultPriority: 'medium',
    defaultRisk: 'Medium',
    defaultDecision: 'APPROVAL_REQUIRED',
    approvalRequired: true,
    semanticTokens: [
      'sap user creation', 'create sap user', 'new sap user', 'sap user setup',
      'sap user modification', 'update sap user', 'sap user profile',
    ],
    phraseExamples: [
      'I need a new SAP user created for my team member.',
      'Can you set up an SAP user account for me?',
      'I need my SAP user profile updated.',
    ],
    negativeExclusions: ['leave', 'vacation', 'laptop'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FINANCE (8 intents)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'finance.expense',
    intent: 'Expense Reimbursement',
    department: 'Finance',
    subteam: 'Accounts Payable',
    defaultPriority: 'medium',
    defaultRisk: 'Medium',
    defaultDecision: 'APPROVAL_REQUIRED',
    approvalRequired: true,
    semanticTokens: [
      'expense reimbursement', 'expense claim', 'expense report', 'reimbursement',
      'claim expenses', 'travel expense', 'expense submission', 'out of pocket',
      'expense form', 'travel claim', 'claim reimbursement', 'expense approval',
    ],
    phraseExamples: [
      'I need to submit my expense reimbursement.',
      'How do I claim my travel expenses?',
      'I have receipts for expenses I paid out of pocket.',
      'I need to file an expense report.',
      'Can you approve my expense claim?',
      'I need reimbursement for the conference I attended.',
    ],
    negativeExclusions: ['salary', 'payroll', 'leave', 'vacation', 'laptop'],
  },

  {
    id: 'finance.expense.travel',
    intent: 'Travel Expense Issue',
    department: 'Finance',
    subteam: 'Accounts Payable',
    defaultPriority: 'medium',
    defaultRisk: 'Medium',
    defaultDecision: 'APPROVAL_REQUIRED',
    approvalRequired: true,
    semanticTokens: [
      'travel expense', 'travel reimbursement', 'travel claim', 'business travel',
      'travel allowance', 'hotel reimbursement', 'flight reimbursement',
      'travel advance', 'business trip expenses',
      'flight tickets', 'hotel receipts', 'business trip to', 'hotel and flight',
      'went on a business trip', 'business trip receipts', 'trip expenses',
      'flight and hotel', 'meals on business trip', 'business travel to london',
    ],
    phraseExamples: [
      'I need to claim my business travel expenses.',
      'I have hotel and flight receipts from a business trip.',
      'How do I submit my travel reimbursement?',
      'I need a travel advance for an upcoming business trip.',
      'I went on a business trip to London and have flight and hotel receipts.',
    ],
    negativeExclusions: ['salary', 'payroll', 'leave', 'laptop', 'vpn'],
  },

  {
    id: 'finance.invoice',
    intent: 'Invoice / Finance Query',
    department: 'Finance',
    subteam: 'Accounts Payable',
    defaultPriority: 'medium',
    defaultRisk: 'Medium',
    defaultDecision: 'HUMAN_REVIEW',
    approvalRequired: false,
    semanticTokens: [
      'invoice', 'invoice query', 'invoice issue', 'invoice payment',
      'unpaid invoice', 'vendor invoice', 'invoice approval', 'invoice status',
      'payment query', 'accounts payable', 'accounts receivable',
    ],
    phraseExamples: [
      'I have a query about an invoice.',
      'Our vendor invoice has not been paid.',
      'Can you check the status of this invoice?',
      'I need to raise an invoice query.',
    ],
    negativeExclusions: [
      'salary', 'leave', 'laptop', 'vpn',
      'out of pocket', 'conference registration', 'expense claim',
      'reimburse', 'reimbursement', 'paid for myself', 'paid out of pocket',
      // TC073: invoice in SAP workflow context → route to SAP Finance Module Issue
      'workflow error', 'sap', 'workflow in sap', 'accounts payable module sap',
    ],
  },

  {
    id: 'finance.tax',
    intent: 'Tax / Deduction Query',
    department: 'Finance',
    subteam: 'Payroll Team',
    defaultPriority: 'medium',
    // Default is Low; but discrepancy/incorrect deduction context escalates to Medium
    defaultRisk: 'Low',
    defaultDecision: 'HUMAN_REVIEW',
    approvalRequired: false,
    semanticTokens: [
      'tax', 'tax deduction', 'tds', 'income tax', 'tax query', 'tax certificate',
      'form 16', 'tax return', 'tax declaration', 'investment declaration',
      'deduction query', 'tax saving', 'pf deduction', 'esi deduction',
    ],
    phraseExamples: [
      'I have a query about my tax deductions.',
      'Can I get my Form 16 for this financial year?',
      'Why was a higher TDS deducted this month?',
      'I need to submit my investment declaration.',
      'How do I reduce my income tax deduction?',
    ],
    negativeExclusions: ['salary missing', 'leave', 'laptop', 'vpn'],
  },

  {
    id: 'finance.salary.advance',
    intent: 'Salary Advance Request',
    department: 'Finance',
    subteam: 'Payroll Team',
    defaultPriority: 'medium',
    defaultRisk: 'Medium',
    defaultDecision: 'APPROVAL_REQUIRED',
    approvalRequired: true,
    semanticTokens: [
      'salary advance', 'advance salary', 'salary loan', 'pay advance',
      'advance pay', 'advance on salary', 'loan against salary',
    ],
    phraseExamples: [
      'I need a salary advance.',
      'Can I get an advance on my salary?',
      'I need to request a pay advance due to a personal emergency.',
    ],
    negativeExclusions: ['leave', 'laptop', 'vpn', 'network', 'software'],
  },

  {
    id: 'finance.access',
    intent: 'Finance Application Access',
    department: 'Finance',
    subteam: 'Finance Support',
    defaultPriority: 'medium',
    defaultRisk: 'Medium',
    defaultDecision: 'APPROVAL_REQUIRED',
    approvalRequired: true,
    semanticTokens: [
      'finance portal', 'finance application', 'finance system access',
      'accounting software', 'financial system', 'finance module access',
      'cannot access finance', 'finance tool', 'finance platform',
      'access to the finance system', 'access to finance system',
      'access to financial system', 'need access to the finance',
      'company finance system', 'finance system to process',
    ],
    phraseExamples: [
      'I cannot access the finance portal.',
      'I need access to the financial system.',
      'Please give me access to the accounting application.',
      'I need finance system access for my new role.',
      'I need access to the company finance system to process invoices.',
    ],
    negativeExclusions: ['sap', 'leave', 'laptop', 'vpn', 'salary'],
  },

  {
    id: 'finance.budget',
    intent: 'Budget / Financial Planning Query',
    department: 'Finance',
    subteam: 'Finance Support',
    defaultPriority: 'medium',
    defaultRisk: 'Low',
    defaultDecision: 'HUMAN_REVIEW',
    approvalRequired: false,
    semanticTokens: [
      'budget', 'budget query', 'budget approval', 'budget allocation',
      'departmental budget', 'capex', 'opex', 'financial planning',
      'cost center budget', 'budget report',
    ],
    phraseExamples: [
      'I need to query my department budget.',
      'Can I see the budget allocation for Q4?',
      'I need to request additional budget for a project.',
    ],
    negativeExclusions: ['salary', 'leave', 'laptop', 'vpn'],
  },

  {
    id: 'finance.payroll.general',
    intent: 'Finance / Payroll General',
    department: 'Finance',
    subteam: 'Payroll Team',
    defaultPriority: 'medium',
    defaultRisk: 'Medium',
    defaultDecision: 'HUMAN_REVIEW',
    approvalRequired: false,
    semanticTokens: [
      'payroll processing', 'payroll cycle', 'payroll run', 'payroll schedule',
      'payroll department', 'payroll team', 'payroll query general',
    ],
    phraseExamples: [
      'I have a general payroll query.',
      'When does the payroll run this month?',
      'I need to speak to someone in payroll.',
    ],
    negativeExclusions: ['leave', 'laptop', 'vpn', 'software'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SECURITY (8 intents)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'security.phishing',
    intent: 'Phishing / Suspicious Email',
    department: 'IT',
    subteam: 'Security Operations',
    defaultPriority: 'high',
    defaultRisk: 'High',
    defaultDecision: 'ESCALATE',
    approvalRequired: false,
    semanticTokens: [
      'phishing', 'suspicious email', 'spam email', 'suspicious link',
      'suspicious attachment', 'phishing attempt', 'social engineering',
      'fake email', 'impersonation email', 'fraudulent email', 'malicious email',
      'clicked on a phishing link', 'clicked a suspicious link', 'clicked the link',
      'entered my credentials', 'entered my login', 'submitted credentials',
      'clicked link and entered credentials', 'gave my credentials to phishing',
      'phishing email asking for credentials', 'entered password on suspicious site',
      'impersonating our it', 'claiming to be from it', 'claiming to be it support',
      'asked for my password', 'asking for credentials over phone',
      'suspicious call from it', 'social engineering call',
      'transfer money to external', 'transfer funds to external',
      'ceo asking to transfer money', 'urgently transfer money',
      'external account transfer', 'wire money urgently',
    ],
    phraseExamples: [
      'I received a suspicious phishing email.',
      'I think I received a phishing attempt.',
      'There is a suspicious email in my inbox asking for credentials.',
      'I received an email with a suspicious link — is it safe?',
      'Someone is impersonating our CEO via email.',
    ],
    negativeExclusions: ['leave', 'vacation', 'salary', 'laptop issue'],
  },

  {
    id: 'security.account',
    intent: 'Account Compromise / Unauthorized Access',
    department: 'IT',
    subteam: 'Security Operations',
    defaultPriority: 'critical',
    defaultRisk: 'Critical',
    defaultDecision: 'ESCALATE',
    approvalRequired: false,
    semanticTokens: [
      'account compromise', 'account hacked', 'hacked', 'unauthorized access',
      'account taken over', 'suspicious login', 'someone logged into my account',
      'unknown login', 'account breach', 'account security',
      'system forced me to change my password', 'forced password change',
      'password changed automatically', 'password reset forced',
      'account may have been accessed', 'suspicious access',
    ],
    phraseExamples: [
      'I think my account has been hacked.',
      'Someone logged into my account without my permission.',
      'I received a login notification I did not initiate.',
      'My account seems to have been compromised.',
      'There was unauthorized access to my email account.',
    ],
    negativeExclusions: ['leave', 'vacation', 'salary', 'laptop'],
  },

  {
    id: 'security.incident',
    intent: 'Security Incident',
    department: 'IT',
    subteam: 'Incident Response',
    defaultPriority: 'critical',
    defaultRisk: 'Critical',
    defaultDecision: 'ESCALATE',
    approvalRequired: false,
    semanticTokens: [
      'security incident', 'security breach', 'data breach', 'cyber incident',
      'cybersecurity', 'security alert', 'incident report', 'security violation',
      'data leak', 'data exposure',
    ],
    phraseExamples: [
      'I need to report a security incident.',
      'There has been a data breach.',
      'I suspect a cybersecurity incident.',
      'Customer data may have been exposed.',
      'We have a potential data leak.',
    ],
    negativeExclusions: ['leave', 'vacation', 'salary', 'laptop'],
  },

  {
    id: 'security.malware',
    intent: 'Malware Detection',
    department: 'IT',
    subteam: 'Security Operations',
    defaultPriority: 'critical',
    defaultRisk: 'Critical',
    defaultDecision: 'ESCALATE',
    approvalRequired: false,
    semanticTokens: [
      'malware', 'virus', 'ransomware', 'trojan', 'malicious software',
      'infected computer', 'computer virus', 'antivirus alert', 'malware detected',
      'ransomware attack', 'computer infected',
    ],
    phraseExamples: [
      'My computer is showing malware alerts.',
      'I think my laptop has a virus.',
      'The antivirus has detected ransomware.',
      'My computer might be infected with malware.',
      'I received a ransomware warning on my screen.',
    ],
    negativeExclusions: ['leave', 'vacation', 'salary', 'vpn'],
  },

  {
    id: 'security.device_lost',
    intent: 'Lost Company Device',
    department: 'IT',
    subteam: 'Security Operations',
    defaultPriority: 'critical',
    defaultRisk: 'Critical',
    defaultDecision: 'ESCALATE',
    approvalRequired: false,
    semanticTokens: [
      'lost laptop', 'lost device', 'stolen laptop', 'stolen device',
      'lost company phone', 'stolen phone', 'laptop stolen', 'device stolen',
      'missing laptop', 'lost company asset', 'device lost',
      'company laptop stolen', 'company laptop was stolen', 'laptop was stolen',
      'laptop stolen from', 'stolen from car', 'laptop missing', 'stolen from my car',
      'remote wipe', 'laptop taken', 'laptop theft', 'initiate remote wipe',
    ],
    phraseExamples: [
      'My company laptop has been stolen.',
      'I lost my work device.',
      'My company mobile phone was stolen.',
      'Someone stole my laptop bag along with my work laptop.',
      'My company laptop is missing.',
      'My company laptop was stolen from my car this morning.',
      'Please initiate remote wipe on my stolen device.',
    ],
    negativeExclusions: ['leave', 'vacation', 'salary'],
  },

  {
    id: 'security.policy',
    intent: 'Security Policy Incident',
    department: 'IT',
    subteam: 'Security Operations',
    defaultPriority: 'high',
    // NOTE: Policy violation is serious but not Critical — that is for actual breaches
    defaultRisk: 'High',
    defaultDecision: 'ESCALATE',
    approvalRequired: false,
    semanticTokens: [
      'security policy', 'policy violation', 'security violation', 'compliance violation',
      'data policy', 'information security', 'security compliance',
      'sharing confidential', 'sending sensitive data', 'data misuse',
    ],
    phraseExamples: [
      'I witnessed a security policy violation.',
      'A colleague is sharing confidential data externally.',
      'I need to report a compliance violation.',
      'Someone is misusing company data.',
    ],
    negativeExclusions: ['leave', 'vacation', 'salary', 'laptop issue'],
  },

  {
    id: 'security.access_revoke',
    intent: 'Access Revocation Request',
    department: 'IT',
    subteam: 'Identity & Access Management',
    defaultPriority: 'high',
    defaultRisk: 'High',
    defaultDecision: 'DEPARTMENT_PROCESSING',
    approvalRequired: false,
    semanticTokens: [
      'revoke access', 'remove access', 'disable account', 'terminate access',
      'ex-employee access', 'departing employee access', 'offboarded access',
      'access removal', 'deactivate account',
      'former employee still has access', 'ex-employee still has access',
      'employee who left still has', 'left company still has access',
      'resigned employee access', 'still appears to access',
      'employee leaving revoke', 'last day revoke', 'resignation access revoke',
      'please revoke all access', 'revoke all her access', 'revoke all his access',
      'resigned and last day', 'last day revoke access',
      'ensure all access revoked', 'revoke immediately after last day',
      'system access revoked', 'login revoked', 'application logins revoked',
      'appears to be able to access', 'still able to access our',
      'still appears to be able to', 'former employee who left',
      'employee who left 2 weeks', 'left the company still has',
    ],
    negativeExclusions: [
      'leave', 'vacation', 'salary',
      // Do NOT accidentally fire on email access topics
    ],
    phraseExamples: [
      'Please revoke access for a departing employee.',
      'An ex-employee still has system access — please remove it.',
      'Can you disable the account for the employee who left yesterday?',
      'I need to request access revocation for my team member who resigned.',
    ],
  },

  {
    id: 'security.vulnerability',
    intent: 'Vulnerability Report',
    department: 'IT',
    subteam: 'Security Operations',
    defaultPriority: 'high',
    // NOTE: Vulnerability report is High risk by default — exploited breach would be Critical
    defaultRisk: 'High',
    defaultDecision: 'ESCALATE',
    approvalRequired: false,
    semanticTokens: [
      'vulnerability', 'security vulnerability', 'security flaw', 'security weakness',
      'system vulnerability', 'cve', 'patch', 'security patch', 'zero day',
    ],
    phraseExamples: [
      'I found a security vulnerability in our system.',
      'There is an unpatched security flaw in the application.',
      'I need to report a zero-day vulnerability.',
    ],
    negativeExclusions: ['leave', 'vacation', 'salary', 'laptop', 'password'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FACILITIES (8 intents)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'facilities.access',
    intent: 'Office / Building Access',
    department: 'Facilities',
    subteam: 'Security Desk',
    defaultPriority: 'medium',
    defaultRisk: 'Low',
    defaultDecision: 'DEPARTMENT_PROCESSING',
    approvalRequired: false,
    semanticTokens: [
      'office access', 'building access', 'access card', 'entry card',
      'access badge', 'office entry', 'building entry', 'cannot enter building',
      'access denied building', 'office door', 'swipe card', 'id badge',
    ],
    phraseExamples: [
      'My office access card is not working.',
      'I cannot enter the building.',
      'My ID badge is not letting me in.',
      'I need a new access card.',
      'The door swipe card is rejected.',
    ],
    negativeExclusions: ['leave', 'salary', 'laptop', 'vpn', 'email', 'application access', 'system access'],
  },

  {
    id: 'facilities.parking',
    intent: 'Parking Request',
    department: 'Facilities',
    subteam: 'Facilities Support',
    defaultPriority: 'low',
    defaultRisk: 'Low',
    defaultDecision: 'APPROVAL_REQUIRED',
    approvalRequired: true,
    semanticTokens: [
      'parking', 'parking request', 'parking spot', 'parking space',
      'parking allocation', 'car park', 'parking permit', 'vehicle parking',
    ],
    phraseExamples: [
      'I need a parking spot at the office.',
      'Can I request a dedicated parking space?',
      'I need a parking permit for the office.',
      'My parking slot needs to be changed.',
    ],
    negativeExclusions: ['leave', 'salary', 'laptop', 'vpn'],
  },

  {
    id: 'facilities.desk',
    intent: 'Desk / Workspace Allocation',
    department: 'Facilities',
    subteam: 'Facilities Support',
    defaultPriority: 'low',
    defaultRisk: 'Low',
    defaultDecision: 'DEPARTMENT_PROCESSING',
    approvalRequired: false,
    semanticTokens: [
      'desk allocation', 'hot desk', 'workstation allocation', 'desk booking',
      'desk assignment', 'need a desk', 'seating arrangement', 'office desk',
      'desk change', 'work desk',
      'dedicated desk', 'allocated a desk', 'not been allocated a desk',
      'need a dedicated desk', 'assign a desk', 'desk assigned', 'no desk assigned',
      'desk in the office', 'desk in the new office', 'desk in new office',
    ],
    phraseExamples: [
      'I need a dedicated desk at the office.',
      'Can I book a hot desk for next week?',
      'I need my workstation allocation changed.',
      'I do not have an assigned desk.',
      'I have relocated and have not been allocated a desk.',
      'Can a dedicated desk be assigned to me?',
    ],
    negativeExclusions: ['leave', 'salary', 'laptop', 'vpn', 'computer'],
  },

  {
    id: 'facilities.maintenance',
    intent: 'Office Maintenance Issue',
    department: 'Facilities',
    subteam: 'Workplace Services',
    defaultPriority: 'medium',
    defaultRisk: 'Low',
    defaultDecision: 'DEPARTMENT_PROCESSING',
    approvalRequired: false,
    semanticTokens: [
      'office maintenance', 'maintenance request', 'broken chair',
      'broken desk', 'plumbing', 'water leak', 'building maintenance',
      'office repair', 'infrastructure maintenance',
      'ceiling dripping', 'water dripping', 'water from ceiling', 'ceiling leak',
      'chair broken', 'chair needs replacement', 'desk broken', 'broken furniture',
      'toilet not working', 'toilet broken', 'restroom broken', 'flush not working',
      'men restroom', 'bathroom broken', 'toilet flush broken',
      "men's restroom", 'not flushing', 'flush mechanism', 'flush mechanism broken',
      'restroom on', 'toilet not flushing', 'restroom issue',
    ],
    phraseExamples: [
      'There is a water leak near my workstation.',
      'My office chair is broken and needs replacement.',
      'The toilet on the 2nd floor is not working.',
      'I need to raise a maintenance request for the office.',
      'There is water dripping from the ceiling near my workstation.',
      'My office chair back support has snapped.',
    ],
    negativeExclusions: ['laptop', 'computer', 'software', 'server', 'leave'],
  },

  {
    id: 'facilities.hvac',
    intent: 'Air Conditioning / HVAC Issue',
    department: 'Facilities',
    subteam: 'Workplace Services',
    defaultPriority: 'medium',
    defaultRisk: 'Low',
    defaultDecision: 'DEPARTMENT_PROCESSING',
    approvalRequired: false,
    semanticTokens: [
      'air conditioning', 'ac', 'hvac', 'heating', 'cooling', 'ventilation',
      'ac not working', 'room too hot', 'room too cold', 'temperature issue',
      'office temperature', 'ac broken', 'air conditioner',
      'heating not working', 'heating issue', 'office cold', 'team area cold',
      'office too cold', 'too hot in office', 'extremely cold office',
      'wearing coats inside', 'coats inside office',
    ],
    phraseExamples: [
      'The air conditioning in our office is not working.',
      'It is too hot in the office.',
      'The AC is too cold on our floor.',
      'HVAC needs maintenance.',
      'The heating is not working properly.',
      'Our team area is extremely cold.',
    ],
    negativeExclusions: ['laptop', 'server', 'software', 'leave'],
  },

  {
    id: 'facilities.electrical',
    intent: 'Electrical Issue',
    department: 'Facilities',
    subteam: 'Workplace Services',
    defaultPriority: 'high',
    defaultRisk: 'High',
    defaultDecision: 'ESCALATE',
    approvalRequired: false,
    semanticTokens: [
      'electrical issue', 'power outage', 'power cut', 'power socket',
      'electrical fault', 'power failure', 'generator', 'ups issue', 'switch issue',
      'electricity issue', 'power point not working',
      'power socket not working', 'socket not working', 'socket at my desk',
      'electrical connection', 'power connection issue', 'socket is not working',
      'socket at my workstation', 'power socket at my workstation',
      'power socket at my desk', 'power socket not working at my desk',
      'cannot charge my devices', 'cannot charge at my desk', 'socket does not work',
      'check the electrical connection', 'electrical at my desk',
    ],
    phraseExamples: [
      'There is a power outage on our floor.',
      'My power socket is not working.',
      'There is an electrical fault in the office.',
      'The office has no electricity.',
      'The UPS is beeping and there is no power.',
      'The power socket at my workstation is not working.',
    ],
    negativeExclusions: ['server', 'software', 'leave', 'network'],
    // Note: 'laptop' and 'computer' removed from exclusions here because the context
    // "cannot charge my laptop" at an electrical socket IS an electrical issue.
  },

  {
    id: 'facilities.meetingroom',
    intent: 'Meeting Room Issue / Booking',
    department: 'Facilities',
    subteam: 'Facilities Support',
    defaultPriority: 'low',
    defaultRisk: 'Low',
    defaultDecision: 'DEPARTMENT_PROCESSING',
    approvalRequired: false,
    semanticTokens: [
      'meeting room', 'conference room', 'book meeting room', 'room booking',
      'room reservation', 'conference room booking', 'meeting space',
      'meeting room issue', 'book conference room',
    ],
    phraseExamples: [
      'I need to book a meeting room for tomorrow.',
      'The conference room booking system is not working.',
      'Can I reserve a meeting room for Friday?',
      'There is an issue with the meeting room availability.',
    ],
    negativeExclusions: ['leave', 'salary', 'laptop', 'vpn'],
  },

  {
    id: 'facilities.visitor',
    intent: 'Visitor Access / Guest Badge',
    department: 'Facilities',
    subteam: 'Security Desk',
    defaultPriority: 'low',
    defaultRisk: 'Low',
    defaultDecision: 'DEPARTMENT_PROCESSING',
    approvalRequired: false,
    semanticTokens: [
      'visitor', 'guest', 'visitor access', 'guest badge', 'visitor pass',
      'visitor registration', 'invite visitor', 'guest entry', 'client visit',
    ],
    phraseExamples: [
      'I need to register a visitor for tomorrow.',
      'Can I get a guest pass for my client?',
      'I have external visitors coming — how do I register them?',
    ],
    negativeExclusions: ['leave', 'salary', 'laptop', 'vpn'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // GENERAL CORPORATE (4 intents — LAST FALLBACK)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'corporate.policy',
    intent: 'Company Policy Query',
    department: 'HR',
    subteam: 'HR Support',
    defaultPriority: 'low',
    defaultRisk: 'Low',
    defaultDecision: 'AUTO_RESOLVE',
    approvalRequired: false,
    semanticTokens: [
      'company policy', 'organizational policy', 'policy document', 'policy question',
      'employee policy', 'company rules', 'policy clarification',
      'code of conduct', 'employee code',
      'fire alarm', 'fire alarm test', 'evacuate', 'evacuation',
      'alarm test tomorrow', 'building evacuation',
      'expense claim policy', 'what is the expense policy', 'expense policy',
      'expense reimbursement policy', 'reimbursable expenses policy',
      'expense approval process', 'leave encashment policy', 'leave encashment',
    ],
    phraseExamples: [
      'What is the company policy on expense claims?',
      'Can you share the code of conduct document?',
      'I need clarification on a company policy.',
      'Is there a fire alarm test tomorrow?',
      'Do we need to evacuate during the alarm test?',
    ],
    negativeExclusions: [
      'laptop', 'server', 'network', 'vpn',
      // TC030: 'company policy' in referral bonus body → route to salary discrepancy instead
      'referral bonus', 'bonus not credited', 'amount has not been credited',
      'amount has still not been credited',
    ],
  },

  {
    id: 'corporate.directory',
    intent: 'Employee Directory / Organization Query',
    department: 'HR',
    subteam: 'HR Support',
    defaultPriority: 'low',
    defaultRisk: 'Low',
    defaultDecision: 'AUTO_RESOLVE',
    approvalRequired: false,
    semanticTokens: [
      'employee directory', 'org chart', 'organization chart', 'who is my manager',
      'contact details', 'employee contact', 'company directory', 'find employee',
      'reporting structure', 'organizational structure',
    ],
    phraseExamples: [
      'Who is the head of the finance department?',
      'Can you share the org chart?',
      'What is the contact number for HR?',
      'How do I find a colleague\'s contact details?',
    ],
    negativeExclusions: ['laptop', 'server', 'network', 'vpn', 'salary'],
  },

  {
    id: 'corporate.feedback',
    intent: 'Feedback / Suggestion',
    department: 'HR',
    subteam: 'HR Support',
    defaultPriority: 'low',
    defaultRisk: 'Low',
    defaultDecision: 'AUTO_RESOLVE',
    approvalRequired: false,
    semanticTokens: [
      'feedback', 'suggestion', 'improvement suggestion', 'employee feedback',
      'company suggestion', 'workplace improvement', 'process improvement',
    ],
    phraseExamples: [
      'I have a suggestion for improving the office.',
      'I would like to provide feedback on our HR processes.',
      'I have an idea to improve our workflow.',
    ],
    negativeExclusions: ['laptop', 'server', 'network', 'vpn', 'salary', 'leave'],
  },

  {
    id: 'corporate.general',
    intent: 'General Inquiry',
    department: 'HR',
    subteam: 'HR Support',
    defaultPriority: 'low',
    defaultRisk: 'Low',
    defaultDecision: 'HUMAN_REVIEW',
    approvalRequired: false,
    semanticTokens: [
      'general inquiry', 'general question', 'general information',
      'not sure', 'miscellaneous', 'general query',
    ],
    phraseExamples: [
      'I have a general question.',
      'I am not sure where to direct this request.',
    ],
    // This is the fallback — it should only match when nothing else does
    negativeExclusions: [],
  },
];

// ─── Lookup Maps ──────────────────────────────────────────────────────────────

/** Lookup intent definition by id */
export const TAXONOMY_BY_ID = new Map<string, IntentDefinition>(
  INTENT_TAXONOMY.map((def) => [def.id, def])
);

/** Lookup intent definitions by display name */
export const TAXONOMY_BY_INTENT = new Map<string, IntentDefinition>(
  INTENT_TAXONOMY.map((def) => [def.intent.toLowerCase(), def])
);

/** All unique department values */
export const DEPARTMENTS = Array.from(new Set(INTENT_TAXONOMY.map((d) => d.department)));

/** All unique subteam values */
export const SUBTEAMS = Array.from(new Set(INTENT_TAXONOMY.map((d) => d.subteam)));

// ─── Gemini Prompt Builder ────────────────────────────────────────────────────

/**
 * Generates the intent taxonomy section injected into the Gemini classification prompt.
 * Groups intents by department for readability.
 * Includes examples and negative exclusions so Gemini can distinguish ambiguous cases.
 */
export function buildGeminiTaxonomyContext(): string {
  const byDept = new Map<string, IntentDefinition[]>();
  for (const def of INTENT_TAXONOMY) {
    if (!byDept.has(def.department)) byDept.set(def.department, []);
    byDept.get(def.department)!.push(def);
  }

  const lines: string[] = [
    '## INTENT TAXONOMY (use this as your classification guide)',
    '',
    'For each intent below, the format is:',
    'INTENT NAME | department | subteam | defaultPriority | defaultDecision',
    'Examples (natural language the employee may use)',
    'Do NOT classify as this intent if: (negative exclusions)',
    '',
  ];

  for (const [dept, defs] of Array.from(byDept.entries())) {
    lines.push(`### DEPARTMENT: ${dept}`);
    for (const def of defs) {
      lines.push('');
      lines.push(`**${def.intent}** | ${def.department} | ${def.subteam} | ${def.defaultPriority} | ${def.defaultDecision}`);
      lines.push('Examples:');
      for (const ex of def.phraseExamples.slice(0, 5)) {
        lines.push(`  - "${ex}"`);
      }
      if (def.negativeExclusions.length > 0) {
        lines.push(`Do NOT classify as this if message contains: ${def.negativeExclusions.slice(0, 4).join(', ')}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Returns the taxonomy as a compact JSON summary for Gemini prompt injection.
 * Includes intent name, department, subteam, and example phrases.
 */
export function buildCompactTaxonomyForPrompt(): string {
  const summary = INTENT_TAXONOMY.map((def) => ({
    intent: def.intent,
    department: def.department,
    subteam: def.subteam,
    priority: def.defaultPriority,
    risk: def.defaultRisk,
    decision: def.defaultDecision,
    examples: def.phraseExamples.slice(0, 4),
    notIf: def.negativeExclusions.slice(0, 3),
  }));
  return JSON.stringify(summary, null, 0);
}

/**
 * Given an intent display name, returns the taxonomy definition.
 * Case-insensitive. Returns null if not found.
 */
export function getTaxonomyByIntent(intentName: string): IntentDefinition | null {
  return TAXONOMY_BY_INTENT.get(intentName.toLowerCase()) ?? null;
}

/**
 * Returns all intent names as a flat list (for use in Gemini prompts).
 */
export function getIntentNames(): string[] {
  return INTENT_TAXONOMY.map((d) => d.intent);
}
