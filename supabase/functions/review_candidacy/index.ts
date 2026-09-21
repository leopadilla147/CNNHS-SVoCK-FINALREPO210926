/// <reference lib="deno.window" />
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header.");

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) throw new Error("Invalid requester session.");

    const { data: requesterProfile } = await admin
      .from("profiles")
      .select("role, full_name")
      .eq("id", user.id)
      .single();

    if (!requesterProfile || requesterProfile.role !== "admin") {
      throw new Error("Only admins can review candidacy applications.");
    }

    const { candidateId, action, rejectionReason, rejectionDetails, rejectionTier } = await req.json();
    if (!candidateId) throw new Error("Candidate ID is required.");
    if (!["approve", "reject"].includes(action)) throw new Error("Action must be 'approve' or 'reject'.");

    if (action === "reject") {
      if (!rejectionReason) throw new Error("A rejection reason is required.");
      if (!rejectionTier || !["low", "high"].includes(rejectionTier)) throw new Error("Rejection tier must be low or high.");
    }

    const { data: candidate, error: fetchError } = await admin
      .from("candidates")
      .select("*, students(first_name, last_name)")
      .eq("id", candidateId)
      .single();

    if (fetchError || !candidate) throw new Error("Candidate not found.");
    if (candidate.status !== "pending") throw new Error(`Cannot ${action} a candidate with status '${candidate.status}'.`);

    const newStatus = action === "approve" ? "approved" : "rejected";

    const updateFields: Record<string, any> = {
      status: newStatus,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    };
    if (action === "reject") {
      updateFields.rejection_reason = rejectionReason;
      updateFields.rejection_details = rejectionDetails || null;
      updateFields.rejection_tier = rejectionTier;
    }

    const { error: updateError } = await admin.from("candidates").update(updateFields).eq("id", candidateId);

    if (updateError) throw new Error(updateError.message);

    const studentName = candidate.students
      ? `${candidate.students.first_name} ${candidate.students.last_name}`
      : `${candidate.given_name} ${candidate.surname}`;

    const rejectionDetailsStr = action === "reject"
      ? `. Reason: ${rejectionReason}. Tier: ${rejectionTier}${rejectionDetails ? `. Details: ${rejectionDetails}` : ""}`
      : "";

    await admin.from("audit_logs").insert({
      actor_id: user.id,
      actor_name: requesterProfile.full_name || "Administrator",
      actor_role: "admin",
      action: action === "approve" ? "Approved Candidacy" : "Rejected Candidacy",
      details: `${action === "approve" ? "Approved" : "Rejected"} candidacy of ${studentName} for ${candidate.position}${rejectionDetailsStr}`,
      type: action === "approve" ? "success" : "warning",
    });

    const { data: updated } = await admin.from("candidates").select("*").eq("id", candidateId).single();
    return new Response(JSON.stringify({ candidate: updated }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
