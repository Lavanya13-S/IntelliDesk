/**
 * lib/ai/classification-test-cases.ts
 *
 * Centralized classification test dataset — 185 test cases.
 *
 * Distribution:
 *   35+ HR (leave, payroll, harassment, policy, lifecycle, benefits)
 *   50+ IT (laptop, wifi, vpn, password, software, email, teams, security, hardware)
 *   20+ SAP/ERP
 *   25+ Finance
 *   15+ Security
 *   15+ Facilities
 *   15+ General / Edge Cases / Regression Cases
 *
 * Each case includes:
 *   - Realistic natural-language subject + body
 *   - Expected classification
 *
 * IMPORTANT REGRESSION CASES:
 *   TC001 — Emergency Leave (was broken: was classified as IT/critical)
 *   TC006 — Laptop Issue ('pto' in 'laptop' false positive — must NOT match leave)
 *   TC007 — WiFi Issue (must NOT classify as HR)
 */

export interface TestCase {
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
}

export const CLASSIFICATION_TEST_CASES: TestCase[] = [

  // ═══════════════════════════════════════════════════════════════════════════
  // HR — LEAVE (Cases TC001–TC015)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'TC001',
    subject: 'Request for Emergency Leave',
    body: 'Dear HR Team, I would like to request emergency leave due to an urgent personal matter. I need to be away from work from September 18 to September 20. Please let me know if the leave can be approved. Regards, Alex Wilson.',
    expected: {
      intent: 'Emergency Leave Request',
      department: 'HR',
      subteam: 'Leave Management',
      priority: 'medium',
      riskLevel: 'Medium',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  {
    id: 'TC002',
    subject: 'Annual Leave Application for December',
    body: 'Hi, I would like to apply for annual leave from December 20 to January 3. I have sufficient leave balance. Please approve this at your earliest convenience.',
    expected: {
      intent: 'Annual Leave Request',
      department: 'HR',
      subteam: 'Leave Management',
      priority: 'low',
      riskLevel: 'Low',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  {
    id: 'TC003',
    subject: 'Sick Leave Application',
    body: 'I am not well today and need to take a sick day. I have a fever and my doctor has advised rest. I will be applying for sick leave for today.',
    expected: {
      intent: 'Sick Leave Request',
      department: 'HR',
      subteam: 'Leave Management',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  {
    id: 'TC004',
    subject: 'Maternity Leave Application',
    body: 'I am writing to apply for maternity leave starting from November 1. My due date is November 15 and I would like to take 6 months of maternity leave as per company policy.',
    expected: {
      intent: 'Maternity / Parental Leave',
      department: 'HR',
      subteam: 'Leave Management',
      priority: 'low',
      riskLevel: 'Low',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  {
    id: 'TC005',
    subject: 'PTO Balance Check',
    body: 'Could you let me know my current PTO balance? I want to plan some vacation days for next month and want to make sure I have enough days available.',
    expected: {
      intent: 'Leave / Time Off Request',
      department: 'HR',
      subteam: 'Leave Management',
      priority: 'low',
      riskLevel: 'Low',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  {
    id: 'TC006',
    subject: 'My laptop battery is draining fast',
    // Regression: 'laptop' must NOT match 'pto' inside it
    body: 'My laptop battery drains completely within one hour even when fully charged. I need either a battery replacement or a new laptop as this is affecting my productivity.',
    expected: {
      intent: 'Hardware / Laptop Issue',
      department: 'IT',
      subteam: 'End User Support',
      priority: 'high',
      riskLevel: 'High',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC007',
    subject: 'WiFi not working',
    // Regression: WiFi issue must NOT be classified as HR
    body: 'The WiFi in the office is not working. I cannot connect to the internet and am unable to work. Please send IT support.',
    expected: {
      intent: 'IT General Support',
      department: 'IT',
      subteam: 'End User Support',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC008',
    subject: 'Paid time off request',
    body: 'I would like to request paid time off from April 5 to April 7. I have a family event that I need to attend. I have notified my manager.',
    expected: {
      intent: 'Leave / Time Off Request',
      department: 'HR',
      subteam: 'Leave Management',
      priority: 'low',
      riskLevel: 'Low',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  {
    id: 'TC009',
    subject: 'I cannot come to work tomorrow',
    body: 'I have an unexpected family situation and I will not be able to come to work tomorrow. I need to take the day off on short notice. Please let me know if this can be accommodated.',
    expected: {
      intent: 'Emergency Leave Request',
      department: 'HR',
      subteam: 'Leave Management',
      priority: 'medium',
      riskLevel: 'Medium',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  {
    id: 'TC010',
    subject: 'Compensatory off request',
    body: 'I worked on Saturday and Sunday last weekend for the product launch. I would like to apply for compensatory off on Monday and Tuesday this week.',
    expected: {
      intent: 'Leave / Time Off Request',
      department: 'HR',
      subteam: 'Leave Management',
      priority: 'low',
      riskLevel: 'Low',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  {
    id: 'TC011',
    subject: 'Paternity leave request',
    body: 'I am expecting my child next month and would like to apply for paternity leave for 2 weeks starting from October 10. Please let me know the process.',
    expected: {
      intent: 'Maternity / Parental Leave',
      department: 'HR',
      subteam: 'Leave Management',
      priority: 'low',
      riskLevel: 'Low',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  {
    id: 'TC012',
    subject: 'Sabbatical Leave Request',
    body: 'I would like to request a sabbatical leave for 3 months to pursue further education. I would like to understand the process and what documentation is required.',
    expected: {
      intent: 'Sabbatical / Extended Leave',
      department: 'HR',
      subteam: 'Leave Management',
      priority: 'low',
      riskLevel: 'Low',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  {
    id: 'TC013',
    subject: 'Need vacation next month',
    body: 'I would like to take a vacation from October 10 to October 20. I need to book flights so I need early approval. I have enough annual leave balance remaining.',
    expected: {
      intent: 'Annual Leave Request',
      department: 'HR',
      subteam: 'Leave Management',
      priority: 'low',
      riskLevel: 'Low',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  {
    id: 'TC014',
    subject: 'Medical leave for surgery',
    body: 'I am scheduled for surgery next week and will need approximately 2 weeks of medical leave to recover. My doctor has provided a certificate. Please help me apply for medical leave.',
    expected: {
      intent: 'Sick Leave Request',
      department: 'HR',
      subteam: 'Leave Management',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  {
    id: 'TC015',
    subject: 'Work from home approval needed',
    body: 'I would like to work from home this week as I have a plumber coming to fix a leak at home. Can I get approval to work remotely for the next 3 days?',
    expected: {
      intent: 'Work From Home Request',
      department: 'HR',
      subteam: 'HR Support',
      priority: 'low',
      riskLevel: 'Low',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // HR — PAYROLL & SALARY (TC016–TC025)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'TC016',
    subject: 'Salary not credited',
    body: 'My salary for last month has not been credited to my account yet. Today is the 5th and usually it comes on the 1st. Please check and resolve urgently.',
    expected: {
      intent: 'Salary Not Received',
      department: 'HR',
      subteam: 'Payroll',
      priority: 'critical',
      riskLevel: 'Critical',
      decision: 'ESCALATE',
    },
  },

  {
    id: 'TC017',
    subject: 'Incorrect amount paid',
    body: 'My salary this month is less than my usual amount. I noticed my payslip shows a deduction that was not communicated to me. I urgently need this corrected.',
    expected: {
      intent: 'Incorrect Salary / Payroll Discrepancy',
      department: 'Finance',
      subteam: 'Payroll Team',
      priority: 'high',
      riskLevel: 'High',
      decision: 'ESCALATE',
    },
  },

  {
    id: 'TC018',
    subject: 'Payslip not received',
    body: 'I have not received my payslip for this month. Can you please send it to me? I need it for a loan application.',
    expected: {
      intent: 'Payslip / Pay Stub Request',
      department: 'HR',
      subteam: 'Payroll',
      priority: 'low',
      riskLevel: 'Low',
      decision: 'AUTO_RESOLVE',
    },
  },

  {
    id: 'TC019',
    subject: 'Salary increment not updated',
    body: 'My performance appraisal was completed last month and I was told I would receive a 10% increment. However, my salary this month is still the old amount.',
    expected: {
      intent: 'Incorrect Salary / Payroll Discrepancy',
      department: 'Finance',
      subteam: 'Payroll Team',
      priority: 'high',
      riskLevel: 'High',
      decision: 'ESCALATE',
    },
  },

  {
    id: 'TC020',
    subject: 'Request for salary advance',
    body: 'I have an unexpected medical expense and I would like to request a salary advance of 20,000. I will repay it in 3 equal monthly installments.',
    expected: {
      intent: 'Salary Advance Request',
      department: 'Finance',
      subteam: 'Payroll Team',
      priority: 'medium',
      riskLevel: 'Medium',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  {
    id: 'TC021',
    subject: 'Overtime pay not included',
    body: 'I worked 15 hours of overtime last month during the year-end rush but my payslip does not show overtime compensation. How do I get this corrected?',
    expected: {
      intent: 'Incorrect Salary / Payroll Discrepancy',
      department: 'Finance',
      subteam: 'Payroll Team',
      priority: 'high',
      riskLevel: 'High',
      decision: 'ESCALATE',
    },
  },

  {
    id: 'TC022',
    subject: 'Payslip for visa application',
    body: 'I am applying for a visa and need my last 3 months payslips. Can you please provide them as soon as possible?',
    expected: {
      intent: 'Payslip / Pay Stub Request',
      department: 'HR',
      subteam: 'Payroll',
      priority: 'low',
      riskLevel: 'Low',
      decision: 'AUTO_RESOLVE',
    },
  },

  {
    id: 'TC023',
    subject: 'Bonus not paid',
    body: 'The annual bonus was announced last quarter but I have not received it in my account. My colleagues have received theirs. Can you check why mine is missing?',
    expected: {
      intent: 'Incorrect Salary / Payroll Discrepancy',
      department: 'Finance',
      subteam: 'Payroll Team',
      priority: 'high',
      riskLevel: 'High',
      decision: 'ESCALATE',
    },
  },

  {
    id: 'TC024',
    subject: 'Gratuity query on leaving',
    body: 'I have been with the company for 8 years and am planning to resign. Can you tell me how gratuity is calculated and when I can expect to receive it?',
    expected: {
      intent: 'Pension / Provident Fund Query',
      department: 'HR',
      subteam: 'Benefits',
      priority: 'low',
      riskLevel: 'Low',
      decision: 'HUMAN_REVIEW',
    },
  },

  {
    id: 'TC025',
    subject: 'Resignation process query',
    body: 'I would like to submit my resignation. Could you please tell me the notice period I need to serve and the exit formalities I need to complete?',
    expected: {
      intent: 'Employee Offboarding Request',
      department: 'HR',
      subteam: 'HR Operations',
      priority: 'low',
      riskLevel: 'Low',
      decision: 'HUMAN_REVIEW',
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // HR — GENERAL & POLICY (TC026–TC035)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'TC026',
    subject: 'Workplace bullying complaint',
    body: 'I want to formally report that my manager has been verbally abusive and has been bullying me in front of colleagues. This has been happening for 3 months. I am uncomfortable and want to raise a formal complaint.',
    expected: {
      intent: 'Workplace Harassment Complaint',
      department: 'HR',
      subteam: 'Employee Relations',
      priority: 'critical',
      riskLevel: 'Critical',
      decision: 'ESCALATE',
    },
  },

  {
    id: 'TC027',
    subject: 'Onboarding documents required',
    body: 'I am a new joiner and I need guidance on the onboarding documents I need to submit. Can someone from HR guide me on what is required in the first week?',
    expected: {
      intent: 'Employee Onboarding Request',
      department: 'HR',
      subteam: 'HR Operations',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC028',
    subject: 'Office relocation — what happens to my benefits?',
    body: 'I heard the office is moving to a new location next month. I would like to understand if there are any changes to my compensation, travel allowance, or other benefits as a result of this move.',
    expected: {
      intent: 'Employee Benefits Query',
      department: 'HR',
      subteam: 'Benefits',
      priority: 'low',
      riskLevel: 'Low',
      decision: 'AUTO_RESOLVE',
    },
  },

  {
    id: 'TC029',
    subject: 'Promotion letter not issued',
    body: 'I was promoted in April but have not yet received my formal promotion letter. My manager has confirmed the promotion. Can HR please issue the official letter?',
    expected: {
      intent: 'Promotion / Role Change Query',
      department: 'HR',
      subteam: 'HR Support',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'HUMAN_REVIEW',
    },
  },

  {
    id: 'TC030',
    subject: 'Employee referral bonus not credited',
    body: 'I referred a candidate who joined 3 months ago. As per the company policy I should receive a referral bonus. The amount has still not been credited. Please check.',
    expected: {
      intent: 'Incorrect Salary / Payroll Discrepancy',
      department: 'Finance',
      subteam: 'Payroll Team',
      priority: 'high',
      riskLevel: 'High',
      decision: 'ESCALATE',
    },
  },

  {
    id: 'TC031',
    subject: 'Performance review schedule',
    body: 'When are the performance appraisals scheduled for this year? I want to prepare documentation. Is there a formal process or does my manager handle it directly?',
    expected: {
      intent: 'Promotion / Role Change Query',
      department: 'HR',
      subteam: 'HR Support',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'HUMAN_REVIEW',
    },
  },

  {
    id: 'TC032',
    subject: 'Training and development budget',
    body: 'I want to attend a professional certification course that costs 15,000. Is there a training budget available? How do I apply for learning and development funding?',
    expected: {
      intent: 'Budget / Financial Planning Query',
      department: 'Finance',
      subteam: 'Finance Support',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'HUMAN_REVIEW',
    },
  },

  {
    id: 'TC033',
    subject: 'Work from home policy — how many days allowed?',
    body: 'What is the official company policy on remote working? I want to understand if there are any restrictions on how many days per week I can work from home.',
    expected: {
      intent: 'HR Policy Query',
      department: 'HR',
      subteam: 'HR Support',
      priority: 'low',
      riskLevel: 'Low',
      decision: 'AUTO_RESOLVE',
    },
  },

  {
    id: 'TC034',
    subject: 'Colleague discrimination claim',
    body: 'I would like to report that a colleague has been making discriminatory comments about my religion. This has been going on for weeks and I feel uncomfortable at work.',
    expected: {
      intent: 'Workplace Harassment Complaint',
      department: 'HR',
      subteam: 'Employee Relations',
      priority: 'critical',
      riskLevel: 'Critical',
      decision: 'ESCALATE',
    },
  },

  {
    id: 'TC035',
    subject: 'Webcam not working for video calls',
    body: 'My laptop webcam is not being detected by Teams or Zoom. Video calls show a black screen when I try to use the camera. I have tried reconnecting but it is not working.',
    expected: {
      intent: 'Keyboard / Mouse / Peripheral Issue',
      department: 'IT',
      subteam: 'End User Support',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // IT — HARDWARE & NETWORK (TC036–TC055)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'TC036',
    subject: 'Laptop screen cracked',
    body: 'I accidentally dropped my work laptop and the screen is now cracked. It is still partially functional but the screen has lines across it. I need it repaired or replaced.',
    expected: {
      intent: 'Hardware / Laptop Issue',
      department: 'IT',
      subteam: 'End User Support',
      priority: 'high',
      riskLevel: 'High',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC037',
    subject: 'Monitor not displaying correctly',
    body: 'My external monitor has started flickering. The screen goes black randomly and then comes back. This is disrupting my work. Can someone from IT take a look?',
    expected: {
      intent: 'Monitor / Display Issue',
      department: 'IT',
      subteam: 'End User Support',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC038',
    subject: 'Internet not working at my desk',
    body: 'I have no internet connectivity at my workstation. The ethernet cable is connected but I am not getting any network. I cannot access any internal applications or websites.',
    expected: {
      intent: 'Network / WiFi Issue',
      department: 'IT',
      subteam: 'Network Operations',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC039',
    subject: 'Wireless network drops every 10 minutes',
    body: 'The office wireless network keeps disconnecting. It connects and then drops after a few minutes. I have to reconnect every few minutes which is very disruptive.',
    expected: {
      intent: 'Network / WiFi Issue',
      department: 'IT',
      subteam: 'Network Operations',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC040',
    subject: 'VPN setup required on new laptop',
    body: 'I have received a new laptop but the VPN client has not been installed. I work from home 3 days a week and cannot access company resources without VPN. Please help.',
    expected: {
      intent: 'Hardware / Laptop Issue',
      department: 'IT',
      subteam: 'End User Support',
      priority: 'high',
      riskLevel: 'High',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC041',
    subject: 'Cannot connect to company network from home',
    body: 'I am working from home but cannot establish a connection to the company internal network. I need access to the internal file server and corporate network to do my work.',
    expected: {
      intent: 'VPN / Remote Access Issue',
      department: 'IT',
      subteam: 'Network Operations',
      priority: 'high',
      riskLevel: 'Medium',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC042',
    subject: 'Network outage on 4th floor',
    body: 'The entire 4th floor has lost network connectivity. Nobody on this floor can access the internet or any internal systems. This is affecting around 50 employees. We need urgent help.',
    expected: {
      intent: 'Network / System Outage',
      department: 'IT',
      subteam: 'Infrastructure',
      priority: 'critical',
      riskLevel: 'Critical',
      decision: 'ESCALATE',
    },
  },

  {
    id: 'TC043',
    subject: 'Wi-Fi signal too weak at my desk',
    body: 'The Wi-Fi signal at my workstation is very weak. I am getting one bar and the speeds are very slow. My colleagues nearby have a better signal. Can the access point be checked?',
    expected: {
      intent: 'Network / WiFi Issue',
      department: 'IT',
      subteam: 'Network Operations',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC044',
    subject: 'VPN client software not installing correctly',
    body: 'The VPN client software did not install correctly on my new laptop. I keep getting an installation error. I need VPN to work remotely. Please assist.',
    expected: {
      intent: 'VPN / Remote Access Issue',
      department: 'IT',
      subteam: 'Network Operations',
      priority: 'high',
      riskLevel: 'Medium',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC045',
    subject: 'Need to reset my password',
    body: 'I have forgotten my password and cannot log into my computer. I have tried the usual options but cannot reset it myself. Please help me reset my Windows login password.',
    expected: {
      intent: 'Password Reset',
      department: 'IT',
      subteam: 'Identity & Access Management',
      priority: 'high',
      riskLevel: 'Medium',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC046',
    subject: 'Account locked after wrong password attempts',
    body: 'I entered my password incorrectly multiple times and my account is now locked. I cannot log in at all. Please unlock my account as soon as possible.',
    expected: {
      intent: 'Account Lockout',
      department: 'IT',
      subteam: 'Identity & Access Management',
      priority: 'high',
      riskLevel: 'Medium',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC047',
    subject: 'Need access to SharePoint document library',
    body: 'I need access to the Finance team SharePoint site. I have been added to the project but do not have permissions to view documents. Please grant me read access.',
    expected: {
      intent: 'SharePoint / Intranet Access',
      department: 'IT',
      subteam: 'Collaboration Support',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC048',
    subject: 'Microsoft Teams keeps crashing',
    body: 'Microsoft Teams crashes every time I try to join a meeting. I have tried reinstalling it but the issue persists. All my meetings are on Teams and this is a major problem.',
    expected: {
      intent: 'Teams / Video Conference Issue',
      department: 'IT',
      subteam: 'Collaboration Support',
      priority: 'high',
      riskLevel: 'Medium',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC049',
    subject: 'Outlook not syncing emails',
    body: 'My Outlook inbox is not syncing. New emails are not appearing even though I know people have sent me messages. The sync seems to be stuck. Please help.',
    expected: {
      intent: 'Email / Outlook Issue',
      department: 'IT',
      subteam: 'Collaboration Support',
      priority: 'high',
      riskLevel: 'Medium',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC050',
    subject: 'New software needed for data analysis',
    body: 'For my new project role, I need Tableau Desktop installed on my laptop. The license should be available from IT. Could you please install it for me?',
    expected: {
      intent: 'Software Installation Request',
      department: 'IT',
      subteam: 'End User Support',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC051',
    subject: 'Need access to Azure DevOps project',
    body: 'I need access to the Azure DevOps repository for the new product development project. I have been added to the team but keep getting permission denied. Please grant me access.',
    expected: {
      intent: 'Cloud / SaaS Application Access',
      department: 'IT',
      subteam: 'Identity & Access Management',
      priority: 'medium',
      riskLevel: 'Medium',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  {
    id: 'TC052',
    subject: 'Please install Outlook on my laptop',
    body: 'My laptop does not have Microsoft Outlook installed. Can you please install it? I need it to access my work email.',
    expected: {
      intent: 'Software Installation Request',
      department: 'IT',
      subteam: 'End User Support',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC053',
    subject: 'Computer running very slow',
    body: 'My desktop computer has been extremely slow for the past week. Applications take minutes to load and the computer freezes frequently. This is severely impacting my work.',
    expected: {
      intent: 'Desktop / Computer Issue',
      department: 'IT',
      subteam: 'End User Support',
      priority: 'high',
      riskLevel: 'Medium',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC054',
    subject: 'Request for cloud storage access',
    body: 'I need access to the company OneDrive for Business to collaborate with external clients. My current storage limit is too small for the files we need to share.',
    expected: {
      intent: 'Shared Drive / File Server Access',
      department: 'IT',
      subteam: 'Collaboration Support',
      priority: 'medium',
      riskLevel: 'Medium',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  {
    id: 'TC055',
    subject: 'Windows update breaking my applications',
    body: 'After a Windows update last night, several of my business applications are no longer working. The update seems to have caused compatibility issues. I need urgent help.',
    expected: {
      intent: 'Operating System Issue',
      department: 'IT',
      subteam: 'End User Support',
      priority: 'high',
      riskLevel: 'High',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // IT — ACCESS & IDENTITY (TC056–TC065)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'TC056',
    subject: 'New employee needs system access',
    body: 'We have a new team member joining next Monday. They will need access to our project management tools, email, and shared drives. Please set up their accounts.',
    expected: {
      intent: 'Employee Onboarding Request',
      department: 'HR',
      subteam: 'HR Operations',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC057',
    subject: 'MFA not working on my phone',
    body: 'I changed my phone last week and now the multi-factor authentication codes are not working. I cannot log into my work applications as the MFA is tied to my old phone.',
    expected: {
      intent: 'MFA / Two-Factor Authentication Issue',
      department: 'IT',
      subteam: 'Identity & Access Management',
      priority: 'high',
      riskLevel: 'Medium',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC058',
    subject: 'Employee leaving — please revoke all access',
    body: 'Our employee Sarah Johnson has resigned and her last day is Friday. Please ensure all her system access, email, and application logins are revoked immediately after her last day.',
    expected: {
      intent: 'Email / Outlook Issue',
      department: 'IT',
      subteam: 'Collaboration Support',
      priority: 'high',
      riskLevel: 'Medium',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC059',
    subject: 'Cannot access the HR self-service portal',
    body: 'I am unable to log into the HR self-service portal to check my leave balance and payslips. I keep getting an authentication error. Please help me regain access.',
    expected: {
      intent: 'SharePoint / Intranet Access',
      department: 'IT',
      subteam: 'Collaboration Support',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC060',
    subject: 'Need additional license for design tool',
    body: 'Our design team has expanded and we need one more Figma license. Our current license count is maxed out. Can you please procure an additional license?',
    expected: {
      intent: 'Software License Request',
      department: 'IT',
      subteam: 'End User Support',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  {
    id: 'TC061',
    subject: 'Printer not working',
    body: 'The office printer on the 3rd floor is not printing. I have sent several documents to print but nothing is coming out. Other colleagues are also facing the same issue.',
    expected: {
      intent: 'Printer / Peripheral Issue',
      department: 'IT',
      subteam: 'End User Support',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC062',
    subject: 'Cannot login to SAP',
    body: 'I am getting an access denied error when logging into SAP. My account seems to be locked. I need to complete a financial period close today and this is urgent.',
    expected: {
      intent: 'SAP Login Issue',
      department: 'Finance',
      subteam: 'SAP Basis',
      priority: 'high',
      riskLevel: 'Medium',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC063',
    subject: 'SAP access for new finance role',
    body: 'I have joined the finance team as a Financial Analyst and need access to SAP S/4HANA. My manager has approved this request. Please set up my SAP user account.',
    expected: {
      intent: 'SAP / ERP Access Request',
      department: 'Finance',
      subteam: 'SAP Basis',
      priority: 'medium',
      riskLevel: 'High',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  {
    id: 'TC064',
    subject: 'Additional SAP roles needed',
    body: 'I have been given additional responsibilities for purchasing. I need the MM purchasing roles added to my SAP profile so I can create and approve purchase orders.',
    expected: {
      intent: 'SAP Role / Authorization Request',
      department: 'Finance',
      subteam: 'SAP Security',
      priority: 'medium',
      riskLevel: 'High',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  {
    id: 'TC065',
    subject: 'Need ERP system access for new role',
    body: 'I have been promoted to a Finance Manager role and need access to the ERP system to approve purchase orders. Please provision the required ERP system access for my role.',
    expected: {
      intent: 'SAP / ERP Access Request',
      department: 'Finance',
      subteam: 'SAP Basis',
      priority: 'medium',
      riskLevel: 'High',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SAP / ERP (TC066–TC075)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'TC066',
    subject: 'Cannot create purchase order in SAP',
    body: 'When I try to create a purchase order in SAP MM, I get an error saying authorization object is missing. I need this fixed urgently to process vendor payments today.',
    expected: {
      intent: 'SAP Procurement Issue',
      department: 'Finance',
      subteam: 'SAP Functional Support',
      priority: 'high',
      riskLevel: 'High',
      decision: 'ESCALATE',
    },
  },

  {
    id: 'TC067',
    subject: 'SAP system is extremely slow',
    body: 'SAP has been very slow for the past two days. Transactions that normally take seconds are taking minutes. This is affecting all Finance team members and our month-end close process.',
    expected: {
      intent: 'SAP / ERP General Issue',
      department: 'Finance',
      subteam: 'SAP Basis',
      priority: 'medium',
      riskLevel: 'Medium',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC068',
    subject: 'SAP password has expired',
    body: 'My SAP password has expired and the system is not letting me log in. I need to reset it to continue my daily work in the finance module.',
    expected: {
      intent: 'SAP Password Reset',
      department: 'Finance',
      subteam: 'SAP Basis',
      priority: 'high',
      riskLevel: 'Low',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC069',
    subject: 'SAP S4 not accessible this morning',
    body: 'I cannot access SAP S4 this morning. The login page is not loading at all. This is blocking my work for the entire finance team. Please check.',
    expected: {
      intent: 'SAP Login Issue',
      department: 'Finance',
      subteam: 'SAP Basis',
      priority: 'high',
      riskLevel: 'Medium',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC070',
    subject: 'SAP FI module showing errors',
    body: 'The SAP Finance module is showing posting errors when I try to book journal entries. The GL account seems to be blocked. I need this resolved before the period closes.',
    expected: {
      intent: 'SAP Finance Module Issue',
      department: 'Finance',
      subteam: 'SAP Functional Support',
      priority: 'high',
      riskLevel: 'High',
      decision: 'ESCALATE',
    },
  },

  {
    id: 'TC071',
    subject: 'New SAP user setup for team member',
    body: 'We have a new team member joining next week. Could you please create a SAP user account for them with the standard Finance Analyst role assignments?',
    expected: {
      intent: 'SAP User Creation / Modification',
      department: 'Finance',
      subteam: 'SAP Security',
      priority: 'medium',
      riskLevel: 'Medium',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  {
    id: 'TC072',
    subject: 'SAP system down — all users affected',
    body: 'The SAP production system is completely down. No one in the Finance department can log in. This is a critical issue as we have month-end close activities today.',
    expected: {
      intent: 'SAP Basis / Infrastructure Issue',
      department: 'Finance',
      subteam: 'SAP Basis',
      priority: 'critical',
      riskLevel: 'Critical',
      decision: 'ESCALATE',
    },
  },

  {
    id: 'TC073',
    subject: 'Invoice not processing in SAP',
    body: 'Vendor invoices are not being processed in SAP. The system keeps showing a workflow error when I try to approve invoices in the accounts payable module.',
    expected: {
      intent: 'SAP Procurement Issue',
      department: 'Finance',
      subteam: 'ERP Support',
      priority: 'high',
      riskLevel: 'High',
      decision: 'ESCALATE',
    },
  },

  {
    id: 'TC074',
    subject: 'Business trip expense reimbursement',
    body: 'I returned from a business trip to London last week. I have receipts for flight and hotel amounting to 35,000. Please tell me how to submit for reimbursement.',
    expected: {
      intent: 'Expense Reimbursement',
      department: 'Finance',
      subteam: 'Accounts Payable',
      priority: 'medium',
      riskLevel: 'Medium',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  {
    id: 'TC075',
    subject: 'Vendor invoice not paid',
    body: 'Our vendor ABC Ltd has raised an invoice 60 days ago but has not received payment. They are threatening to stop service. Can you check the payment status urgently?',
    expected: {
      intent: 'Invoice / Finance Query',
      department: 'Finance',
      subteam: 'Accounts Payable',
      priority: 'medium',
      riskLevel: 'Medium',
      decision: 'HUMAN_REVIEW',
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FINANCE (TC076–TC085)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'TC076',
    subject: 'Tax deduction query',
    body: 'My TDS deduction this month is higher than last month even though nothing has changed. Can you explain why this deduction changed and if there was an error?',
    expected: {
      intent: 'Tax / Deduction Query',
      department: 'Finance',
      subteam: 'Payroll Team',
      priority: 'medium',
      riskLevel: 'Medium',
      decision: 'HUMAN_REVIEW',
    },
  },

  {
    id: 'TC077',
    subject: 'Investment declaration for tax savings',
    body: 'I want to submit my investment declaration for this financial year to reduce my TDS deduction. What is the deadline and how do I submit the declaration?',
    expected: {
      intent: 'Tax / Deduction Query',
      department: 'Finance',
      subteam: 'Payroll Team',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'HUMAN_REVIEW',
    },
  },

  {
    id: 'TC078',
    subject: 'I need my Form 16 for tax filing',
    body: 'It is tax season and I need Form 16 from the company for this financial year. Can you please provide it or let me know how to download it?',
    expected: {
      intent: 'Tax / Deduction Query',
      department: 'Finance',
      subteam: 'Payroll Team',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'HUMAN_REVIEW',
    },
  },

  {
    id: 'TC079',
    subject: 'Department budget query',
    body: 'Can you share the Q4 budget allocation for the Marketing department? I need to plan our campaign spend for the quarter and need visibility on the approved budget.',
    expected: {
      intent: 'Budget / Financial Planning Query',
      department: 'Finance',
      subteam: 'Finance Support',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'HUMAN_REVIEW',
    },
  },

  {
    id: 'TC080',
    subject: 'Finance portal access required',
    body: 'I cannot access the finance portal to approve payments. I get an error saying I am not authorized. Can you please fix my access to the finance system?',
    expected: {
      intent: 'Finance Application Access',
      department: 'Finance',
      subteam: 'Finance Support',
      priority: 'medium',
      riskLevel: 'Medium',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  {
    id: 'TC081',
    subject: 'Conference registration expense',
    body: 'I attended an industry conference last month and paid the registration fee of 5,000 out of my own pocket. How do I submit this expense for reimbursement?',
    expected: {
      intent: 'Expense Reimbursement',
      department: 'Finance',
      subteam: 'Accounts Payable',
      priority: 'medium',
      riskLevel: 'Medium',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  {
    id: 'TC082',
    subject: 'General payroll inquiry',
    body: 'I have a general question about the payroll processing date for next month. When is the cutoff date for any salary changes to be processed?',
    expected: {
      intent: 'Finance / Payroll General',
      department: 'Finance',
      subteam: 'Payroll Team',
      priority: 'medium',
      riskLevel: 'Medium',
      decision: 'HUMAN_REVIEW',
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SECURITY (TC083–TC095)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'TC083',
    subject: 'Suspicious email with link',
    body: 'I received an email claiming to be from our CEO asking me to urgently transfer money to an external account. The email looks suspicious and I have not clicked the link.',
    expected: {
      intent: 'Phishing / Suspicious Email',
      department: 'IT',
      subteam: 'Security Operations',
      priority: 'high',
      riskLevel: 'High',
      decision: 'ESCALATE',
    },
  },

  {
    id: 'TC084',
    subject: 'I think my laptop has a virus',
    body: 'My antivirus software is showing multiple malware alerts and my laptop is behaving strangely. Several programs are opening by themselves. I think it is infected.',
    expected: {
      intent: 'Malware Detection',
      department: 'IT',
      subteam: 'Security Operations',
      priority: 'critical',
      riskLevel: 'Critical',
      decision: 'ESCALATE',
    },
  },

  {
    id: 'TC085',
    subject: 'Company laptop stolen from car',
    body: 'My company laptop was stolen from my car while I was at a client meeting. It has confidential company and client data on it. Please help and initiate remote wipe if possible.',
    expected: {
      intent: 'Lost Company Device',
      department: 'IT',
      subteam: 'Security Operations',
      priority: 'critical',
      riskLevel: 'Critical',
      decision: 'ESCALATE',
    },
  },

  {
    id: 'TC086',
    subject: 'Suspicious login notification received',
    body: 'I received a notification that someone logged into my account from a location in a different country. I did not initiate this login. Please help me secure my account.',
    expected: {
      intent: 'Account Compromise / Unauthorized Access',
      department: 'IT',
      subteam: 'Security Operations',
      priority: 'critical',
      riskLevel: 'Critical',
      decision: 'ESCALATE',
    },
  },

  {
    id: 'TC087',
    subject: 'Data breach suspected',
    body: 'I believe there may have been a data breach. I received an email from an unknown party containing confidential customer information from our database. This needs immediate investigation.',
    expected: {
      intent: 'Security Incident',
      department: 'IT',
      subteam: 'Incident Response',
      priority: 'critical',
      riskLevel: 'Critical',
      decision: 'ESCALATE',
    },
  },

  {
    id: 'TC088',
    subject: 'Suspicious link in email — did I get phished?',
    body: 'I clicked on a link in an email that I now think was a phishing email. The link asked me for my login credentials and I entered my username and password before realizing it was fake.',
    expected: {
      intent: 'Phishing / Suspicious Email',
      department: 'IT',
      subteam: 'Security Operations',
      priority: 'critical',
      riskLevel: 'Critical',
      decision: 'ESCALATE',
    },
  },

  {
    id: 'TC089',
    subject: 'Ransomware message on screen',
    body: 'My screen is showing a ransomware message saying my files have been encrypted and I need to pay to get them back. I cannot access any of my documents. This is urgent.',
    expected: {
      intent: 'Malware Detection',
      department: 'IT',
      subteam: 'Security Operations',
      priority: 'critical',
      riskLevel: 'Critical',
      decision: 'ESCALATE',
    },
  },

  {
    id: 'TC090',
    subject: 'SQL injection vulnerability found',
    body: 'While testing, I found a SQL injection vulnerability in the internal HR portal. Unauthenticated users could potentially access sensitive employee records.',
    expected: {
      intent: 'Vulnerability Report',
      department: 'IT',
      subteam: 'Security Operations',
      priority: 'high',
      riskLevel: 'High',
      decision: 'ESCALATE',
    },
  },

  {
    id: 'TC091',
    subject: 'Security policy violation report',
    body: 'I witnessed a colleague copying sensitive company data to a personal USB drive. This seems to be against our data security policy and I wanted to formally report it.',
    expected: {
      intent: 'Security Policy Incident',
      department: 'IT',
      subteam: 'Security Operations',
      priority: 'high',
      riskLevel: 'High',
      decision: 'ESCALATE',
    },
  },

  {
    id: 'TC092',
    subject: 'Security vulnerability found in application',
    body: 'While testing, I found a SQL injection vulnerability in the internal HR portal. Unauthenticated users could potentially access sensitive employee records.',
    expected: {
      intent: 'Vulnerability Report',
      department: 'IT',
      subteam: 'Security Operations',
      priority: 'high',
      riskLevel: 'High',
      decision: 'ESCALATE',
    },
  },

  {
    id: 'TC093',
    subject: 'Ex-employee still has system access',
    body: 'I noticed that a former employee who left 2 weeks ago still appears to be able to access our internal systems. Their access should have been revoked. Please investigate.',
    expected: {
      intent: 'Access Revocation Request',
      department: 'IT',
      subteam: 'Identity & Access Management',
      priority: 'high',
      riskLevel: 'High',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC094',
    subject: 'USB device blocked by security policy',
    body: 'My USB drive is being blocked by the company security software. I need to transfer some project files from my USB to my laptop. Can this be temporarily enabled?',
    expected: {
      intent: 'Security Policy Incident',
      department: 'IT',
      subteam: 'Security Operations',
      priority: 'high',
      riskLevel: 'High',
      decision: 'ESCALATE',
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FACILITIES (TC095–TC110)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'TC095',
    subject: 'Air conditioning not working in our area',
    body: 'The air conditioning on the 2nd floor has stopped working. It is extremely hot and uncomfortable. Multiple employees are complaining. This needs urgent attention.',
    expected: {
      intent: 'Air Conditioning / HVAC Issue',
      department: 'Facilities',
      subteam: 'Workplace Services',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC096',
    subject: 'Book meeting room for client presentation',
    body: 'I need to book a meeting room for a client presentation on Thursday from 2 PM to 5 PM. It should accommodate 10 people and have a projector.',
    expected: {
      intent: 'Meeting Room Issue / Booking',
      department: 'Facilities',
      subteam: 'Facilities Support',
      priority: 'low',
      riskLevel: 'Low',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC097',
    subject: 'Power socket not working at my desk',
    body: 'The power socket at my workstation is not working. I cannot charge my laptop or connect my devices. Could someone check the electrical connection?',
    expected: {
      intent: 'Electrical Issue',
      department: 'Facilities',
      subteam: 'Workplace Services',
      priority: 'high',
      riskLevel: 'High',
      decision: 'ESCALATE',
    },
  },

  {
    id: 'TC098',
    subject: 'Need a dedicated desk in the new office',
    body: 'I have relocated to the new office but have not been allocated a desk. I am currently using different desks each day. Can a dedicated desk be assigned to me?',
    expected: {
      intent: 'Desk / Workspace Allocation',
      department: 'Facilities',
      subteam: 'Facilities Support',
      priority: 'low',
      riskLevel: 'Low',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC099',
    subject: 'Water leak near my workstation',
    body: 'There is water dripping from the ceiling near my workstation. It is getting on my desk and equipment. This needs to be fixed urgently before it causes damage.',
    expected: {
      intent: 'Office Maintenance Issue',
      department: 'Facilities',
      subteam: 'Workplace Services',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC100',
    subject: 'Visitor access badge needed',
    body: 'I have three external consultants visiting our office tomorrow for a full day. How do I register them and get visitor passes for the building?',
    expected: {
      intent: 'Visitor Access / Guest Badge',
      department: 'Facilities',
      subteam: 'Security Desk',
      priority: 'low',
      riskLevel: 'Low',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC101',
    subject: 'Broken chair needs replacement',
    body: 'My office chair is broken — the back support has snapped. I cannot sit on it and need a replacement immediately as it is causing back pain.',
    expected: {
      intent: 'Office Maintenance Issue',
      department: 'Facilities',
      subteam: 'Workplace Services',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC102',
    subject: 'Office too cold — heating issue',
    body: 'Our team area is extremely cold. The heating is not working properly. Multiple people are wearing coats inside the office. Can facilities fix the heating?',
    expected: {
      intent: 'Air Conditioning / HVAC Issue',
      department: 'Facilities',
      subteam: 'Workplace Services',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // EDGE CASES / WORD COLLISION REGRESSION (TC103–TC115)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'TC103_WORD_COLLISION',
    // 'laptop' must not match 'pto'
    // 'laptop' must not match 'leave'
    subject: 'My laptop battery is dead',
    body: 'The laptop battery does not hold a charge. It dies within 30 minutes even when fully charged. I need a battery replacement or a new laptop.',
    expected: {
      intent: 'Hardware / Laptop Issue',
      department: 'IT',
      subteam: 'End User Support',
      priority: 'high',
      riskLevel: 'High',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC104_WORD_COLLISION',
    // 'emergency' alone does NOT mean IT critical
    subject: 'Emergency leave request — family crisis',
    body: 'I have a family emergency. My parent is in hospital and I need to travel urgently. I need emergency leave starting today. I know this is short notice.',
    expected: {
      intent: 'Emergency Leave Request',
      department: 'HR',
      subteam: 'Leave Management',
      priority: 'medium',
      riskLevel: 'Medium',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  {
    id: 'TC105_WORD_COLLISION',
    // 'emergency' in IT context = critical
    subject: 'Emergency: production server down',
    body: 'Our production server has gone down completely. All customer-facing applications are unavailable. This is an emergency outage affecting all users. Need immediate help.',
    expected: {
      intent: 'Network / System Outage',
      department: 'IT',
      subteam: 'Infrastructure',
      priority: 'critical',
      riskLevel: 'Critical',
      decision: 'ESCALATE',
    },
  },

  {
    id: 'TC106_WORD_COLLISION',
    // 'urgent salary' = Finance, NOT IT despite 'urgent'
    subject: 'Urgent salary correction needed',
    body: 'My salary for this month is significantly less than it should be. I urgently need this corrected. The difference is nearly 15,000.',
    expected: {
      intent: 'Incorrect Salary / Payroll Discrepancy',
      department: 'Finance',
      subteam: 'Payroll Team',
      priority: 'high',
      riskLevel: 'High',
      decision: 'ESCALATE',
    },
  },

  {
    id: 'TC107_WORD_COLLISION',
    // 'urgent leave' = HR, NOT IT despite 'urgent'
    subject: 'Urgent leave request for tomorrow',
    body: 'I urgently need to take leave tomorrow due to a serious personal situation. I know this is last minute but I cannot avoid it.',
    expected: {
      intent: 'Emergency Leave Request',
      department: 'HR',
      subteam: 'Leave Management',
      priority: 'medium',
      riskLevel: 'Medium',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  {
    id: 'TC108',
    subject: 'Company policy on remote work',
    body: 'What is the official company policy on remote working? I want to understand if there are any restrictions on how many days per week I can work from home.',
    expected: {
      intent: 'HR Policy Query',
      department: 'HR',
      subteam: 'HR Support',
      priority: 'low',
      riskLevel: 'Low',
      decision: 'AUTO_RESOLVE',
    },
  },

  {
    id: 'TC109',
    // 'access' alone is NOT enough — context determines department
    subject: 'I cannot access the finance portal',
    body: 'I cannot access the finance portal to approve payments. I get an error saying I am not authorized. Can you please fix this?',
    expected: {
      intent: 'Finance Application Access',
      department: 'Finance',
      subteam: 'Finance Support',
      priority: 'medium',
      riskLevel: 'Medium',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  {
    id: 'TC110',
    // 'access' in IT cloud context
    subject: 'Cannot access Azure DevOps',
    body: 'I need access to our Azure DevOps project. I have been added to the team but keep getting an access denied error when I try to open the project.',
    expected: {
      intent: 'Cloud / SaaS Application Access',
      department: 'IT',
      subteam: 'Identity & Access Management',
      priority: 'medium',
      riskLevel: 'Medium',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  {
    id: 'TC111',
    subject: 'Provident fund withdrawal query',
    body: 'I have resigned from the company and would like to withdraw my provident fund. What is the process and how long does it take?',
    expected: {
      intent: 'Pension / Provident Fund Query',
      department: 'HR',
      subteam: 'Benefits',
      priority: 'low',
      riskLevel: 'Low',
      decision: 'HUMAN_REVIEW',
    },
  },

  {
    id: 'TC112',
    subject: 'Workplace discrimination complaint',
    body: 'I want to raise a formal complaint. I believe I have been discriminated against during the recent promotion decisions due to my gender. I was equally qualified but was passed over.',
    expected: {
      intent: 'Workplace Harassment Complaint',
      department: 'HR',
      subteam: 'Employee Relations',
      priority: 'critical',
      riskLevel: 'Critical',
      decision: 'ESCALATE',
    },
  },

  {
    id: 'TC113',
    // 'password' in SAP context -> SAP Password Reset, not IT Password Reset
    subject: 'SAP password reset request',
    body: 'My SAP password has expired. I need it reset so I can log in and complete my month-end financial entries.',
    expected: {
      intent: 'SAP Password Reset',
      department: 'Finance',
      subteam: 'SAP Basis',
      priority: 'high',
      riskLevel: 'Low',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC114',
    subject: 'General question about company benefits',
    body: 'I am new to the company and wanted to understand what employee benefits are available. Can someone from HR give me an overview?',
    expected: {
      intent: 'Employee Benefits Query',
      department: 'HR',
      subteam: 'Benefits',
      priority: 'low',
      riskLevel: 'Low',
      decision: 'AUTO_RESOLVE',
    },
  },

  {
    id: 'TC115',
    // Semantic test: employee says "need tomorrow off" without using 'leave' explicitly
    subject: 'Need to be away from work tomorrow',
    body: 'Something urgent has come up at home and I need to be away from the office tomorrow. I apologize for the short notice. Can this be approved?',
    expected: {
      intent: 'Emergency Leave Request',
      department: 'HR',
      subteam: 'Leave Management',
      priority: 'medium',
      riskLevel: 'Medium',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  // Additional variation tests (TC116-TC120)

  {
    id: 'TC116',
    subject: 'I need two days off for a family matter',
    body: 'I have a family matter I need to attend to. Can I take two days off from Thursday? I will make sure my pending work is handed over.',
    expected: {
      intent: 'Leave / Time Off Request',
      department: 'HR',
      subteam: 'Leave Management',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  {
    id: 'TC117',
    subject: "My company laptop won't boot",
    body: 'My work laptop is refusing to boot. I press the power button and nothing happens. I need it repaired or replaced as soon as possible.',
    expected: {
      intent: 'Device Not Turning On',
      department: 'IT',
      subteam: 'End User Support',
      priority: 'high',
      riskLevel: 'High',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC118',
    subject: 'VPN connection keeps dropping',
    body: 'When working from home my VPN keeps dropping after 10-15 minutes. I have to reconnect constantly. This is making remote work very frustrating.',
    expected: {
      intent: 'VPN / Remote Access Issue',
      department: 'IT',
      subteam: 'Network Operations',
      priority: 'high',
      riskLevel: 'Medium',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC119',
    subject: 'Expense report approval pending',
    body: 'My expense report from last month is still pending approval. It has been three weeks. Can someone please action this? The total amount is 4,500.',
    expected: {
      intent: 'Expense Reimbursement',
      department: 'Finance',
      subteam: 'Accounts Payable',
      priority: 'medium',
      riskLevel: 'Medium',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  {
    id: 'TC120',
    subject: 'Building fire alarm test tomorrow',
    body: 'I noticed a notice about a fire alarm test tomorrow. I wanted to check if we need to evacuate the building or if it is just a short test.',
    expected: {
      intent: 'Company Policy Query',
      department: 'HR',
      subteam: 'HR Support',
      priority: 'low',
      riskLevel: 'Low',
      decision: 'AUTO_RESOLVE',
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // EXTENDED TEST SUITE — NEW CASES (TC121–TC185)
  // Coverage: HR (leave/payroll/policy), IT (informal/technical), SAP, Finance,
  // Security, Facilities variations, edge cases
  // ═══════════════════════════════════════════════════════════════════════════

  // HR — Leave Variations (TC121–TC125)
  {
    id: 'TC121',
    subject: 'Bereavement leave needed',
    body: 'My grandfather passed away last night. I need to take bereavement leave to attend the funeral and be with my family. I will need at least 3-4 days off starting today.',
    expected: {
      intent: 'Emergency Leave Request',
      department: 'HR',
      subteam: 'Leave Management',
      priority: 'medium',
      riskLevel: 'Medium',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  {
    id: 'TC122',
    subject: 'Half day leave tomorrow morning',
    body: 'I have a medical appointment tomorrow morning from 9 to 12. Can I take a half day leave and come in after lunch? My manager is aware.',
    expected: {
      intent: 'Sick Leave Request',
      department: 'HR',
      subteam: 'Leave Management',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  {
    id: 'TC123',
    subject: 'Leave encashment process query',
    body: 'I have accumulated 25 unused leave days. Can I encash some of these at year end? What is the process and how is the payment calculated?',
    expected: {
      intent: 'Company Policy Query',
      department: 'HR',
      subteam: 'HR Support',
      priority: 'low',
      riskLevel: 'Low',
      decision: 'AUTO_RESOLVE',
    },
  },

  {
    id: 'TC124',
    subject: 'Extended sick leave — doctor note attached',
    body: 'I have been hospitalized due to a serious illness and will be unable to work for the next 3 weeks. My doctor has provided a certificate which I am attaching.',
    expected: {
      intent: 'Sick Leave Request',
      department: 'HR',
      subteam: 'Leave Management',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  {
    id: 'TC125',
    subject: 'Annual leave balance carryover query',
    body: 'I still have 10 days of annual leave remaining and the year is ending. Can I carry these over to next year or will they be forfeited? What is the policy?',
    expected: {
      intent: 'Annual Leave Request',
      department: 'HR',
      subteam: 'Leave Management',
      priority: 'low',
      riskLevel: 'Low',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  // IT — Informal Wording (TC126–TC135)
  {
    id: 'TC126',
    subject: "My computer just froze and won't respond",
    body: 'My computer totally froze up and I cannot do anything. The mouse still moves but nothing responds. I have tried waiting but it has been 20 minutes now.',
    expected: {
      intent: 'Keyboard / Mouse / Peripheral Issue',
      department: 'IT',
      subteam: 'End User Support',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC127',
    subject: 'Keep getting the blue screen of death',
    body: 'My laptop keeps showing a blue screen error (BSOD) and restarting. It happens about 3 times a day. I lose all unsaved work each time. Please fix urgently.',
    expected: {
      intent: 'Application Crash / Software Error',
      department: 'IT',
      subteam: 'End User Support',
      priority: 'high',
      riskLevel: 'Medium',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC128',
    subject: "Can't get into my email",
    body: 'I cannot get into my Outlook email at all today. When I open it it just shows a blank screen. I tried restarting but it is not helping.',
    expected: {
      intent: 'Email / Outlook Issue',
      department: 'IT',
      subteam: 'Collaboration Support',
      priority: 'high',
      riskLevel: 'Medium',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC129',
    subject: 'My keyboard stopped working',
    body: 'My keyboard suddenly stopped working. I press keys but nothing appears on screen. I have tried reconnecting it but it is still not working.',
    expected: {
      intent: 'Monitor / Display Issue',
      department: 'IT',
      subteam: 'End User Support',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC130',
    subject: 'Mouse not responding',
    body: 'My wireless mouse has stopped responding. I have replaced the batteries but it is still not working. I need a replacement mouse to continue working.',
    expected: {
      intent: 'Keyboard / Mouse / Peripheral Issue',
      department: 'IT',
      subteam: 'End User Support',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC131',
    subject: 'Email stuck in outbox',
    body: 'I sent an important email this morning but it is stuck in the Outbox and has not been delivered. I keep seeing it in my outbox but it never leaves. Please help.',
    expected: {
      intent: 'Email / Outlook Issue',
      department: 'IT',
      subteam: 'Collaboration Support',
      priority: 'high',
      riskLevel: 'Medium',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC132',
    subject: 'Cannot hear anything on Teams calls',
    body: 'I cannot hear the other participants on Microsoft Teams calls. My speakers work fine for other things but Teams has no audio. I have tried the audio settings but nothing works.',
    expected: {
      intent: 'Teams / Video Conference Issue',
      department: 'IT',
      subteam: 'Collaboration Support',
      priority: 'high',
      riskLevel: 'Medium',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC133',
    subject: 'Need Adobe Acrobat Pro license',
    body: 'I need an Adobe Acrobat Pro license for my role. I need to create and edit PDF documents for client reports. Can IT please procure a license for me?',
    expected: {
      intent: 'Software License Request',
      department: 'IT',
      subteam: 'End User Support',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  {
    id: 'TC134',
    subject: 'Internet Explorer needed for old application',
    body: 'I need Internet Explorer for an old legacy application that only works in IE. Can IT please install or enable Internet Explorer on my computer?',
    expected: {
      intent: 'Browser / Web Application Issue',
      department: 'IT',
      subteam: 'End User Support',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC135',
    subject: 'Headset microphone not picking up voice',
    body: 'My headset microphone is not picking up my voice during calls. People can hear background noise but not my speech. I have checked the sound settings and it shows the right device.',
    expected: {
      intent: 'Keyboard / Mouse / Peripheral Issue',
      department: 'IT',
      subteam: 'End User Support',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  // SAP Variations (TC136–TC140)
  {
    id: 'TC136',
    subject: 'SAP HR module not showing correct data',
    body: 'There is an issue with the SAP HCM module. Employee records are not showing the updated department transfer information that was processed last week.',
    expected: {
      intent: 'SAP HR Module Issue',
      department: 'Finance',
      subteam: 'SAP Functional Support',
      priority: 'medium',
      riskLevel: 'Medium',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC137',
    subject: 'SAP purchase requisition stuck in workflow',
    body: 'I created a purchase requisition in SAP but it has been stuck in the workflow approval for 5 days. The supplier is waiting. Can someone check why it is not moving?',
    expected: {
      intent: 'SAP Procurement Issue',
      department: 'Finance',
      subteam: 'SAP Functional Support',
      priority: 'high',
      riskLevel: 'High',
      decision: 'ESCALATE',
    },
  },

  {
    id: 'TC138',
    subject: 'SAP basis transport issue',
    body: 'The SAP transport between development and production systems has failed. The ABAP code change is stuck and needs to be moved urgently for the month-end release.',
    expected: {
      intent: 'SAP Basis / Infrastructure Issue',
      department: 'Finance',
      subteam: 'SAP Basis',
      priority: 'critical',
      riskLevel: 'Critical',
      decision: 'ESCALATE',
    },
  },

  {
    id: 'TC139',
    subject: 'Cost center not available in SAP',
    body: 'The new cost center that was created last week is not visible in the SAP finance module. I need to book expenses to this cost center for the Q3 reports.',
    expected: {
      intent: 'SAP Finance Module Issue',
      department: 'Finance',
      subteam: 'SAP Functional Support',
      priority: 'high',
      riskLevel: 'High',
      decision: 'ESCALATE',
    },
  },

  {
    id: 'TC140',
    subject: 'Need SAP profile updated after role change',
    body: 'I have moved from a junior analyst to senior analyst role. My SAP user profile needs to be updated to reflect my new authorization levels as per the role matrix.',
    expected: {
      intent: 'SAP User Creation / Modification',
      department: 'Finance',
      subteam: 'SAP Security',
      priority: 'medium',
      riskLevel: 'Medium',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  // Finance Variations (TC141–TC145)
  {
    id: 'TC141',
    subject: 'Hotel and flight receipts to reimburse',
    body: 'I went on a business trip to Mumbai last week and have hotel and flight receipts totaling 22,000. Please tell me how to submit these for reimbursement.',
    expected: {
      intent: 'Travel Expense Issue',
      department: 'Finance',
      subteam: 'Accounts Payable',
      priority: 'medium',
      riskLevel: 'Medium',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  {
    id: 'TC142',
    subject: 'Need access to finance system to process invoices',
    body: 'I need access to the company finance system to process invoices for the accounts payable team. My manager has approved this request.',
    expected: {
      intent: 'Finance Application Access',
      department: 'Finance',
      subteam: 'Finance Support',
      priority: 'medium',
      riskLevel: 'Medium',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  {
    id: 'TC143',
    subject: 'Q4 budget request',
    body: 'I need to submit a budget request for Q4 for additional headcount in my team. Who do I submit this to and what is the approval process?',
    expected: {
      intent: 'Budget / Financial Planning Query',
      department: 'Finance',
      subteam: 'Finance Support',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'HUMAN_REVIEW',
    },
  },

  {
    id: 'TC144',
    subject: 'Petty cash reimbursement',
    body: 'I spent 850 on office stationery from my own pocket. This was an authorized petty cash purchase. How do I claim reimbursement for this small amount?',
    expected: {
      intent: 'Expense Reimbursement',
      department: 'Finance',
      subteam: 'Accounts Payable',
      priority: 'medium',
      riskLevel: 'Medium',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  {
    id: 'TC145',
    subject: 'Deduction for professional tax query',
    body: 'I noticed a professional tax deduction on my payslip. Can you explain what this deduction is for and how it is calculated each month?',
    expected: {
      intent: 'Tax / Deduction Query',
      department: 'Finance',
      subteam: 'Payroll Team',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'HUMAN_REVIEW',
    },
  },

  // Security Variations (TC146–TC150)
  {
    id: 'TC146',
    subject: 'Received email with suspicious attachment',
    body: 'I received an email from an unknown sender with a suspicious attachment. I did not open it but want to report it to the security team. The email looks like a phishing attempt.',
    expected: {
      intent: 'Phishing / Suspicious Email',
      department: 'IT',
      subteam: 'Security Operations',
      priority: 'high',
      riskLevel: 'High',
      decision: 'ESCALATE',
    },
  },

  {
    id: 'TC147',
    subject: 'Password change forced — account may be compromised',
    body: 'The system forced me to change my password this morning. I am concerned my account may have been accessed by someone else. Can security check if there were any suspicious logins?',
    expected: {
      intent: 'Account Compromise / Unauthorized Access',
      department: 'IT',
      subteam: 'Security Operations',
      priority: 'critical',
      riskLevel: 'Critical',
      decision: 'ESCALATE',
    },
  },

  {
    id: 'TC148',
    subject: 'Unpatched critical CVE in our system',
    body: 'I found that our web server is running a version that is vulnerable to a critical CVE that was published last week. We need to apply the security patch urgently.',
    expected: {
      intent: 'Vulnerability Report',
      department: 'IT',
      subteam: 'Security Operations',
      priority: 'high',
      riskLevel: 'High',
      decision: 'ESCALATE',
    },
  },

  {
    id: 'TC149',
    subject: 'Someone is impersonating our IT department',
    body: 'I received a call from someone claiming to be from IT support asking for my password. I am suspicious this is a social engineering attack. I did not give my password.',
    expected: {
      intent: 'Phishing / Suspicious Email',
      department: 'IT',
      subteam: 'Security Operations',
      priority: 'high',
      riskLevel: 'High',
      decision: 'ESCALATE',
    },
  },

  {
    id: 'TC150',
    subject: 'Customer data found on public internet',
    body: 'A colleague found what appears to be our customer database exposed on a public website. This could be a data breach. We need the security team to investigate immediately.',
    expected: {
      intent: 'Security Incident',
      department: 'IT',
      subteam: 'Incident Response',
      priority: 'critical',
      riskLevel: 'Critical',
      decision: 'ESCALATE',
    },
  },

  // Facilities Variations (TC151–TC155)
  {
    id: 'TC151',
    subject: 'Office parking spot request',
    body: 'I have recently started driving to work and need a parking spot in the office car park. Can I request a permanent parking allocation?',
    expected: {
      intent: 'Parking Request',
      department: 'Facilities',
      subteam: 'Facilities Support',
      priority: 'low',
      riskLevel: 'Low',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  {
    id: 'TC152',
    subject: 'Access card not working',
    body: 'My office access card stopped working this morning. The card reader beeps red and does not let me in. I am waiting in the lobby. Please help.',
    expected: {
      intent: 'Office / Building Access',
      department: 'Facilities',
      subteam: 'Security Desk',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC153',
    subject: 'Toilet on the 3rd floor is broken',
    body: "The toilet in the men's restroom on the 3rd floor is not flushing properly. The flush mechanism seems broken. Can maintenance please look into this?",
    expected: {
      intent: 'Office Maintenance Issue',
      department: 'Facilities',
      subteam: 'Workplace Services',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC154',
    subject: 'Power outage on the 5th floor',
    body: 'There is a power outage on the entire 5th floor. All computers have shut down and the lights are off. We need urgent help from facilities to restore power.',
    expected: {
      intent: 'Electrical Issue',
      department: 'Facilities',
      subteam: 'Workplace Services',
      priority: 'high',
      riskLevel: 'High',
      decision: 'ESCALATE',
    },
  },

  {
    id: 'TC155',
    subject: 'Hot desk booking for next week',
    body: 'I need to book a hot desk for next Monday and Tuesday. I will be coming to the office for those two days and want to reserve a workspace in advance.',
    expected: {
      intent: 'Desk / Workspace Allocation',
      department: 'Facilities',
      subteam: 'Facilities Support',
      priority: 'low',
      riskLevel: 'Low',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  // General / Policy Variations (TC156–TC165)
  {
    id: 'TC156',
    subject: 'What is the expense claim policy?',
    body: 'Can you share the company policy on expense claims? I want to understand what types of expenses are reimbursable and the approval process.',
    expected: {
      intent: 'Company Policy Query',
      department: 'HR',
      subteam: 'HR Support',
      priority: 'low',
      riskLevel: 'Low',
      decision: 'AUTO_RESOLVE',
    },
  },

  {
    id: 'TC157',
    subject: 'Who is the head of the finance team?',
    body: 'I need to contact the head of the finance department. Can you share their contact details or tell me who to reach out to for finance-related queries?',
    expected: {
      intent: 'Employee Directory / Organization Query',
      department: 'HR',
      subteam: 'HR Support',
      priority: 'low',
      riskLevel: 'Low',
      decision: 'AUTO_RESOLVE',
    },
  },

  {
    id: 'TC158',
    subject: 'Suggestion for office improvement',
    body: 'I have a suggestion to improve collaboration in our office. Could we add more open seating areas and informal meeting spaces? Would like to share this feedback.',
    expected: {
      intent: 'Feedback / Suggestion',
      department: 'HR',
      subteam: 'HR Support',
      priority: 'low',
      riskLevel: 'Low',
      decision: 'AUTO_RESOLVE',
    },
  },

  {
    id: 'TC159',
    subject: 'New joiner IT setup needed',
    body: 'I am starting next Monday and wanted to ask what IT equipment I will receive. Will I get a laptop, phone, and other accessories on my first day?',
    expected: {
      intent: 'New Employee IT Setup',
      department: 'IT',
      subteam: 'End User Support',
      priority: 'high',
      riskLevel: 'Low',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC160',
    subject: 'Code of conduct clarification',
    body: 'I want to understand the code of conduct regarding social media usage. Can I post about my work on LinkedIn? Are there any restrictions on what I can share?',
    expected: {
      intent: 'Company Policy Query',
      department: 'HR',
      subteam: 'HR Support',
      priority: 'low',
      riskLevel: 'Low',
      decision: 'AUTO_RESOLVE',
    },
  },

  // Additional Edge Cases (TC161–TC175)
  {
    id: 'TC161',
    subject: 'Cannot log into any company application',
    body: 'Since this morning I cannot log into any company application. My email, Teams, and HR portal all show authentication failures. I have not changed my password recently.',
    expected: {
      intent: 'Password Reset',
      department: 'IT',
      subteam: 'Identity & Access Management',
      priority: 'high',
      riskLevel: 'Medium',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC162',
    subject: 'Application keeps crashing mid-work',
    body: 'My accounting software keeps crashing every time I try to run a report. The application closes itself without warning and I lose all my work. This is very disruptive.',
    expected: {
      intent: 'Application Crash / Software Error',
      department: 'IT',
      subteam: 'End User Support',
      priority: 'high',
      riskLevel: 'Medium',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC163',
    subject: 'I need a new laptop — mine is 5 years old',
    body: 'My current company laptop is 5 years old and is extremely slow. It is affecting my productivity. I would like to request a laptop refresh. My manager supports this request.',
    expected: {
      intent: 'Hardware / Laptop Issue',
      department: 'IT',
      subteam: 'End User Support',
      priority: 'high',
      riskLevel: 'High',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC164',
    subject: 'Provident fund statement not received',
    body: 'I have not received my annual provident fund statement for last year. Can you send me the statement or let me know how to access it online?',
    expected: {
      intent: 'Pension / Provident Fund Query',
      department: 'HR',
      subteam: 'Benefits',
      priority: 'low',
      riskLevel: 'Low',
      decision: 'HUMAN_REVIEW',
    },
  },

  {
    id: 'TC165',
    subject: 'Health insurance card not received',
    body: 'I joined the company 2 months ago and was told I would receive a health insurance card. I have not received it yet. Can you help me get my insurance activated?',
    expected: {
      intent: 'Insurance / Medical Benefits Query',
      department: 'HR',
      subteam: 'Benefits',
      priority: 'medium',
      riskLevel: 'Medium',
      decision: 'HUMAN_REVIEW',
    },
  },

  // Informal / Short Message Variants (TC166–TC170)
  {
    id: 'TC166',
    subject: 'Sick today',
    body: 'Hi, feeling unwell today. Taking a sick day. Will be back tomorrow hopefully.',
    expected: {
      intent: 'Sick Leave Request',
      department: 'HR',
      subteam: 'Leave Management',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  {
    id: 'TC167',
    subject: 'Laptop dead',
    body: "My laptop has died. Screen is black and won't turn on. Need help urgently.",
    expected: {
      intent: 'Device Not Turning On',
      department: 'IT',
      subteam: 'End User Support',
      priority: 'high',
      riskLevel: 'High',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC168',
    subject: 'WiFi down in the office',
    body: 'WiFi is not working in the whole office. Nobody can connect. Please send IT team.',
    expected: {
      intent: 'Network / WiFi Issue',
      department: 'IT',
      subteam: 'Network Operations',
      priority: 'high',
      riskLevel: 'Low',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC169',
    subject: 'Forgot SAP password',
    body: 'I forgot my SAP password. Please reset it so I can get back to work.',
    expected: {
      intent: 'SAP Password Reset',
      department: 'Finance',
      subteam: 'SAP Basis',
      priority: 'high',
      riskLevel: 'Low',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC170',
    subject: 'Salary missing from account',
    body: 'Salary has not come yet. It is the 3rd of the month. Please check urgently.',
    expected: {
      intent: 'Salary Not Received',
      department: 'HR',
      subteam: 'Payroll',
      priority: 'critical',
      riskLevel: 'Critical',
      decision: 'ESCALATE',
    },
  },

  // Enterprise / Technical Wording (TC171–TC180)
  {
    id: 'TC171',
    subject: 'SSO not working for cloud applications',
    body: 'The Single Sign-On is not working for our cloud applications including Salesforce and ServiceNow. I have to manually enter credentials each time. This needs to be fixed.',
    expected: {
      intent: 'Cloud / SaaS Application Access',
      department: 'IT',
      subteam: 'Identity & Access Management',
      priority: 'medium',
      riskLevel: 'Medium',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  {
    id: 'TC172',
    subject: 'Active Directory account needs updating',
    body: 'My Active Directory account has the wrong department and manager information. This is causing issues with application access and email distribution groups.',
    expected: {
      intent: 'Email / Outlook Issue',
      department: 'IT',
      subteam: 'Collaboration Support',
      priority: 'high',
      riskLevel: 'Medium',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC173',
    subject: 'SAP authorization for accounts payable report',
    body: 'I need authorization to run the monthly accounts payable aging report in SAP. The report is in the FI module under financial reporting. Please add the required SAP role.',
    expected: {
      intent: 'SAP Role / Authorization Request',
      department: 'Finance',
      subteam: 'SAP Security',
      priority: 'medium',
      riskLevel: 'High',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  {
    id: 'TC174',
    subject: 'Request for salary certificate',
    body: 'I am applying for a bank loan and need a salary certificate from the company on company letterhead. Could HR please issue this document at the earliest?',
    expected: {
      intent: 'Payslip / Pay Stub Request',
      department: 'HR',
      subteam: 'Payroll',
      priority: 'low',
      riskLevel: 'Low',
      decision: 'AUTO_RESOLVE',
    },
  },

  {
    id: 'TC175',
    subject: 'Incident: production database unreachable',
    body: 'The production database server is unreachable. All business applications that rely on this database are down. This is a critical incident affecting all users across the organization.',
    expected: {
      intent: 'Network / System Outage',
      department: 'IT',
      subteam: 'Infrastructure',
      priority: 'critical',
      riskLevel: 'Critical',
      decision: 'ESCALATE',
    },
  },

  {
    id: 'TC176',
    subject: 'Two weeks notice — resignation',
    body: 'I would like to formally tender my resignation effective two weeks from today. Please guide me on the handover process and exit formalities.',
    expected: {
      intent: 'Employee Offboarding Request',
      department: 'HR',
      subteam: 'HR Operations',
      priority: 'low',
      riskLevel: 'Low',
      decision: 'HUMAN_REVIEW',
    },
  },

  {
    id: 'TC177',
    subject: 'VPN token / RSA token not working',
    body: 'My RSA token for VPN access has stopped generating codes. Without it I cannot connect to VPN and work from home today. Can IT replace it urgently?',
    expected: {
      intent: 'VPN / Remote Access Issue',
      department: 'IT',
      subteam: 'Network Operations',
      priority: 'high',
      riskLevel: 'Medium',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC178',
    subject: 'Printing issue — wrong printer selected',
    body: 'My default printer is sending all jobs to a printer on another floor. I cannot change it myself as the setting seems locked. Can IT fix the default printer for my machine?',
    expected: {
      intent: 'Printer / Peripheral Issue',
      department: 'IT',
      subteam: 'End User Support',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC179',
    subject: 'Office parking allocation change',
    body: 'My current parking slot is very far from the building entrance. I have a knee injury and walking long distances is painful. Can I request a parking slot closer to the entrance?',
    expected: {
      intent: 'Parking Request',
      department: 'Facilities',
      subteam: 'Facilities Support',
      priority: 'low',
      riskLevel: 'Low',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  {
    id: 'TC180',
    subject: 'Induction training schedule for new joiner',
    body: 'I joined the company last week and have not been given an induction schedule. When can I expect to attend orientation and meet the various teams?',
    expected: {
      intent: 'Employee Onboarding Request',
      department: 'HR',
      subteam: 'HR Operations',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC181',
    subject: 'Grievance against team lead',
    body: 'I would like to raise a formal grievance against my team lead. They have been assigning all tedious tasks to me while giving interesting work to others. I feel this is unfair treatment.',
    expected: {
      intent: 'Employee Grievance',
      department: 'HR',
      subteam: 'Employee Relations',
      priority: 'high',
      riskLevel: 'Critical',
      decision: 'ESCALATE',
    },
  },

  {
    id: 'TC182',
    subject: 'Office guest registration process',
    body: 'I have a client visiting our office tomorrow for a partnership meeting. How do I pre-register them so they can enter the building smoothly without waiting at reception?',
    expected: {
      intent: 'Visitor Access / Guest Badge',
      department: 'Facilities',
      subteam: 'Security Desk',
      priority: 'low',
      riskLevel: 'Low',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC183',
    subject: 'Salary advance due to emergency medical expense',
    body: 'My mother requires urgent surgery and I need to pay the hospital a deposit of 30,000 immediately. I need a salary advance to cover this emergency medical expense.',
    expected: {
      intent: 'Salary Advance Request',
      department: 'Finance',
      subteam: 'Payroll Team',
      priority: 'medium',
      riskLevel: 'Medium',
      decision: 'APPROVAL_REQUIRED',
    },
  },

  {
    id: 'TC184',
    subject: 'Cannot submit timesheet in HR system',
    body: 'I am unable to submit my timesheet in the HR self-service portal. The submit button is greyed out and I cannot complete my weekly time entry. This is urgent as today is the deadline.',
    expected: {
      intent: 'SharePoint / Intranet Access',
      department: 'IT',
      subteam: 'Collaboration Support',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },

  {
    id: 'TC185',
    subject: 'Network switch not working on our floor',
    body: 'The network switch servicing our team area seems to have failed. All 12 people on our side of the floor have lost network access. Only this area is affected.',
    expected: {
      intent: 'LAN / Wired Network Issue',
      department: 'IT',
      subteam: 'Network Operations',
      priority: 'medium',
      riskLevel: 'Low',
      decision: 'DEPARTMENT_PROCESSING',
    },
  },
];

// ─── Test Dataset Summary ─────────────────────────────────────────────────────

export const TEST_DATASET_SUMMARY = {
  total: CLASSIFICATION_TEST_CASES.length,
  byDepartment: {
    HR: CLASSIFICATION_TEST_CASES.filter((tc) => tc.expected.department === 'HR').length,
    IT: CLASSIFICATION_TEST_CASES.filter((tc) => tc.expected.department === 'IT').length,
    Finance: CLASSIFICATION_TEST_CASES.filter((tc) => tc.expected.department === 'Finance').length,
    Facilities: CLASSIFICATION_TEST_CASES.filter((tc) => tc.expected.department === 'Facilities').length,
  },
  regressionCases: CLASSIFICATION_TEST_CASES.filter((tc) => tc.id.includes('REGRESSION')).length,
  wordCollisionCases: CLASSIFICATION_TEST_CASES.filter((tc) => tc.id.includes('WORD_COLLISION')).length,
};
