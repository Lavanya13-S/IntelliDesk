import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Subteam refinement based on intent + department context
const SUBTEAM_ROUTES: Record<string, string> = {
  "Leave Request": "Leave Team",
  "Medical Leave": "Leave Team",
  "Attendance": "Attendance Team",
  "Payroll Query": "Payroll Team",
  "Insurance": "Benefits Team",
  "Benefits": "Benefits Team",
  "Promotion": "Talent Management",
  "Transfer": "Talent Management",
  "Resignation": "Exit Management",
  "Experience Letter": "Documentation Team",
  "Offer Letter": "Recruitment Team",
  "Training": "L&D Team",
  "Remote Work": "Policy Team",
  "Background Verification": "Recruitment Team",
  "Password Reset": "IAM Team",
  "VPN Issue": "Network Team",
  "Laptop Issue": "Desktop Support",
  "Software Installation": "Desktop Support",
  "SAP Access": "SAP Basis Team",
  "Oracle Access": "Database Team",
  "Jira Access": "Access Management",
  "Confluence Access": "Access Management",
  "Email Issue": "Messaging Team",
  "Outlook Issue": "Messaging Team",
  "WiFi Issue": "Network Team",
  "Printer Issue": "Desktop Support",
  "Network Issue": "Network Team",
  "System Slow": "Desktop Support",
  "Application Crash": "Application Support",
  "MFA Issue": "IAM Team",
  "Github Access": "DevOps Team",
  "Database Access": "Database Team",
  "Cloud Access": "Cloud Team",
  "Teams Problem": "Collaboration Team",
  "Zoom Problem": "Collaboration Team",
  "Microphone Problem": "Desktop Support",
  "Salary Delay": "Payroll Team",
  "Reimbursement": "Expense Team",
  "Travel Claim": "Expense Team",
  "Tax Query": "Tax Team",
  "PF Query": "Payroll Team",
  "Bonus Query": "Compensation Team",
  "Salary Slip": "Payroll Team",
  "Bank Change": "Payroll Team",
  "ID Card": "ID Card Team",
  "Asset Request": "Procurement Team",
  "Office Supplies": "Procurement Team",
  "Meeting Room": "Facilities Team",
  "Seating Request": "Facilities Team",
  "Parking": "Facilities Team",
  "Cab Request": "Transport Team",
  "AC Problem": "Maintenance Team",
  "Furniture Issue": "Maintenance Team",
  "Cleaning": "Housekeeping",
  "Electricity": "Maintenance Team",
  "Water Issue": "Maintenance Team",
  "Cafeteria Complaint": "Cafeteria Team",
  "Visitor Pass": "Security Desk",
  "Access Card": "Security Desk",
  "Lost Asset": "Security Desk",
  "Emergency Issue": "Emergency Response",
  "Policy Clarification": "Policy Team",
  "Compliance Query": "Compliance Team",
  "Contract Query": "Contracts Team",
  "Hardware Request": "Hardware Team",
  "Software License": "Software Team",
  "Purchase Request": "Purchase Team",
  "Vendor Query": "Vendor Management",
  "Travel Approval": "Travel Team",
  "Hotel Booking": "Travel Team",
  "Cab Booking": "Travel Team",
  "Visa Query": "Travel Team",
};

// Subteam-specific keyword detection for deeper classification
const SUBTEAM_KEYWORDS: Record<string, string[]> = {
  "IAM Team": ["password", "mfa", "2fa", "multi factor", "authenticator", "login", "account lock", "unlock"],
  "Network Team": ["vpn", "wifi", "network", "internet", "connection", "latency", "bandwidth", "firewall"],
  "Desktop Support": ["laptop", "computer", "screen", "keyboard", "mouse", "printer", "hardware", "slow", "crash", "microphone", "camera"],
  "SAP Basis Team": ["sap", "erp", "basis"],
  "Database Team": ["database", "db", "sql", "oracle", "postgres", "mysql"],
  "Access Management": ["access", "permission", "jira", "confluence", "github", "gitlab", "bitbucket"],
  "Messaging Team": ["email", "outlook", "mail", "mailbox", "exchange", "smtp", "imap"],
  "Application Support": ["application", "app crash", "software error", "bug", "feature"],
  "DevOps Team": ["devops", "ci/cd", "pipeline", "jenkins", "github actions", "docker", "kubernetes"],
  "Cloud Team": ["aws", "azure", "gcp", "cloud", "s3", "ec2", "lambda"],
  "Collaboration Team": ["teams", "zoom", "slack", "meet", "webex", "video call", "screen share"],
  "Payroll Team": ["salary", "payroll", "pay slip", "payslip", "pf", "provident fund", "bank"],
  "Expense Team": ["expense", "reimbursement", "travel claim", "bill", "receipt", "invoice"],
  "Tax Team": ["tax", "tds", "income tax", "gst", "form 16"],
  "Compensation Team": ["bonus", "incentive", "variable pay", "stock", "esop"],
  "Leave Team": ["leave", "vacation", "time off", "sick", "medical"],
  "Benefits Team": ["insurance", "health", "medical claim", "dental", "vision"],
  "Talent Management": ["promotion", "career", "growth", "transfer", "relocation"],
  "Exit Management": ["resign", "quit", "notice", "last day", "fnf", "full and final"],
  "Documentation Team": ["experience letter", "relieving letter", "certificate", "proof"],
  "Recruitment Team": ["offer", "joining", "hiring", "background", "bgv", "interview"],
  "L&D Team": ["training", "course", "certification", "learning", "skill", "workshop", "development"],
  "Policy Team": ["policy", "remote work", "wfh", "hybrid", "flexible", "rule"],
  "Maintenance Team": ["ac", "air conditioning", "furniture", "electricity", "power", "water", "plumbing", "leak"],
  "Housekeeping": ["cleaning", "hygiene", "sanitize", "dust", "pest"],
  "Cafeteria Team": ["cafeteria", "canteen", "food", "lunch", "menu", "meal"],
  "Facilities Team": ["meeting room", "conference", "seating", "desk", "parking", "workspace"],
  "Transport Team": ["cab", "taxi", "transport", "shuttle", "pickup", "drop"],
  "Security Desk": ["visitor", "access card", "entry", "lost", "stolen", "theft"],
  "Emergency Response": ["emergency", "fire", "medical emergency", "accident", "evacuation", "ambulance"],
  "Compliance Team": ["compliance", "regulatory", "audit", "gdpr", "hipaa", "sox"],
  "Contracts Team": ["contract", "agreement", "nda", "legal", "terms", "vendor agreement"],
  "Hardware Team": ["server", "hardware purchase", "device", "equipment", "infrastructure"],
  "Software Team": ["software license", "subscription", "saaS", "tool", "application purchase"],
  "Purchase Team": ["purchase", "procurement", "buy", "order", "po", "purchase order"],
  "Vendor Management": ["vendor", "supplier", "contractor", "third party", "outsourcing"],
  "Travel Team": ["travel", "hotel", "flight", "booking", "visa", "passport", "itinerary"],
};

function classifySubteam(intent: string, subject: string, body: string, department: string): { subteam: string; confidence: number; reasoning: string } {
  const text = (subject + " " + body).toLowerCase();

  // Direct intent mapping
  if (SUBTEAM_ROUTES[intent]) {
    return {
      subteam: SUBTEAM_ROUTES[intent],
      confidence: 95,
      reasoning: `Intent "${intent}" directly mapped to ${SUBTEAM_ROUTES[intent]}.`,
    };
  }

  // Keyword-based subteam detection
  let bestSubteam = "General";
  let bestScore = 0;

  for (const [subteam, keywords] of Object.entries(SUBTEAM_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (text.includes(kw.toLowerCase())) {
        score += kw.split(" ").length >= 2 ? 3 : 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestSubteam = subteam;
    }
  }

  if (bestScore > 0) {
    return {
      subteam: bestSubteam,
      confidence: Math.min(50 + bestScore * 10, 95),
      reasoning: `Keyword match score: ${bestScore}. Matched subteam: ${bestSubteam}.`,
    };
  }

  // Department-based default
  const deptDefaults: Record<string, string> = {
    "HR": "General",
    "IT": "Desktop Support",
    "Finance": "Payroll Team",
    "Admin": "Facilities Team",
    "Facilities": "Maintenance Team",
    "Security": "Security Desk",
    "Legal": "Policy Team",
    "Procurement": "Purchase Team",
    "Travel Desk": "Travel Team",
  };

  return {
    subteam: deptDefaults[department] || "General",
    confidence: 50,
    reasoning: `No specific subteam signals. Using ${department} default: ${deptDefaults[department] || "General"}.`,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { intent, subject, body, department } = await req.json();

    if (!subject || !body) {
      return new Response(
        JSON.stringify({ error: "Missing subject or body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = classifySubteam(intent || "", subject, body, department || "IT");

    return new Response(
      JSON.stringify({
        subteam: result.subteam,
        confidence: result.confidence,
        reasoning: result.reasoning,
        agent: "SubteamAgent",
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
