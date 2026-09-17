/**
 * lib/resolution-templates.ts
 *
 * ITSM-grade intent-based template registry for resolution email drafts.
 *
 * Design principles:
 *   - Zero AI involvement in sensitive field values (no hallucination risk)
 *   - All sensitive fields are form inputs filled by the engineer
 *   - Adding a new intent type = add ONE entry to RESOLUTION_TEMPLATES array
 *   - No other files need to change when new templates are added
 *
 * Exports:
 *   RESOLUTION_TEMPLATES  — full registry
 *   detectTemplate()      — keyword + dept matching, generic fallback
 *   renderPreview()       — generates email text from filled fields
 *   getAllTemplateOptions()— [{ id, label }] for dropdown
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type DraftFieldType = 'text' | 'password' | 'url' | 'email' | 'date' | 'textarea';

export interface DraftField {
  id: string;
  label: string;
  type: DraftFieldType;
  required: boolean;
  /** Shown in email preview when field is empty: "[SAP User ID]" */
  placeholder: string;
  /** Helper text shown under the input */
  hint?: string;
}

export interface DraftSection {
  heading?: string;
  intro?: string;
  fields: DraftField[];
}

export interface ResolutionTemplate {
  id: string;
  /** Human-readable name shown in the template dropdown */
  label: string;
  /** Intent/ticket-body keywords used for auto-detection (lowercase) */
  keywords: string[];
  /** Optional department hints for fallback matching (lowercase) */
  departments?: string[];
  /** Email subject line; use {{name}} for employee name */
  subject: string;
  /** Opening paragraph after greeting */
  intro: string;
  sections: DraftSection[];
  /** Sign-off team name */
  closing: string;
}

// ─── Template Registry ────────────────────────────────────────────────────────
//
//  To add a new intent type:
//    1. Append a new ResolutionTemplate object to RESOLUTION_TEMPLATES below.
//    2. Done. No other files need modification.

export const RESOLUTION_TEMPLATES: ResolutionTemplate[] = [

  // ── SAP Access ───────────────────────────────────────────────────────────────
  {
    id: 'sap_access',
    label: 'SAP S/4HANA Access',
    keywords: ['sap', 's/4hana', 'erp', 'sap access', 'sap login', 'sap system', 'sap module', 'sap user', 'sap fiori'],
    departments: ['finance', 'accounting', 'procurement', 'supply chain'],
    subject: 'SAP S/4HANA Access Provisioned — {{name}}',
    intro: 'Your SAP access request has been approved and provisioned. Please find your login details below.',
    sections: [
      {
        heading: 'Access Credentials',
        fields: [
          { id: 'sap_user_id',     label: 'SAP User ID',           type: 'text',     required: true,  placeholder: '[SAP User ID]',           hint: 'e.g. USR-12345' },
          { id: 'temp_password',   label: 'Temporary Password',     type: 'password', required: true,  placeholder: '[Temporary Password]',    hint: 'Must be changed on first login' },
          { id: 'login_url',       label: 'Login URL',              type: 'url',      required: true,  placeholder: '[Login URL]',              hint: 'SAP Fiori / WebGUI URL' },
          { id: 'assigned_roles',  label: 'Assigned Roles',         type: 'text',     required: true,  placeholder: '[Assigned Roles]',        hint: 'e.g. FI_VIEWER, MM_PURCHASER' },
        ],
      },
      {
        heading: 'Additional Instructions',
        fields: [
          { id: 'instructions', label: 'First-Login Instructions', type: 'textarea', required: false, placeholder: '[Additional Instructions]', hint: 'Password policy, 2FA setup, etc.' },
        ],
      },
    ],
    closing: 'Finance IT Support',
  },

  // ── VPN Access ───────────────────────────────────────────────────────────────
  {
    id: 'vpn_access',
    label: 'VPN Access',
    keywords: ['vpn', 'virtual private network', 'remote access', 'vpn client', 'vpn connection', 'remote work', 'work from home', 'wfh', 'vpn setup'],
    subject: 'VPN Access Provisioned — {{name}}',
    intro: 'Your VPN access has been configured. Please use the following details to establish your secure connection.',
    sections: [
      {
        heading: 'VPN Credentials',
        fields: [
          { id: 'vpn_username',  label: 'VPN Username',          type: 'text',     required: true,  placeholder: '[VPN Username]' },
          { id: 'vpn_password',  label: 'Temporary Password',    type: 'password', required: true,  placeholder: '[Temporary Password]' },
          { id: 'vpn_server',    label: 'VPN Server',            type: 'text',     required: true,  placeholder: '[VPN Server]',    hint: 'e.g. vpn.company.com' },
          { id: 'vpn_download',  label: 'VPN Client Download',   type: 'url',      required: false, placeholder: '[VPN Client Download URL]' },
        ],
      },
      {
        heading: 'Setup Notes',
        fields: [
          { id: 'setup_notes', label: 'Connection Instructions', type: 'textarea', required: false, placeholder: '[Setup Instructions]', hint: 'Protocol, port, certificate steps, etc.' },
        ],
      },
    ],
    closing: 'IT Infrastructure Team',
  },

  // ── Outlook / Email Mailbox ───────────────────────────────────────────────────
  {
    id: 'outlook_mailbox',
    label: 'Outlook / Email Mailbox',
    keywords: ['outlook', 'email', 'mailbox', 'office 365', 'microsoft 365', 'o365', 'm365', 'email account', 'email access', 'mail setup', 'corporate email', 'exchange'],
    subject: 'Email Mailbox Ready — {{name}}',
    intro: 'Your corporate email account has been set up and is ready to use. Please find your account details below.',
    sections: [
      {
        heading: 'Account Details',
        fields: [
          { id: 'email_address',  label: 'Email Address',        type: 'email',    required: true,  placeholder: '[Email Address]' },
          { id: 'temp_password',  label: 'Temporary Password',   type: 'password', required: true,  placeholder: '[Temporary Password]' },
          { id: 'login_url',      label: 'Outlook Login URL',    type: 'url',      required: false, placeholder: '[Login URL]', hint: 'https://outlook.office365.com' },
          { id: 'mailbox_size',   label: 'Mailbox Size',         type: 'text',     required: false, placeholder: '[Mailbox Size]', hint: 'e.g. 50 GB' },
        ],
      },
    ],
    closing: 'IT Support Team',
  },

  // ── Software / License ────────────────────────────────────────────────────────
  {
    id: 'software_license',
    label: 'Software / License Installation',
    keywords: ['software', 'license', 'installation', 'install', 'application', 'app license', 'software access', 'tool access', 'software request', 'software install'],
    subject: 'Software Installation Complete — {{name}}',
    intro: 'The software you requested has been installed and/or licensed. Please see the details below.',
    sections: [
      {
        heading: 'Software Details',
        fields: [
          { id: 'software_name',      label: 'Software Name',          type: 'text',     required: true,  placeholder: '[Software Name]' },
          { id: 'version',            label: 'Version',                type: 'text',     required: false, placeholder: '[Version]' },
          { id: 'license_key',        label: 'License Key',            type: 'text',     required: false, placeholder: '[License Key]', hint: 'Leave blank if volume/enterprise licensed' },
          { id: 'expiry',             label: 'License Expiry',         type: 'date',     required: false, placeholder: '[Expiry Date]' },
          { id: 'activation_steps',   label: 'Activation Instructions', type: 'textarea', required: false, placeholder: '[Activation Instructions]' },
        ],
      },
    ],
    closing: 'IT Software Team',
  },

  // ── Password Reset ────────────────────────────────────────────────────────────
  {
    id: 'password_reset',
    label: 'Password Reset',
    keywords: ['password', 'reset password', 'forgot password', 'password expired', 'unlock account', 'locked account', 'account unlock', 'credentials reset', 'account locked'],
    subject: 'Password Reset Complete — {{name}}',
    intro: 'Your account password has been reset. Please log in with the temporary credentials below and change your password immediately.',
    sections: [
      {
        heading: 'Reset Credentials',
        fields: [
          { id: 'system',         label: 'System / Application',  type: 'text',     required: true,  placeholder: '[System Name]' },
          { id: 'username',       label: 'Username / User ID',    type: 'text',     required: true,  placeholder: '[Username]' },
          { id: 'temp_password',  label: 'Temporary Password',    type: 'password', required: true,  placeholder: '[Temporary Password]' },
          { id: 'login_url',      label: 'Login URL',             type: 'url',      required: false, placeholder: '[Login URL]' },
          { id: 'expiry_note',    label: 'Password Expiry Policy', type: 'text',    required: false, placeholder: '[e.g. Must be changed within 24 hours]' },
        ],
      },
    ],
    closing: 'IT Security Team',
  },

  // ── Laptop / Hardware Allocation ──────────────────────────────────────────────
  {
    id: 'laptop_allocation',
    label: 'Laptop / Hardware Allocation',
    keywords: ['laptop', 'hardware', 'device', 'computer', 'workstation', 'equipment', 'laptop allocation', 'new device', 'asset', 'desktop', 'monitor', 'keyboard', 'accessories'],
    subject: 'Device Allocation Confirmed — {{name}}',
    intro: 'Your hardware allocation request has been processed. Please find the device details below.',
    sections: [
      {
        heading: 'Device Details',
        fields: [
          { id: 'device_model',     label: 'Device Model',           type: 'text',  required: true,  placeholder: '[Device Model]',     hint: 'e.g. Dell Latitude 5540' },
          { id: 'asset_id',         label: 'Asset ID / Tag',         type: 'text',  required: true,  placeholder: '[Asset ID]' },
          { id: 'serial_number',    label: 'Serial Number',          type: 'text',  required: false, placeholder: '[Serial Number]' },
          { id: 'handover_date',    label: 'Handover Date',          type: 'date',  required: false, placeholder: '[Handover Date]' },
          { id: 'pickup_location',  label: 'Pickup / Delivery Location', type: 'text', required: false, placeholder: '[Location]' },
        ],
      },
    ],
    closing: 'IT Asset Management',
  },

  // ── Database Access ───────────────────────────────────────────────────────────
  {
    id: 'database_access',
    label: 'Database Access',
    keywords: ['database', 'db', 'sql', 'oracle', 'mysql', 'postgresql', 'postgres', 'mssql', 'data access', 'db access', 'schema access', 'database login', 'data warehouse'],
    subject: 'Database Access Granted — {{name}}',
    intro: 'Your database access request has been approved and your credentials have been configured.',
    sections: [
      {
        heading: 'Database Credentials',
        fields: [
          { id: 'db_name',      label: 'Database Name',    type: 'text',     required: true,  placeholder: '[Database Name]' },
          { id: 'db_server',    label: 'Server / Host',    type: 'text',     required: true,  placeholder: '[Server Host]',    hint: 'e.g. db-prod-01.company.com' },
          { id: 'db_username',  label: 'Username',         type: 'text',     required: true,  placeholder: '[Database Username]' },
          { id: 'db_password',  label: 'Password',         type: 'password', required: true,  placeholder: '[Database Password]' },
          { id: 'db_schema',    label: 'Schema / Tables',  type: 'text',     required: false, placeholder: '[Schema Access]' },
          { id: 'db_port',      label: 'Port',             type: 'text',     required: false, placeholder: '[Port]', hint: 'e.g. 5432, 1433, 3306' },
        ],
      },
    ],
    closing: 'Database Administration Team',
  },

  // ── Leave Request ─────────────────────────────────────────────────────────────
  {
    id: 'leave_request',
    label: 'Leave Request',
    // NOTE: No departments[] — must only match via keywords, never via department fallback.
    // This prevents any HR ticket from defaulting to the Leave Request form.
    keywords: ['leave', 'vacation', 'annual leave', 'sick leave', 'leave request', 'leave approval', 'time off', 'pto', 'paid leave', 'holiday', 'maternity', 'paternity', 'casual leave'],
    subject: 'Leave Request Approved — {{name}}',
    intro: 'Your leave request has been reviewed and approved. Please find the approved leave details below.',
    sections: [
      {
        heading: 'Leave Details',
        fields: [
          { id: 'leave_type',    label: 'Leave Type',           type: 'text',     required: true,  placeholder: '[Leave Type]',       hint: 'e.g. Annual Leave, Sick Leave, Casual Leave' },
          { id: 'approved_from', label: 'Approved From',        type: 'date',     required: true,  placeholder: '[Start Date]' },
          { id: 'approved_to',   label: 'Approved To',          type: 'date',     required: true,  placeholder: '[End Date]' },
          { id: 'days',          label: 'Total Days',           type: 'text',     required: false, placeholder: '[Number of Days]' },
          { id: 'balance',       label: 'Remaining Balance',    type: 'text',     required: false, placeholder: '[Remaining Leave Balance]' },
          { id: 'notes',         label: 'Notes',                type: 'textarea', required: false, placeholder: '[Any additional notes]' },
        ],
      },
    ],
    closing: 'HR Department',
  },

  // ── Payroll Issue ─────────────────────────────────────────────────────────────
  {
    id: 'payroll_issue',
    label: 'Payroll Issue',
    // NOTE: No departments[] — matched by keywords only.
    keywords: ['payroll', 'salary', 'pay slip', 'payslip', 'compensation', 'salary issue', 'payroll error', 'pay correction', 'reimbursement', 'wage', 'overtime pay', 'ctc'],
    subject: 'Payroll Issue Resolved — {{name}}',
    intro: 'Your payroll query has been reviewed and resolved by our team. The correction details are provided below.',
    sections: [
      {
        heading: 'Payroll Correction Details',
        fields: [
          { id: 'pay_period',        label: 'Pay Period',             type: 'text',     required: true,  placeholder: '[Pay Period]',       hint: 'e.g. June 2026' },
          { id: 'issue_type',        label: 'Issue Type',             type: 'text',     required: false, placeholder: '[Issue Description]' },
          { id: 'corrected_amount',  label: 'Corrected Amount',       type: 'text',     required: false, placeholder: '[Corrected Amount]' },
          { id: 'processing_date',   label: 'Processing / Payout Date', type: 'date',   required: false, placeholder: '[Processing Date]' },
          { id: 'resolution_note',   label: 'Resolution Summary',     type: 'textarea', required: true,  placeholder: '[Summary of what was corrected]' },
        ],
      },
    ],
    closing: 'Payroll & Compensation Team',
  },

  // ── Network / Wi-Fi Access ────────────────────────────────────────────────────
  {
    id: 'network_access',
    label: 'Network / Wi-Fi Access',
    keywords: ['network', 'wifi', 'wi-fi', 'wireless', 'lan', 'network access', 'internet access', 'connectivity', 'network permission', 'intranet', 'firewall'],
    subject: 'Network Access Configured — {{name}}',
    intro: 'Your network access request has been processed and configured.',
    sections: [
      {
        heading: 'Network Details',
        fields: [
          { id: 'network_name',     label: 'Network / SSID',            type: 'text',     required: true,  placeholder: '[Network Name]' },
          { id: 'network_password', label: 'Network Password',          type: 'password', required: false, placeholder: '[Network Password]' },
          { id: 'access_level',     label: 'Access Level / VLANs',      type: 'text',     required: false, placeholder: '[Access Level]' },
          { id: 'mac_registered',   label: 'Device MAC Registered',     type: 'text',     required: false, placeholder: '[MAC Address]' },
        ],
      },
    ],
    closing: 'Network Operations Team',
  },

  // ── Cloud / SaaS Application ──────────────────────────────────────────────────
  {
    id: 'cloud_saas_access',
    label: 'Cloud / SaaS Application Access',
    keywords: ['cloud', 'saas', 'salesforce', 'servicenow', 'jira', 'confluence', 'slack', 'teams', 'zoom', 'github', 'azure', 'aws', 'google workspace', 'portal access', 'web application'],
    subject: 'Application Access Provisioned — {{name}}',
    intro: 'Your access to the requested application has been provisioned. Please find your login details below.',
    sections: [
      {
        heading: 'Access Details',
        fields: [
          { id: 'app_name',       label: 'Application',         type: 'text',     required: true,  placeholder: '[Application Name]' },
          { id: 'login_url',      label: 'Login URL',           type: 'url',      required: true,  placeholder: '[Login URL]' },
          { id: 'username',       label: 'Username / Email',    type: 'email',    required: true,  placeholder: '[Username]' },
          { id: 'temp_password',  label: 'Temporary Password',  type: 'password', required: false, placeholder: '[Temporary Password]' },
          { id: 'role',           label: 'Assigned Role',       type: 'text',     required: false, placeholder: '[Role / Permission Level]' },
        ],
      },
    ],
    closing: 'IT Support Team',
  },

  // ── Onboarding ────────────────────────────────────────────────────────────────
  {
    id: 'onboarding',
    label: 'Employee Onboarding',
    // NOTE: No departments[] — matched by keywords only.
    keywords: ['onboarding', 'new employee', 'new joiner', 'new hire', 'joining', 'induction', 'new staff', 'new team member'],
    subject: 'Onboarding Setup Complete — {{name}}',
    intro: 'Welcome! Your onboarding setup has been completed. Please find all your access details and first-day instructions below.',
    sections: [
      {
        heading: 'System Access',
        fields: [
          { id: 'employee_id',    label: 'Employee ID',           type: 'text',     required: true,  placeholder: '[Employee ID]' },
          { id: 'email',          label: 'Corporate Email',       type: 'email',    required: true,  placeholder: '[Corporate Email]' },
          { id: 'temp_password',  label: 'Temporary Password',    type: 'password', required: true,  placeholder: '[Temporary Password]' },
          { id: 'systems_access', label: 'Systems Provisioned',   type: 'textarea', required: false, placeholder: '[List of systems / applications provisioned]' },
        ],
      },
      {
        heading: 'First Day Info',
        fields: [
          { id: 'reporting_manager', label: 'Reporting Manager',   type: 'text',     required: false, placeholder: '[Manager Name]' },
          { id: 'first_day_location', label: 'Location / Floor',  type: 'text',     required: false, placeholder: '[Office Location]' },
          { id: 'induction_schedule', label: 'Induction Schedule', type: 'textarea', required: false, placeholder: '[Schedule / agenda for first week]' },
        ],
      },
    ],
    closing: 'HR & IT Onboarding Team',
  },

  // ── IT Generic Fallback ───────────────────────────────────────────────────────
  {
    id: 'it_generic',
    label: 'IT Support — General Resolution',
    keywords: [],
    departments: ['it', 'information technology', 'technical support', 'helpdesk', 'tech support'],
    subject: 'Your IT Request Has Been Resolved — {{name}}',
    intro: 'Your IT support request has been reviewed and resolved by our team.',
    sections: [
      {
        heading: 'Resolution Summary',
        fields: [
          { id: 'issue_description', label: 'Issue Resolved',          type: 'text',     required: true,  placeholder: '[Description of what was resolved]' },
          { id: 'resolution_steps',  label: 'Actions Taken',           type: 'textarea', required: true,  placeholder: '[Summary of actions taken]' },
          { id: 'next_steps',        label: 'Next Steps For You',      type: 'textarea', required: false, placeholder: '[Any steps the employee needs to take]' },
        ],
      },
    ],
    closing: 'IT Helpdesk Team',
  },

  // ── Workplace Harassment / Employee Relations ─────────────────────────────────
  {
    id: 'workplace_harassment',
    label: 'HR — Workplace Harassment / Employee Relations',
    // Matched by intent keywords OR by subteam = 'employee relations' (handled in detectTemplate)
    keywords: [
      'harassment', 'workplace harassment', 'hostile work', 'misconduct', 'inappropriate behaviour',
      'inappropriate behavior', 'bullying', 'discrimination', 'hostile environment',
      'employee relations', 'confidential complaint', 'hr complaint', 'hr investigation',
      'colleague complaint', 'unsafe work', 'hr escalation', 'verbal abuse', 'intimidation',
    ],
    departments: [],  // matched by keyword + subteam only, never by dept fallback
    subject: 'Your HR Case Has Been Acknowledged — {{name}}',
    intro:
      'Thank you for bringing this matter to our attention. ' +
      'Your complaint has been received and is being handled confidentially by our HR Employee Relations team. ' +
      'We take all workplace concerns seriously and are committed to a safe, respectful work environment.',
    sections: [
      {
        heading: 'Case Acknowledgement',
        fields: [
          {
            id: 'case_reference',
            label: 'Case Reference',
            type: 'text',
            required: true,
            placeholder: '[Case Reference / HR Case ID]',
            hint: 'Internal HR case reference number',
          },
          {
            id: 'investigation_status',
            label: 'Investigation Status',
            type: 'text',
            required: true,
            placeholder: '[e.g. Investigation Initiated / Under Review / Referred]',
            hint: 'Current status of the HR investigation',
          },
          {
            id: 'assigned_hr_officer',
            label: 'Assigned HR Officer',
            type: 'text',
            required: true,
            placeholder: '[HR Officer Name]',
            hint: 'The HR Employee Relations officer handling this case',
          },
        ],
      },
      {
        heading: 'Next Steps',
        fields: [
          {
            id: 'action_date',
            label: 'Next Action Date',
            type: 'date',
            required: true,
            placeholder: '[Date]',
            hint: 'Date of next follow-up or action',
          },
          {
            id: 'internal_resolution_summary',
            label: 'Internal Resolution Summary',
            type: 'textarea',
            required: true,
            placeholder: '[Summary of actions taken / investigation outcome — internal only]',
            hint: 'This is NEVER sent to the employee. Used internally by HR.',
          },
          {
            id: 'next_steps_for_employee',
            label: 'Message to Employee',
            type: 'textarea',
            required: false,
            placeholder: '[What the employee should expect next — safe to share]',
            hint: 'This text IS included in the response email to the employee.',
          },
        ],
      },
    ],
    closing: 'HR Employee Relations Team',
  },

  // ── HR Generic Fallback ───────────────────────────────────────────────────────
  {
    id: 'hr_generic',
    label: 'HR Support — General Resolution',
    keywords: [],
    // Only the two generic fallbacks use departments[] for matching.
    departments: ['hr', 'human resources', 'people operations', 'talent', 'people team'],
    subject: 'Your HR Request Has Been Resolved — {{name}}',
    intro: 'Your HR request has been reviewed and processed by our team.',
    sections: [
      {
        heading: 'Resolution Summary',
        fields: [
          { id: 'issue_description', label: 'Request Summary',         type: 'text',     required: true,  placeholder: '[Description of request]' },
          { id: 'resolution',        label: 'Resolution',              type: 'textarea', required: true,  placeholder: '[What was done to resolve the request]' },
          { id: 'effective_date',    label: 'Effective Date',          type: 'date',     required: false, placeholder: '[Effective Date if applicable]' },
          { id: 'next_steps',        label: 'Next Steps',              type: 'textarea', required: false, placeholder: '[Any steps the employee needs to take]' },
        ],
      },
    ],
    closing: 'HR Department',
  },
];

// ─── Template Detection ───────────────────────────────────────────────────────

/**
 * Detects the best matching template for a given ticket.
 *
 * Matching priority:
 *   1. Subteam match — "Employee Relations" → workplace_harassment (before keyword scan)
 *   2. Keyword match in intent + ticketBody (first match wins)
 *   3. Department-hint match (only for templates that explicitly set departments[];
 *      this now applies ONLY to the generic fallbacks hr_generic and it_generic).
 *   4. HR department → hr_generic
 *   5. IT generic fallback
 *
 * @param intent      - The ticket intent string
 * @param ticketBody  - Email body or ticket body text
 * @param department  - Department name (e.g. "HR", "IT")
 * @param subteam     - Sub-team / team_name (e.g. "Employee Relations", "Payroll Team")
 */
export function detectTemplate(
  intent: string,
  ticketBody: string,
  department: string,
  subteam: string = ''
): ResolutionTemplate {
  const combined = `${intent} ${ticketBody}`.toLowerCase();
  const dept     = (department ?? '').toLowerCase();
  const sub      = (subteam    ?? '').toLowerCase();

  // Priority 0: hard subteam overrides — prevents any misclassification
  // Employee Relations cases must ALWAYS get the harassment/ER form, regardless of keywords
  if (sub.includes('employee relations')) {
    return RESOLUTION_TEMPLATES.find(t => t.id === 'workplace_harassment')!;
  }
  // Payroll team always gets payroll form
  if (sub.includes('payroll')) {
    return RESOLUTION_TEMPLATES.find(t => t.id === 'payroll_issue')!;
  }
  // Leave management always gets leave form
  if (sub.includes('leave')) {
    return RESOLUTION_TEMPLATES.find(t => t.id === 'leave_request')!;
  }

  // Priority 1: keyword match in intent + body
  for (const template of RESOLUTION_TEMPLATES) {
    if (template.keywords.length > 0 && template.keywords.some(kw => combined.includes(kw))) {
      return template;
    }
  }

  // Priority 2: department-hint match
  // Only applies to templates that explicitly define departments[] — the two generic fallbacks.
  for (const template of RESOLUTION_TEMPLATES) {
    if (template.departments && template.departments.length > 0 &&
        template.departments.some(d => dept.includes(d))) {
      return template;
    }
  }

  // Priority 3: HR fallback
  if (dept.includes('hr') || dept.includes('human resources') || dept.includes('people')) {
    return RESOLUTION_TEMPLATES.find(t => t.id === 'hr_generic')!;
  }

  // Priority 4: IT generic fallback
  return RESOLUTION_TEMPLATES.find(t => t.id === 'it_generic')!;
}

// ─── Preview Renderer ─────────────────────────────────────────────────────────

/**
 * Renders the email body from a template + filled field values.
 * Unfilled required/optional fields render as their placeholder string.
 */
export function renderPreview(
  template: ResolutionTemplate,
  fieldValues: Record<string, string>,
  employeeName: string
): string {
  const name = employeeName?.trim() || 'Employee';
  const lines: string[] = [];

  lines.push(`Dear ${name},`);
  lines.push('');
  lines.push(template.intro);
  lines.push('');

  for (const section of template.sections) {
    if (section.heading) {
      lines.push(`${section.heading}:`);
    }
    if (section.intro) {
      lines.push(section.intro);
    }
    for (const field of section.fields) {
      const raw = fieldValues[field.id];
      const display = raw?.trim() ? raw.trim() : field.placeholder;
      lines.push(`${field.label}: ${display}`);
    }
    lines.push('');
  }

  lines.push('Best regards,');
  lines.push(template.closing);

  return lines.join('\n');
}

// ─── Utility ─────────────────────────────────────────────────────────────────

/** Returns all templates as simple { id, label } pairs for dropdowns. */
export function getAllTemplateOptions(): Array<{ id: string; label: string }> {
  return RESOLUTION_TEMPLATES.map(t => ({ id: t.id, label: t.label }));
}

/** Looks up a template by ID. Returns IT generic fallback if not found. */
export function getTemplateById(id: string): ResolutionTemplate {
  return (
    RESOLUTION_TEMPLATES.find(t => t.id === id) ??
    RESOLUTION_TEMPLATES.find(t => t.id === 'it_generic')!
  );
}
