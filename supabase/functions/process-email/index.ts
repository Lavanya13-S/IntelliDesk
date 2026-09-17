import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Agent orchestration: calls all classification agents in parallel, then stores results
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { email_id, subject, body } = await req.json();

    if (!email_id || !subject || !body) {
      return new Response(
        JSON.stringify({ error: "Missing email_id, subject, or body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";

    // Call all agents in parallel
    const [intentRes, priorityRes, sentimentRes] = await Promise.all([
      fetch(`${supabaseUrl}/functions/v1/classify-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${anonKey}` },
        body: JSON.stringify({ subject, body }),
      }),
      fetch(`${supabaseUrl}/functions/v1/classify-priority`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${anonKey}` },
        body: JSON.stringify({ subject, body }),
      }),
      fetch(`${supabaseUrl}/functions/v1/classify-sentiment`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${anonKey}` },
        body: JSON.stringify({ subject, body }),
      }),
    ]);

    const [intentData, priorityData, sentimentData] = await Promise.all([
      intentRes.json(),
      priorityRes.json(),
      sentimentRes.json(),
    ]);

    // Call department agent with intent result
    const deptRes = await fetch(`${supabaseUrl}/functions/v1/classify-department`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${anonKey}` },
      body: JSON.stringify({
        intent: intentData.intent,
        subject,
        body,
      }),
    });
    const deptData = await deptRes.json();

    // Call subteam agent with all context
    const subteamRes = await fetch(`${supabaseUrl}/functions/v1/classify-subteam`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${anonKey}` },
      body: JSON.stringify({
        intent: intentData.intent,
        subject,
        body,
        department: deptData.department,
      }),
    });
    const subteamData = await subteamRes.json();

    // Update the email record with classification results
    const updateBody = {
      status: "processing",
      intent: intentData.intent,
      priority: priorityData.priority,
      sentiment: sentimentData.sentiment,
      department: deptData.department,
      subteam: subteamData.subteam,
    };

    const updateRes = await fetch(`${supabaseUrl}/rest/v1/emails?id=eq.${email_id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${anonKey}`,
        "apikey": anonKey,
        "Prefer": "return=representation",
      },
      body: JSON.stringify(updateBody),
    });

    const updatedEmail = await updateRes.json();

    // Create ticket record
    const ticketRes = await fetch(`${supabaseUrl}/rest/v1/tickets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${anonKey}`,
        "apikey": anonKey,
        "Prefer": "return=representation",
      },
      body: JSON.stringify({
        email_id,
        intent: intentData.intent,
        department: deptData.department,
        subteam: subteamData.subteam,
        priority: priorityData.priority,
        sentiment: sentimentData.sentiment,
        status: "open",
      }),
    });

    const ticketData = await ticketRes.json();

    return new Response(
      JSON.stringify({
        success: true,
        email: updatedEmail?.[0] || updateBody,
        ticket: ticketData?.[0] || null,
        agents: {
          intent: intentData,
          priority: priorityData,
          sentiment: sentimentData,
          department: deptData,
          subteam: subteamData,
        },
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
