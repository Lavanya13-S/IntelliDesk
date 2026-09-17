import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Department routing rules based on intent keywords
const DEPARTMENT_ROUTES: Record<string, { department: string; subteam: string }> = {
  "Leave Request": { department: "HR", subteam: "Leave Team" },
  "Medical Leave": { department: "HR", subteam: "Leave Team" },
  "Attendance": { department: "HR", subteam: "Attendance Team" },
  "Payroll Query": { department: "HR", subteam: "Payroll Team" },
  "Insurance": { department: "HR", subteam: "Benefits Team" },
  "Benefits": { department: "HR", subteam: "Benefits Team" },
  "Promotion": { department: "HR", subteam: "Talent Management" },
  "Transfer": { department: "HR", subteam: "Talent Management" },
  "Resignation": { department: "HR", subteam: "Exit Management" },
  "Experience Letter": { department: "HR", subteam: "Documentation Team" },
  "Offer Letter": { department: "HR", subteam: "Recruitment Team" },
  "Training": { department: "HR", subteam: "L&D Team" },
  "Remote Work": { department: "HR", subteam: "Policy Team" },
  "Background Verification": { department: "HR", subteam: "Recruitment Team" },
  "Password Reset": { department: "IT", subteam: "IAM Team" },
  "VPN Issue": { department: "IT", subteam: "Network Team" },
  "Laptop Issue": { department: "IT", subteam: "Desktop Support" },
  "Software Installation": { department: "IT", subteam: "Desktop Support" },
  "SAP Access": { department: "IT", subteam: "SAP Basis Team" },
  "Oracle Access": { department: "IT", subteam: "Database Team" },
  "Jira Access": { department: "IT", subteam: "Access Management" },
  "Confluence Access": { department: "IT", subteam: "Access Management" },
  "Email Issue": { department: "IT", subteam: "Messaging Team" },
  "Outlook Issue": { department: "IT", subteam: "Messaging Team" },
  "WiFi Issue": { department: "IT", subteam: "Network Team" },
  "Printer Issue": { department: "IT", subteam: "Desktop Support" },
  "Network Issue": { department: "IT", subteam: "Network Team" },
  "System Slow": { department: "IT", subteam: "Desktop Support" },
  "Application Crash": { department: "IT", subteam: "Application Support" },
  "MFA Issue": { department: "IT", subteam: "IAM Team" },
  "Github Access": { department: "IT", subteam: "DevOps Team" },
  "Database Access": { department: "IT", subteam: "Database Team" },
  "Cloud Access": { department: "IT", subteam: "Cloud Team" },
  "Teams Problem": { department: "IT", subteam: "Collaboration Team" },
  "Zoom Problem": { department: "IT", subteam: "Collaboration Team" },
  "Microphone Problem": { department: "IT", subteam: "Desktop Support" },
  "Salary Delay": { department: "Finance", subteam: "Payroll Team" },
  "Reimbursement": { department: "Finance", subteam: "Expense Team" },
  "Travel Claim": { department: "Finance", subteam: "Expense Team" },
  "Tax Query": { department: "Finance", subteam: "Tax Team" },
  "PF Query": { department: "Finance", subteam: "Payroll Team" },
  "Bonus Query": { department: "Finance", subteam: "Compensation Team" },
  "Salary Slip": { department: "Finance", subteam: "Payroll Team" },
  "Bank Change": { department: "Finance", subteam: "Payroll Team" },
  "ID Card": { department: "Admin", subteam: "ID Card Team" },
  "Asset Request": { department: "Admin", subteam: "Procurement Team" },
  "Office Supplies": { department: "Admin", subteam: "Procurement Team" },
  "Meeting Room": { department: "Admin", subteam: "Facilities Team" },
  "Seating Request": { department: "Admin", subteam: "Facilities Team" },
  "Parking": { department: "Admin", subteam: "Facilities Team" },
  "Cab Request": { department: "Admin", subteam: "Transport Team" },
  "AC Problem": { department: "Facilities", subteam: "Maintenance Team" },
  "Furniture Issue": { department: "Facilities", subteam: "Maintenance Team" },
  "Cleaning": { department: "Facilities", subteam: "Housekeeping" },
  "Electricity": { department: "Facilities", subteam: "Maintenance Team" },
  "Water Issue": { department: "Facilities", subteam: "Maintenance Team" },
  "Cafeteria Complaint": { department: "Facilities", subteam: "Cafeteria Team" },
  "Visitor Pass": { department: "Security", subteam: "Security Desk" },
  "Access Card": { department: "Security", subteam: "Security Desk" },
  "Lost Asset": { department: "Security", subteam: "Security Desk" },
  "Emergency Issue": { department: "Security", subteam: "Emergency Response" },
  "Policy Clarification": { department: "Legal", subteam: "Policy Team" },
  "Compliance Query": { department: "Legal", subteam: "Compliance Team" },
  "Contract Query": { department: "Legal", subteam: "Contracts Team" },
  "Hardware Request": { department: "Procurement", subteam: "Hardware Team" },
  "Software License": { department: "Procurement", subteam: "Software Team" },
  "Purchase Request": { department: "Procurement", subteam: "Purchase Team" },
  "Vendor Query": { department: "Procurement", subteam: "Vendor Management" },
  "Travel Approval": { department: "Travel Desk", subteam: "Travel Team" },
  "Hotel Booking": { department: "Travel Desk", subteam: "Travel Team" },
  "Cab Booking": { department: "Travel Desk", subteam: "Travel Team" },
  "Visa Query": { department: "Travel Desk", subteam: "Travel Team" },
};

// Fallback keyword-based routing if intent not matched exactly
const DEPT_KEYWORDS: Record<string, { department: string; subteam: string }> = {
  "HR": { department: "HR", subteam: "General" },
  "IT": { department: "IT", subteam: "General" },
  "Finance": { department: "Finance", subteam: "General" },
  "Admin": { department: "Admin", subteam: "General" },
  "Facilities": { department: "Facilities", subteam: "General" },
  "Security": { department: "Security", subteam: "General" },
  "Legal": { department: "Legal", subteam: "General" },
  "Procurement": { department: "Procurement", subteam: "General" },
  "Travel": { department: "Travel Desk", subteam: "General" },
};

function classifyDepartment(intent: string, subject: string, body: string): { department: string; subteam: string; confidence: number; reasoning: string } {
  // Direct intent match
  if (DEPARTMENT_ROUTES[intent]) {
    const route = DEPARTMENT_ROUTES[intent];
    return {
      department: route.department,
      subteam: route.subteam,
      confidence: 95,
      reasoning: `Intent "${intent}" mapped directly to ${route.department} / ${route.subteam}`,
    };
  }

  // Keyword fallback
  const text = (subject + " " + body).toLowerCase();
  for (const [deptName, route] of Object.entries(DEPT_KEYWORDS)) {
    if (text.includes(deptName.toLowerCase())) {
      return {
        department: route.department,
        subteam: route.subteam,
        confidence: 70,
        reasoning: `Department keyword "${deptName}" detected in email text.`,
      };
    }
  }

  // Default
  return {
    department: "IT",
    subteam: "General",
    confidence: 40,
    reasoning: "No clear routing signals. Defaulting to IT Support.",
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { intent, subject, body } = await req.json();

    if (!subject || !body) {
      return new Response(
        JSON.stringify({ error: "Missing subject or body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = classifyDepartment(intent || "", subject, body);

    return new Response(
      JSON.stringify({
        department: result.department,
        subteam: result.subteam,
        confidence: result.confidence,
        reasoning: result.reasoning,
        agent: "DepartmentAgent",
        timestamp: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
