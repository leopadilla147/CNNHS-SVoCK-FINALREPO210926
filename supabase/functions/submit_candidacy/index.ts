/// <reference lib="deno.window" />
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const POSITIONS = ["President", "Vice President", "Secretary", "Treasurer", "Auditor", "PIO", "Protocol Officer", "Grade 7 Representative", "Grade 8 Representative", "Grade 9 Representative", "Grade 10 Representative", "Grade 11 Representative", "Grade 12 Representative"];
const GRADE_LEVELS = ["Grade 7", "Grade 8", "Grade 9", "Grade 10", "Grade 11", "Grade 12"];
const GENDERS = ["Male", "Female"];

interface CandidatePayload {
  surname: string;
  givenName: string;
  middleName?: string;
  extensionName?: string;
  gradeLevel: string;
  position: string;
  partyAffiliation?: string;
  gender: string;
  dateOfBirth: string;
  age: number;
  email: string;
  mobileNumber: string;
  landline?: string;
  homeAddress: string;
  parentGuardianName?: string;
  parentGuardianContact?: string;
  studentId?: string;
  leadershipProfile?: {
    qualities: string;
    skills: string[];
    skillsExplanation: string;
    threeYearVision: string;
  };
  status: string;
}

function validate(p: CandidatePayload): string[] {
  const errors: string[] = [];
  if (!p.surname?.trim()) errors.push("Surname is required.");
  if (!p.givenName?.trim()) errors.push("Given name is required.");
  if (!p.gradeLevel || !GRADE_LEVELS.includes(p.gradeLevel)) errors.push("Valid grade level is required.");
  if (!p.position || !POSITIONS.includes(p.position)) errors.push("Valid position is required.");
  if (p.position && p.position.endsWith("Representative") && p.position !== `${p.gradeLevel} Representative`) {
    errors.push(`${p.gradeLevel} students can only apply for ${p.gradeLevel} Representative.`);
  }
  if (!p.gender || !GENDERS.includes(p.gender)) errors.push("Valid gender is required.");
  if (!p.dateOfBirth) errors.push("Date of birth is required.");
  if (!p.email?.trim()) errors.push("Email is required.");
  if (!p.mobileNumber?.trim()) errors.push("Mobile number is required.");
  if (!p.homeAddress?.trim()) errors.push("Home address is required.");
  if (p.age == null || p.age < 10 || p.age > 99) errors.push("Valid age is required.");
  if (!["ongoingSubmission", "pending"].includes(p.status)) errors.push("Invalid status.");
  return errors;
}

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

    const { action, candidate, candidateId, pictureBase64, eafFrontBase64, eafBackBase64 } = await req.json();

    if (!action) throw new Error("Action is required (create, update, finalize).");

    if (action === "finalize") {
      if (!candidateId) throw new Error("Candidate ID is required for finalization.");
      const { data: existing } = await admin.from("candidates").select("*").eq("id", candidateId).single();
      if (!existing) throw new Error("Candidate not found.");
      if (!existing.doc_eaf_front || !existing.doc_eaf_back) {
        throw new Error("EAF front and back photos must be uploaded before final submission.");
      }
      const { error: updateError } = await admin.from("candidates").update({
        status: "pending",
        doc_introductory_profile: true,
      }).eq("id", candidateId);
      if (updateError) throw new Error(updateError.message);

      await admin.from("audit_logs").insert({
        actor_id: user.id,
        actor_name: candidate?.givenName || "Student",
        actor_role: "student",
        action: "Candidacy Application",
        details: "Submitted completed EAF — Pending officer review",
        type: "info",
      });

      const { data: updated } = await admin.from("candidates").select("*").eq("id", candidateId).single();
      return new Response(JSON.stringify({ candidate: updated }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "update" && candidateId) {
      const { data: existing } = await admin.from("candidates").select("id, picture_url, eaf_front_url, eaf_back_url").eq("id", candidateId).single();
      if (!existing) throw new Error("Candidate not found.");

      let pictureUrl = existing.picture_url;
      let eafFrontUrl = existing.eaf_front_url;
      let eafBackUrl = existing.eaf_back_url;

      if (pictureBase64) {
        pictureUrl = await uploadImage(admin, pictureBase64, "candidate-pictures", `candidate_${candidateId}_${Date.now()}.jpg`);
      }
      if (eafFrontBase64) {
        eafFrontUrl = await uploadImage(admin, eafFrontBase64, "candidate-documents", `eaf_front_${candidateId}_${Date.now()}.jpg`);
      }
      if (eafBackBase64) {
        eafBackUrl = await uploadImage(admin, eafBackBase64, "candidate-documents", `eaf_back_${candidateId}_${Date.now()}.jpg`);
      }

      const updateData: Record<string, unknown> = {
        picture_url: pictureUrl,
        eaf_front_url: eafFrontUrl,
        eaf_back_url: eafBackUrl,
      };
      if (eafFrontBase64) updateData.doc_eaf_front = true;
      if (eafBackBase64) updateData.doc_eaf_back = true;

      const { error: updateError } = await admin.from("candidates").update(updateData).eq("id", candidateId);
      if (updateError) throw new Error(updateError.message);

      await admin.from("audit_logs").insert({
        actor_id: user.id,
        actor_role: "student",
        actor_name: candidate?.givenName || "Student",
        action: "EAF Uploaded",
        details: "Uploaded EAF images for candidacy",
        type: "info",
      });

      const { data: updated } = await admin.from("candidates").select("*").eq("id", candidateId).single();
      return new Response(JSON.stringify({ candidate: updated }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action !== "create") throw new Error("Invalid action.");
    if (!candidate) throw new Error("Candidate data is required for creation.");

    const errors = validate(candidate);
    if (errors.length > 0) throw new Error(`Validation failed: ${errors.join(" ")}`);

    const newId = crypto.randomUUID();

    let pictureUrl: string | null = null;
    if (pictureBase64) {
      pictureUrl = await uploadImage(admin, pictureBase64, "candidate-pictures", `candidate_${newId}_${Date.now()}.jpg`);
    }

    const { data: election } = await admin.from("election_periods").select("id").eq("is_active", true).maybeSingle();
    const electionPeriodId = election?.id;
    if (!electionPeriodId) throw new Error("No active election period found.");

    let partyId: string | null = null;
    if (candidate.partyAffiliation) {
      // Only a President applicant may bring a new slate into being; anyone
      // else has to be joining a party that already exists for this period.
      const { data: existing } = await admin
        .from("parties")
        .select("id")
        .eq("election_period_id", electionPeriodId)
        .eq("name", candidate.partyAffiliation)
        .maybeSingle();

      if (existing) {
        // Same rule the RPC enforces: joining an existing slate is only
        // legitimate once it has an APPROVED PRESIDENT.  This function runs on
        // the service role and so is not covered by the candidates RLS, so the
        // check has to be repeated here rather than inherited.
        if (candidate.position !== "President") {
          const { data: approvedPresident } = await admin
            .from("candidates")
            .select("id")
            .eq("party_id", existing.id)
            .eq("position", "President")
            .eq("status", "approved")
            .limit(1)
            .maybeSingle();

          if (!approvedPresident) {
            throw new Error(
              "You can only join a party that already has an approved President."
            );
          }
        }
        partyId = existing.id;
      } else {
        if (candidate.position !== "President") {
          throw new Error("You can only create a new party by running for President. Join an existing party instead.");
        }
        const { data: party, error: partyError } = await admin
          .from("parties")
          .insert({ name: candidate.partyAffiliation, election_period_id: electionPeriodId })
          .select("id")
          .single();
        if (partyError) {
          // Two Presidents can pick the same name at the same instant.  The
          // winner's row is the party; the loser adopts it instead of failing.
          const { data: winner } = await admin
            .from("parties")
            .select("id")
            .eq("election_period_id", electionPeriodId)
            .eq("name", candidate.partyAffiliation)
            .maybeSingle();
          if (!winner) {
            throw new Error(`Party could not be created: ${partyError.message}`);
          }
          partyId = winner.id;
        } else if (!party) {
          throw new Error("Party could not be created.");
        } else {
          partyId = party.id;
        }
      }

      // president_student_id is intentionally left alone: it mirrors the
      // screening-approved President, not whoever applied first.
    }

    const { error: insertError } = await admin.from("candidates").insert({
      id: newId,
      student_id: candidate.studentId || user.id,
      election_period_id: electionPeriodId,
      surname: candidate.surname.trim(),
      given_name: candidate.givenName.trim(),
      middle_name: candidate.middleName?.trim() || null,
      extension_name: candidate.extensionName?.trim() || null,
      grade_level: candidate.gradeLevel,
      position: candidate.position,
      party_id: partyId,
      gender: candidate.gender,
      date_of_birth: candidate.dateOfBirth,
      age: candidate.age,
      email: candidate.email.trim(),
      mobile_number: candidate.mobileNumber.trim(),
      landline: candidate.landline?.trim() || null,
      home_address: candidate.homeAddress.trim(),
      parent_guardian_name: candidate.parentGuardianName?.trim() || null,
      parent_guardian_contact: candidate.parentGuardianContact?.trim() || null,
      picture_url: pictureUrl,
      doc_application_form: true,
      doc_introductory_profile: false,
      doc_eaf_front: false,
      doc_eaf_back: false,
      // Derived server-side. This function runs with the service role and
      // would otherwise let a client assert its own party approval.
      position_approval_status:
        partyId && candidate.position !== "President"
          ? "presidentApprovalRequired"
          : "notRequired",
      leadership_profile: candidate.leadershipProfile || null,
      status: candidate.status,
      submitted_at: new Date().toISOString(),
    });

    if (insertError) throw new Error(insertError.message);

    await admin.from("audit_logs").insert({
      actor_id: user.id,
      actor_role: "student",
      actor_name: `${candidate.givenName} ${candidate.surname}`,
      action: "EAF Generated",
      details: `Generated EAF for ${candidate.position} — Ongoing Submission`,
      type: "info",
    });

    const { data: created } = await admin.from("candidates").select("*, parties(name)").eq("id", newId).single();
    return new Response(JSON.stringify({ candidate: created }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function uploadImage(admin: ReturnType<typeof createClient>, base64Data: string, bucket: string, fileName: string): Promise<string> {
  const matches = base64Data.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!matches) throw new Error("Invalid image format. Expected data:image/...;base64,...");
  const mimeType = matches[1];
  const rawBase64 = matches[2];
  const bytes = Uint8Array.from(atob(rawBase64), (char) => char.charCodeAt(0));

  const { data, error } = await admin.storage.from(bucket).upload(fileName, bytes, {
    contentType: mimeType,
    upsert: true,
  });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data: { publicUrl } } = admin.storage.from(bucket).getPublicUrl(data.path);
  return publicUrl;
}
