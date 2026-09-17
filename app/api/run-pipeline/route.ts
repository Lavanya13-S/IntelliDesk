import { NextRequest, NextResponse } from 'next/server';
import { runLangGraphPipeline } from '@/lib/langgraph-pipeline';
import { runAllAgents } from '@/lib/agents';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { emailId, subject, body, attachmentSummary, useLangGraph } = await req.json();

    if (!emailId || !subject || !body) {
      return NextResponse.json({ error: 'Missing emailId, subject, or body' }, { status: 400 });
    }

    // Check whether LangGraph is enabled in ai_settings
    let langGraphEnabled = useLangGraph ?? true;
    try {
      const { data: settings } = await supabase
        .from('ai_settings')
        .select('langgraph_enabled')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (settings && typeof settings.langgraph_enabled === 'boolean') {
        langGraphEnabled = settings.langgraph_enabled;
      }
    } catch { /* use default */ }

    if (langGraphEnabled) {
      // Run full LangGraph pipeline
      const result = await runLangGraphPipeline({ emailId, subject, body, attachmentSummary });

      if (!result) {
        // Fallback to sequential agents on LangGraph failure
        console.warn('[run-pipeline] LangGraph failed, falling back to sequential agents');
        const fallback = await runAllAgents(emailId, subject, body);
        return NextResponse.json({
          success: !!fallback,
          pipeline: 'sequential_fallback',
          result: fallback,
        });
      }

      return NextResponse.json({
        success: true,
        pipeline: 'langgraph',
        result: {
          intent: result.intent,
          priority: result.priority,
          sentiment: result.sentiment,
          department: result.department,
          subteam: result.subteam,
          ticketId: result.ticketId,
          generatedResponse: result.generatedResponse,
          actions: result.actions,
          stage: result.stage,
          completed: result.completed,
          errors: result.errors,
        },
      });
    } else {
      // Use original sequential agent pipeline
      const result = await runAllAgents(emailId, subject, body);
      return NextResponse.json({
        success: !!result,
        pipeline: 'sequential',
        result,
      });
    }
  } catch (err: any) {
    console.error('[run-pipeline] error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
