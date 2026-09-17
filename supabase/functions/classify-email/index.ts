import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Intent classification using rule-based heuristics with keyword matching
// Maps to the full issue catalog from the spec
const INTENT_KEYWORDS: Record<string, string[]> = {
  "Leave Request": ["leave", "vacation", "time off", "annual leave", "sick leave", "medical leave", "maternity", "paternity"],
  "Medical Leave": ["medical leave", "sick leave", "doctor", "hospital", "medical certificate", "illness"],
  "Attendance": ["attendance", "late", "punch", "biometric", "check in", "check out", "clock in"],
  "Payroll Query": ["payroll", "salary", "wage", "pay", "compensation", "deduction", "pf", "provident fund"],
  "Insurance": ["insurance", "health insurance", "medical claim", "policy claim", "coverage"],
  "Benefits": ["benefits", "perks", "esop", "stock options", "gratuity", "retirement"],
  "Promotion": ["promotion", "career growth", "advancement", "senior role", "level up"],
  "Transfer": ["transfer", "relocation", "move to", "change location", "different office"],
  "Resignation": ["resign", "quit", "notice period", "last day", "exit", "termination"],
  "Experience Letter": ["experience letter", "relieving letter", "service certificate", "employment proof"],
  "Offer Letter": ["offer letter", "joining letter", "appointment letter", "new hire"],
  "Training": ["training", "course", "certification", "learning", "skill development", "workshop"],
  "Remote Work": ["remote work", "work from home", "wfh", "hybrid", "flexible work"],
  "Background Verification": ["background check", "bgv", "verification", "reference check"],
  "Password Reset": ["password reset", "forgot password", "reset password", "password change", "unlock account"],
  "VPN Issue": ["vpn", "virtual private network", "remote access", "tunnel"],
  "Laptop Issue": ["laptop", "computer", "desktop", "hardware", "screen", "keyboard", "battery", "charger"],
  "Software Installation": ["software install", "application install", "setup software", "download app", "license"],
  "SAP Access": ["sap", "erp access", "sap login", "sap system"],
  "Oracle Access": ["oracle", "oracle login", "oracle database", "oracle app"],
  "Jira Access": ["jira", "jira login", "project management tool", "atlassian"],
  "Confluence Access": ["confluence", "wiki", "confluence login", "documentation portal"],
  "Email Issue": ["email issue", "mail problem", "cannot send email", "email not working"],
  "Outlook Issue": ["outlook", "outlook error", "calendar sync", "mailbox"],
  "WiFi Issue": ["wifi", "wireless", "internet not working", "network down", "no connection"],
  "Printer Issue": ["printer", "printing", "scan", "copier", "fax"],
  "Network Issue": ["network", "connectivity", "latency", "packet loss", "bandwidth"],
  "System Slow": ["slow", "performance", "lag", "freeze", "hang", "unresponsive"],
  "Application Crash": ["crash", "app crash", "not responding", "force close", "error message"],
  "MFA Issue": ["mfa", "multi factor", "two factor", "2fa", "authenticator", "otp not working"],
  "Github Access": ["github", "git access", "repository access", "code repo"],
  "Database Access": ["database access", "db access", "sql access", "query rights"],
  "Cloud Access": ["aws", "azure", "gcp", "cloud access", "cloud console"],
  "Teams Problem": ["teams", "microsoft teams", "teams call", "teams meeting"],
  "Zoom Problem": ["zoom", "zoom meeting", "zoom call", "video conference"],
  "Microphone Problem": ["microphone", "mic not working", "audio issue", "no sound"],
  "Salary Delay": ["salary delay", "salary not credited", "payment delay", "late salary"],
  "Reimbursement": ["reimbursement", "claim money back", "refund", "expense refund"],
  "Travel Claim": ["travel claim", "travel reimbursement", "trip expense", "travel bill"],
  "Tax Query": ["tax", "income tax", "tds", "tax deduction", "tax return", "form 16"],
  "PF Query": ["pf", "provident fund", "epf", "pf withdrawal", "pf transfer"],
  "Bonus Query": ["bonus", "incentive", "variable pay", "performance bonus", "diwali bonus"],
  "Salary Slip": ["salary slip", "payslip", "pay statement", "monthly statement"],
  "Bank Change": ["bank change", "new bank account", "account update", "bank details"],
  "ID Card": ["id card", "employee id", "badge", "access card", "identity card"],
  "Asset Request": ["asset request", "equipment request", "hardware request", "new device"],
  "Office Supplies": ["office supplies", "stationery", "pen", "notebook", "marker"],
  "Meeting Room": ["meeting room", "conference room", "booking", "room reservation"],
  "Seating Request": ["seating", "desk change", "move seat", "cubicle", "workspace"],
  "Parking": ["parking", "parking slot", "vehicle parking", "car park"],
  "Cab Request": ["cab", "taxi", "transport", "pickup", "drop", "shuttle"],
  "AC Problem": ["ac", "air conditioning", "cooling", "hvac", "temperature"],
  "Furniture Issue": ["furniture", "chair", "table", "desk broken", "cabinet"],
  "Cleaning": ["cleaning", "housekeeping", "hygiene", "sanitize", "dust"],
  "Electricity": ["electricity", "power cut", "power outage", "no power", "fuse"],
  "Water Issue": ["water", "plumbing", "leak", "tap", "drinking water", "purifier"],
  "Cafeteria Complaint": ["cafeteria", "food", "canteen", "lunch", "meal quality", "menu"],
  "Visitor Pass": ["visitor pass", "guest pass", "visitor entry", "client visit"],
  "Access Card": ["access card", "swipe card", "entry card", "door access"],
  "Lost Asset": ["lost", "stolen", "missing", "asset lost", "device lost"],
  "Emergency Issue": ["emergency", "fire", "medical emergency", "accident", "evacuation"],
  "Policy Clarification": ["policy", "clarification", "policy doubt", "rule question"],
  "Compliance Query": ["compliance", "regulatory", "audit", "gdpr", "hipaa"],
  "Contract Query": ["contract", "agreement", "nda", "legal document", "terms"],
  "Hardware Request": ["hardware request", "server", "device purchase", "new machine"],
  "Software License": ["software license", "license renewal", "subscription", "tool license"],
  "Purchase Request": ["purchase request", "procurement", "buy", "vendor", "purchase order"],
  "Vendor Query": ["vendor", "supplier", "contractor", "third party"],
  "Travel Approval": ["travel approval", "trip approval", "business travel", "travel request"],
  "Hotel Booking": ["hotel booking", "accommodation", "stay", "lodging"],
  "Cab Booking": ["cab booking", "taxi booking", "car rental", "transport booking"],
  "Visa Query": ["visa", "work permit", "business visa", "travel document"],
};

function classifyIntent(subject: string, body: string): { intent: string; confidence: number } {
  const text = (subject + " " + body).toLowerCase();
  let bestIntent = "General Inquiry";
  let bestScore = 0;

  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
    let score = 0;
    for (const keyword of keywords) {
      if (text.includes(keyword.toLowerCase())) {
        score += keyword.split(" ").length >= 2 ? 3 : 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestIntent = intent;
    }
  }

  const confidence = Math.min(bestScore * 15, 99);
  return { intent: bestIntent, confidence };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { subject, body } = await req.json();

    if (!subject || !body) {
      return new Response(
        JSON.stringify({ error: "Missing subject or body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = classifyIntent(subject, body);

    return new Response(
      JSON.stringify({
        intent: result.intent,
        confidence: result.confidence,
        agent: "IntentAgent",
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
