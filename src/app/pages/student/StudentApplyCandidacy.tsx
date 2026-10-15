import { useState, useEffect } from "react";
import { AlertCircle, Upload, CheckCircle, XCircle, FileImage, FileDown, Pencil, ChevronLeft, ChevronRight, Check } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useApp, Candidate } from "../../context/AppContext";
import { EAFPreviewDocument } from "../../components/EAFPreviewDocument";
import { reapplyPartyCandidacyRpc, submitCandidacyRpc, uploadCandidateImage, fetchCandidateGate } from "../../lib/supabaseData";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";
import { useConfirm } from "../../lib/useConfirm";
import { escapeHtml } from "../../lib/escapeHtml";
import { MIN_WORDS, countWords as wordCount, wordCountError } from "../../lib/wordCount";
import {
  EXECUTIVE_POSITIONS,
  GRADE_LEVELS,
  buildPartyOptions,
  candidatesInLivePeriod,
  isPartyFounder,
  isSeatSelectable,
  partyApprovalBlockForSubmit,
  partySeatSummaries,
} from "../../lib/partyScope";

const GENDERS = ["Male", "Female"];
const LEADERSHIP_SKILLS = ["Motivational", "Problem Solving", "Values-Oriented", "Communication", "Goal-Oriented", "Service-Oriented"];

const STEPS = [
  "Personal Information",
  "Home Address",
  "Parent/Guardian Contact",
  "Party Affiliation & Position",
  "Introductory Profile",
  "Leadership Capsule",
  "Generate Printable EAF",
];

const PSGC_API = "https://psgc.gitlab.io/api";
const REGION_V_CODE = "050000000";

interface Province { code: string; name: string; regionCode: string; }
interface City { code: string; name: string; provinceCode: string; }
interface Barangay { code: string; name: string; municipalityCode?: string; cityCode?: string; }

const FALLBACK_PROVINCES: Province[] = [
  { code: "050500000", name: "Albay", regionCode: "050000000" },
  { code: "051600000", name: "Camarines Norte", regionCode: "050000000" },
  { code: "051700000", name: "Camarines Sur", regionCode: "050000000" },
  { code: "052000000", name: "Catanduanes", regionCode: "050000000" },
  { code: "054100000", name: "Masbate", regionCode: "050000000" },
  { code: "056200000", name: "Sorsogon", regionCode: "050000000" },
];
const FALLBACK_CITIES: Record<string, City[]> = {
  "051600000": [
    { code: "051601000", name: "Basud", provinceCode: "051600000" },
    { code: "051602000", name: "Capalonga", provinceCode: "051600000" },
    { code: "051603000", name: "Daet", provinceCode: "051600000" },
    { code: "051604000", name: "Jose Panganiban", provinceCode: "051600000" },
    { code: "051605000", name: "Labo", provinceCode: "051600000" },
    { code: "051606000", name: "Mercedes", provinceCode: "051600000" },
    { code: "051607000", name: "Paracale", provinceCode: "051600000" },
    { code: "051608000", name: "San Lorenzo Ruiz", provinceCode: "051600000" },
    { code: "051609000", name: "San Vicente", provinceCode: "051600000" },
    { code: "051610000", name: "Santa Elena", provinceCode: "051600000" },
    { code: "051611000", name: "Talisay", provinceCode: "051600000" },
    { code: "051612000", name: "Vinzons", provinceCode: "051600000" },
  ],
  "051700000": [
    { code: "051701000", name: "Baao", provinceCode: "051700000" },
    { code: "051716000", name: "City of Iriga", provinceCode: "051700000" },
    { code: "051724000", name: "City of Naga", provinceCode: "051700000" },
    { code: "051725000", name: "Ocampo", provinceCode: "051700000" },
    { code: "051728000", name: "Pili", provinceCode: "051700000" },
  ],
  "050500000": [
    { code: "050501000", name: "Bacacay", provinceCode: "050500000" },
    { code: "050502000", name: "Camalig", provinceCode: "050500000" },
    { code: "050503000", name: "Daraga", provinceCode: "050500000" },
    { code: "050504000", name: "Guinobatan", provinceCode: "050500000" },
    { code: "050505000", name: "City of Legazpi", provinceCode: "050500000" },
    { code: "050506000", name: "Libon", provinceCode: "050500000" },
    { code: "050507000", name: "City of Ligao", provinceCode: "050500000" },
    { code: "050508000", name: "Malilipot", provinceCode: "050500000" },
    { code: "050509000", name: "Malinao", provinceCode: "050500000" },
    { code: "050510000", name: "Manito", provinceCode: "050500000" },
    { code: "050511000", name: "Oas", provinceCode: "050500000" },
    { code: "050512000", name: "Pio Duran", provinceCode: "050500000" },
    { code: "050513000", name: "Polangui", provinceCode: "050500000" },
    { code: "050514000", name: "Rapu-Rapu", provinceCode: "050500000" },
    { code: "050515000", name: "Santo Domingo", provinceCode: "050500000" },
    { code: "050516000", name: "City of Tabaco", provinceCode: "050500000" },
    { code: "050517000", name: "Tiwi", provinceCode: "050500000" },
  ],
  "052000000": [
    { code: "052001000", name: "Bagamanoc", provinceCode: "052000000" },
    { code: "052002000", name: "Baras", provinceCode: "052000000" },
    { code: "052003000", name: "Bato", provinceCode: "052000000" },
    { code: "052004000", name: "Caramoran", provinceCode: "052000000" },
    { code: "052005000", name: "Gigmoto", provinceCode: "052000000" },
    { code: "052006000", name: "Pandan", provinceCode: "052000000" },
    { code: "052007000", name: "Panganiban", provinceCode: "052000000" },
    { code: "052008000", name: "San Andres", provinceCode: "052000000" },
    { code: "052009000", name: "San Miguel", provinceCode: "052000000" },
    { code: "052010000", name: "Viga", provinceCode: "052000000" },
    { code: "052011000", name: "Virac", provinceCode: "052000000" },
  ],
  "054100000": [
    { code: "054101000", name: "Aroroy", provinceCode: "054100000" },
    { code: "054102000", name: "Baleno", provinceCode: "054100000" },
    { code: "054103000", name: "Balud", provinceCode: "054100000" },
    { code: "054104000", name: "Batuan", provinceCode: "054100000" },
    { code: "054105000", name: "Cataingan", provinceCode: "054100000" },
    { code: "054106000", name: "Cawayan", provinceCode: "054100000" },
    { code: "054107000", name: "Claveria", provinceCode: "054100000" },
    { code: "054108000", name: "Dimasalang", provinceCode: "054100000" },
    { code: "054109000", name: "Esperanza", provinceCode: "054100000" },
    { code: "054110000", name: "Mandaon", provinceCode: "054100000" },
    { code: "054111000", name: "City of Masbate", provinceCode: "054100000" },
    { code: "054112000", name: "Milagros", provinceCode: "054100000" },
    { code: "054113000", name: "Mobo", provinceCode: "054100000" },
    { code: "054114000", name: "Monreal", provinceCode: "054100000" },
    { code: "054115000", name: "Palanas", provinceCode: "054100000" },
    { code: "054116000", name: "Pio V. Corpuz", provinceCode: "054100000" },
    { code: "054117000", name: "Placer", provinceCode: "054100000" },
    { code: "054118000", name: "San Fernando", provinceCode: "054100000" },
    { code: "054119000", name: "San Jacinto", provinceCode: "054100000" },
    { code: "054120000", name: "San Pascual", provinceCode: "054100000" },
    { code: "054121000", name: "Uson", provinceCode: "054100000" },
  ],
  "056200000": [
    { code: "056201000", name: "Barcelona", provinceCode: "056200000" },
    { code: "056202000", name: "Bulan", provinceCode: "056200000" },
    { code: "056203000", name: "Bulusan", provinceCode: "056200000" },
    { code: "056204000", name: "Casiguran", provinceCode: "056200000" },
    { code: "056205000", name: "Castilla", provinceCode: "056200000" },
    { code: "056206000", name: "Donsol", provinceCode: "056200000" },
    { code: "056207000", name: "Gubat", provinceCode: "056200000" },
    { code: "056208000", name: "Irosin", provinceCode: "056200000" },
    { code: "056209000", name: "Juban", provinceCode: "056200000" },
    { code: "056210000", name: "Magallanes", provinceCode: "056200000" },
    { code: "056211000", name: "Matnog", provinceCode: "056200000" },
    { code: "056212000", name: "Pilar", provinceCode: "056200000" },
    { code: "056213000", name: "Prieto Diaz", provinceCode: "056200000" },
    { code: "056214000", name: "Santa Magdalena", provinceCode: "056200000" },
    { code: "056215000", name: "City of Sorsogon", provinceCode: "056200000" },
  ],
};
const FALLBACK_BARANGAYS: Record<string, Barangay[]> = {
  "051603000": [
    { code: "051603001", name: "Alawihaw", municipalityCode: "051603000" },
    { code: "051603002", name: "Awitan", municipalityCode: "051603000" },
    { code: "051603003", name: "Bagasbas", municipalityCode: "051603000" },
    { code: "051603004", name: "Bibirao", municipalityCode: "051603000" },
    { code: "051603005", name: "Borobadtoro", municipalityCode: "051603000" },
    { code: "051603006", name: "Calagbangan", municipalityCode: "051603000" },
    { code: "051603007", name: "Calasgasan", municipalityCode: "051603000" },
    { code: "051603008", name: "Camambugan", municipalityCode: "051603000" },
    { code: "051603009", name: "Cobra", municipalityCode: "051603000" },
    { code: "051603010", name: "Dugui-Isla", municipalityCode: "051603000" },
    { code: "051603011", name: "Dugui-Too", municipalityCode: "051603000" },
    { code: "051603012", name: "Dugui San Agustin", municipalityCode: "051603000" },
    { code: "051603013", name: "Dugui San Vicente", municipalityCode: "051603000" },
    { code: "051603014", name: "Dugui-San Juan", municipalityCode: "051603000" },
    { code: "051603015", name: "Gubat", municipalityCode: "051603000" },
    { code: "051603016", name: "Mambalite", municipalityCode: "051603000" },
    { code: "051603017", name: "Mangcruz", municipalityCode: "051603000" },
    { code: "051603018", name: "Pamorangon", municipalityCode: "051603000" },
    { code: "051603019", name: "Mangga", municipalityCode: "051603000" },
    { code: "051603020", name: "Poblacion I", municipalityCode: "051603000" },
    { code: "051603021", name: "Poblacion II", municipalityCode: "051603000" },
    { code: "051603022", name: "Poblacion III", municipalityCode: "051603000" },
    { code: "051603023", name: "Poblacion IV", municipalityCode: "051603000" },
    { code: "051603024", name: "Poblacion V", municipalityCode: "051603000" },
    { code: "051603025", name: "Poblacion VI", municipalityCode: "051603000" },
    { code: "051603026", name: "Poblacion VII", municipalityCode: "051603000" },
    { code: "051603027", name: "Poblacion VIII", municipalityCode: "051603000" },
    { code: "051603028", name: "San Isidro", municipalityCode: "051603000" },
    { code: "051603029", name: "Tugos", municipalityCode: "051603000" },
  ],
};

async function fetchJSON<T>(url: string, timeoutMs = 10000): Promise<T> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

interface InputFieldProps {
  label: string;
  field: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  hint?: string;
  value: string;
  onChange: (field: string, value: string) => void;
  error?: string;
  readonly?: boolean;
}

const InputField = ({
  label,
  field,
  type = "text",
  placeholder,
  required = true,
  hint,
  value,
  onChange,
  error,
  readonly = false,
}: InputFieldProps) => (
  <div>
    <label className="block text-sm text-gray-700 mb-1.5">
      {label} {required && <span className="text-red-500">*</span>}
    </label>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(field, e.target.value)}
      placeholder={placeholder}
      readOnly={readonly}
      className={`w-full px-4 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-[#5C0102] transition-all ${
        readonly ? "bg-gray-100 text-gray-500 cursor-not-allowed" : "bg-gray-50"
      } ${error ? "border-red-400" : "border-gray-200"}`}
    />
    {hint && !error && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    {error && (
      <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
        <AlertCircle size={12} /> {error}
      </p>
    )}
  </div>
);

export default function StudentApplyCandidacy() {
  const { candidates, setCandidates, currentUser, students, addLog, insertNotification, electionPeriod, parties } = useApp();
  const currentStudent = students.find((s) => s.id === currentUser?.id);
  const generateEafConfirm = useConfirm({ title: "Generate EAF?", description: "This will create or update your candidacy application based on the information provided.", confirmText: "Generate" });
  const finalSubmitConfirm = useConfirm({ title: "Submit Completed EAF?", description: "This will finalize your candidacy application and submit it to the Commissioner on Screening and Validation for review. You will not be able to edit it afterward.", confirmText: "Submit", destructive: true });
  // Parties belong to a single election period, so the picker must offer the
  // parties of the live period only — never a past period's slate.  For the
  // same reason the application being edited is the live period's one: a
  // candidacy from an earlier election is history and stays untouched.
  const periodCandidates = candidatesInLivePeriod(candidates, electionPeriod);
  const existing = periodCandidates.find((c) => c.studentId === currentUser?.id);

  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [finalLoading, setFinalLoading] = useState(false);
  const [reapplyLoading, setReapplyLoading] = useState(false);
  const [reapplyError, setReapplyError] = useState<string | null>(null);
  // The party President decides in their own browser session, so the approval
  // only reaches this page through an explicit re-read.
  const [gateCheckLoading, setGateCheckLoading] = useState(false);
  const [gateCheckError, setGateCheckError] = useState<string | null>(null);
  const [gateCheckedAt, setGateCheckedAt] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [partyMode, setPartyMode] = useState<"existing" | "new" | "independent">(
    parties.length > 0 ? "existing" : "independent"
  );
  // The party list arrives with the rest of the Supabase state, so the mode
  // cannot be settled once at mount: a student who opens this page while the
  // fetch is still in flight would be parked on "Independent" and never shown
  // the picker they are meant to use.  Keep following the list until they
  // choose for themselves.
  const [partyModeChosen, setPartyModeChosen] = useState(false);
  const [editingExisting, setEditingExisting] = useState(false);

  const [provinces, setProvinces] = useState<Province[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [barangays, setBarangays] = useState<Barangay[]>([]);
  const [loadingAddress, setLoadingAddress] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);

  const [form, setForm] = useState({
    surname: currentStudent?.lastName || "",
    givenName: currentStudent?.firstName || "",
    middleName: currentStudent?.middleName || "",
    extensionName: "",
    gradeLevel: currentStudent?.gradeLevel || "",
    position: "",
    // Filled in once the roster is known, so it can prefer a party this
    // student can actually join rather than the first name alphabetically.
    partyAffiliation: "",
    newPartyName: "",
    gender: currentStudent?.gender || "",
    dateOfBirth: currentStudent?.birthdate || "",
    age: "",
    email: currentStudent?.email || currentUser?.email || "",
    mobileNumber: "",
    landline: "",
    provinceCode: "",
    provinceName: "",
    cityCode: "",
    cityName: "",
    barangayCode: "",
    barangayName: "",
    houseStreet: "",
    parentGuardianFirstName: "",
    parentGuardianMiddleInitial: "",
    parentGuardianLastName: "",
    parentGuardianContact: "",
    leadershipQualities: "",
    leadershipSkills: [] as string[],
    leadershipSkillsExplanation: "",
    threeYearVision: "",
    makaDiyosProject: "",
    makaDiyosDescription: "",
    makaTaoProject: "",
    makaTaoDescription: "",
    makakalikasanProject: "",
    makakalikasanDescription: "",
    makabansaProject: "",
    makabansaDescription: "",
    picture: null as File | null,
    picturePreview: "",
  });

  // Every party of the live period, joinable or not, so the picker can show the
  // whole slate with a reason rather than hiding parties the student cannot use.
  // Derived from form.gradeLevel because a party's offices — and therefore
  // whether it is full — depend on the grade the student is running for.
  const partyOptions = buildPartyOptions(parties, candidates, electionPeriod, form.gradeLevel);
  const existingParties = partyOptions.map((party) => party.name);
  const joinableParties = partyOptions.filter((party) => !party.blockedReason);
  const selectedParty = partyOptions.find((party) => party.name === form.partyAffiliation);
  const independentSeats = partySeatSummaries(
    candidates,
    electionPeriod,
    undefined,
    form.gradeLevel,
    editingExisting ? existing?.id : undefined
  );
  // Joining a slate never offers the President seat: it is only claimable by
  // creating the party, and 055 blocks a second President server-side.
  const partySeats =
    partyMode === "existing"
      ? partySeatSummaries(
          candidates,
          electionPeriod,
          selectedParty?.id,
          form.gradeLevel,
          editingExisting ? existing?.id : undefined
        )
      : [];
  const openPartySeats = partySeats.filter((seat) => isSeatSelectable(seat, true));
  const openIndependentSeats = independentSeats.filter((seat) => isSeatSelectable(seat));

  // Auto-fill any already-known student information (registration record /
  // logged-in account) into the form.  Students load asynchronously from
  // Supabase, so `currentStudent` is often undefined on first render — this
  // effect fills the fields once the record arrives.  Only EMPTY fields are
  // filled (never overwriting what the student typed) and editing an
  // existing application is untouched — every field stays editable.
  useEffect(() => {
    if (!currentStudent || editingExisting) return;
    setForm((f) => ({
      ...f,
      surname: f.surname || currentStudent.lastName || "",
      givenName: f.givenName || currentStudent.firstName || "",
      middleName: f.middleName || currentStudent.middleName || "",
      gradeLevel: f.gradeLevel || currentStudent.gradeLevel || "",
      gender: f.gender || currentStudent.gender || "",
      dateOfBirth: f.dateOfBirth || currentStudent.birthdate || "",
      email: f.email || currentStudent.email || currentUser?.email || "",
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStudent?.id, currentStudent?.lastName, currentStudent?.firstName, editingExisting]);

  useEffect(() => {
    const fetchProvinces = async () => {
      setLoadingAddress(true);
      setAddressError(null);
      try {
        const allProvinces = await fetchJSON<Province[]>(`${PSGC_API}/provinces/`);
        const regionProvinces = allProvinces.filter(p => p.regionCode === REGION_V_CODE);
        if (regionProvinces.length === 0) throw new Error("No provinces found");
        setProvinces(regionProvinces);
      } catch (err) {
        console.warn("Using fallback provinces", err);
        setAddressError("Using offline address data. Some locations may be limited.");
        setProvinces(FALLBACK_PROVINCES);
      } finally {
        setLoadingAddress(false);
      }
    };
    fetchProvinces();
  }, []);

  const fetchCities = async (provinceCode: string) => {
    if (!provinceCode) return;
    setLoadingAddress(true);
    try {
      const provinceCities = await fetchJSON<City[]>(`${PSGC_API}/provinces/${provinceCode}/cities-municipalities/`);
      if (provinceCities.length === 0) throw new Error("No cities found");
      setCities(provinceCities);
    } catch (err) {
      console.warn("City fallback", err);
      const fallbackCities = FALLBACK_CITIES[provinceCode] || [];
      setCities(fallbackCities);
    } finally {
      setLoadingAddress(false);
    }
  };

  const fetchBarangays = async (cityCode: string) => {
    if (!cityCode) return;
    setLoadingAddress(true);
    try {
      const cityBarangays = await fetchJSON<Barangay[]>(`${PSGC_API}/cities-municipalities/${cityCode}/barangays/`);
      if (cityBarangays.length === 0) throw new Error("No barangays found");
      setBarangays(cityBarangays);
    } catch (err) {
      console.warn("Barangay fallback", err);
      const fallbackBarangays = FALLBACK_BARANGAYS[cityCode] || [];
      setBarangays(fallbackBarangays);
    } finally {
      setLoadingAddress(false);
    }
  };

  const handleProvinceChange = (provCode: string, provName: string) => {
    update("provinceCode", provCode);
    update("provinceName", provName);
    update("cityCode", "");
    update("cityName", "");
    update("barangayCode", "");
    update("barangayName", "");
    setCities([]);
    setBarangays([]);
    if (provCode) fetchCities(provCode);
  };

  const handleCityChange = (cityCode: string, cityName: string) => {
    update("cityCode", cityCode);
    update("cityName", cityName);
    update("barangayCode", "");
    update("barangayName", "");
    setBarangays([]);
    if (cityCode) fetchBarangays(cityCode);
  };

  const handleBarangayChange = (brgyCode: string, brgyName: string) => {
    update("barangayCode", brgyCode);
    update("barangayName", brgyName);
  };

  const fullHomeAddress = `${form.houseStreet ? form.houseStreet + " " : ""}Brgy. ${form.barangayName} ${form.cityName}, ${form.provinceName}`;

  useEffect(() => {
    if (form.dateOfBirth) {
      const dob = new Date(form.dateOfBirth);
      const today = new Date("2026-03-12");
      let age = today.getFullYear() - dob.getFullYear();
      const m = today.getMonth() - dob.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
      setForm((f) => ({ ...f, age: String(age) }));
    }
  }, [form.dateOfBirth]);

  useEffect(() => {
    if (partyMode === "new") {
      setForm((f) => ({ ...f, position: "President", partyAffiliation: "" }));
    } else if (partyMode === "independent") {
      setForm((f) => ({ ...f, partyAffiliation: "", position: f.position || EXECUTIVE_POSITIONS[0] }));
    } else {
      setForm((f) => ({
        ...f,
        position: f.position || "",
        // Prefer a party the student can actually join, and fall back to the
        // full roster so a blocked party can still be inspected (it renders
        // disabled, with the reason shown beside it).
        partyAffiliation: f.partyAffiliation || joinableParties[0]?.name || existingParties[0] || "",
      }));
    }
  }, [partyMode]);

  // Follow the party list as it loads, until the student picks a mode.  Only a
  // party they can join is worth defaulting to; when every party is blocked the
  // student is better served on Independent than on a dead dropdown.
  useEffect(() => {
    if (!partyModeChosen && joinableParties.length > 0) {
      setPartyMode("existing");
    }
  }, [partyModeChosen, joinableParties.length]);

  const capitalizeFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  const nameFields = new Set(["surname", "givenName", "middleName", "extensionName", "parentGuardianFirstName", "parentGuardianMiddleInitial", "parentGuardianLastName"]);
  const simFields = new Set(["mobileNumber", "parentGuardianContact"]);

  const update = (field: string, value: any) => {
    let v = value;
    if (field === "landline" && typeof v === "string") {
      v = v.replace(/\D/g, "").slice(0, 8);
    } else if (simFields.has(field) && typeof v === "string") {
      v = v.replace(/\D/g, "").slice(0, 11);
      if (v.length > 0 && !v.startsWith("09")) {
        v = "09" + v.replace(/^0?/, "");
        v = v.slice(0, 11);
      }
    } else if (nameFields.has(field) && typeof v === "string") {
      v = capitalizeFirst(v);
    }
    setForm((f) => ({ ...f, [field]: v }));
    setErrors((e) => ({ ...e, [field]: "" }));
  };

  const handlePictureUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setForm((f) => ({ ...f, picture: file, picturePreview: reader.result as string }));
      setErrors((e) => ({ ...e, picture: "" }));
    };
    reader.readAsDataURL(file);
  };

  const validateStep = (stepIndex: number) => {
    const errs: Record<string, string> = {};
    switch (stepIndex) {
      case 0:
        if (!form.surname.trim()) errs.surname = "Surname is required.";
        if (!form.givenName.trim()) errs.givenName = "Given name is required.";
        if (!form.gradeLevel) errs.gradeLevel = "Grade level is required.";
        if (!form.gender) errs.gender = "Gender is required.";
        if (!form.dateOfBirth) errs.dateOfBirth = "Date of birth is required.";
        if (!form.email.trim()) errs.email = "Email is required.";
        if (!form.mobileNumber.trim()) errs.mobileNumber = "Mobile number is required.";
        else if (form.mobileNumber.length !== 11 || !form.mobileNumber.startsWith("09")) errs.mobileNumber = "Enter a valid 11-digit PH mobile number (e.g., 09123456789).";
        if (!form.picturePreview) errs.picture = "2x2 picture is required.";
        break;
      case 1:
        if (!form.provinceCode) errs.province = "Province is required.";
        if (!form.cityCode) errs.city = "City/Municipality is required.";
        if (!form.barangayCode) errs.barangay = "Barangay is required.";
        break;
      case 2:
        if (!form.parentGuardianFirstName.trim()) errs.parentGuardianFirstName = "Parent/guardian first name is required.";
        if (!form.parentGuardianLastName.trim()) errs.parentGuardianLastName = "Parent/guardian last name is required.";
        if (!form.parentGuardianContact.trim()) errs.parentGuardianContact = "Parent/guardian contact number is required.";
        else if (form.parentGuardianContact.length !== 11 || !form.parentGuardianContact.startsWith("09")) errs.parentGuardianContact = "Enter a valid 11-digit PH mobile number (e.g., 09123456789).";
        break;
      case 3:
        {
          const partyName = partyMode === "new" ? form.newPartyName.trim() : form.partyAffiliation;
          if (partyMode !== "independent" && !partyName) errs.party = "Party is required.";
          if (partyMode === "new" && existingParties.some(p => p.toLowerCase() === partyName.toLowerCase())) {
            errs.party = "This party already exists. Select it from existing parties.";
          }
            if (partyMode !== "new") {
              if (!form.position) errs.position = "Position is required.";
              if (form.position && form.position.endsWith("Representative") && form.position !== `${form.gradeLevel} Representative`) {
                errs.position = `${form.gradeLevel} students can only apply for ${form.gradeLevel} Representative.`;
              }
              if (partyMode === "existing") {
                // Only a WON seat blocks an applicant.  A seat that merely has
                // other requests in it is still open, because 055 lets several
                // students contest one office and the President picks a winner.
                if (selectedParty?.blockedReason === "awaiting-president") {
                  errs.party = `${selectedParty.name} has no approved President yet, so nobody can approve requests for that party.`;
                } else if (selectedParty?.blockedReason === "full") {
                  errs.party = `${selectedParty.name} already has a candidate for every ${form.gradeLevel} position.`;
                } else if (form.position === "President") {
                  errs.position = "The President seat is only open to the student who creates a party.";
                } else if (form.position && !openPartySeats.some((seat) => seat.position === form.position)) {
                  errs.position = "That position already has an approved candidate in this party.";
                }
              } else if (form.position && !openIndependentSeats.some((seat) => seat.position === form.position)) {
                errs.position = "That position already has an approved candidate.";
              }
            }
        }
        break;
      case 4:
        {
          const wcQualities = wordCountError(form.leadershipQualities, "Leadership qualities");
          if (wcQualities) errs.leadershipQualities = wcQualities;
          if (form.leadershipSkills.length === 0) errs.leadershipSkills = "Select at least one organizational skill.";
          const wcSkills = wordCountError(form.leadershipSkillsExplanation, "Skills explanation");
          if (wcSkills) errs.leadershipSkillsExplanation = wcSkills;
          const wcVision = wordCountError(form.threeYearVision, "Three-year vision");
          if (wcVision) errs.threeYearVision = wcVision;
        }
        break;
      case 5:
        {
          if (!form.makaDiyosProject.trim()) errs.makaDiyosProject = "Project name is required.";
          if (!form.makaDiyosDescription.trim()) errs.makaDiyosDescription = "Description is required.";
          if (!form.makaTaoProject.trim()) errs.makaTaoProject = "Project name is required.";
          if (!form.makaTaoDescription.trim()) errs.makaTaoDescription = "Description is required.";
          if (!form.makakalikasanProject.trim()) errs.makakalikasanProject = "Project name is required.";
          if (!form.makakalikasanDescription.trim()) errs.makakalikasanDescription = "Description is required.";
          if (!form.makabansaProject.trim()) errs.makabansaProject = "Project name is required.";
          if (!form.makabansaDescription.trim()) errs.makabansaDescription = "Description is required.";
        }
        break;
    }
    return errs;
  };

  const handleNext = () => {
    const errs = validateStep(step);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const handleBack = () => {
    setErrors({});
    setStep((s) => Math.max(s - 1, 0));
  };

  // The seats shown in the position dropdown.  Won seats stay in the list but
  // disabled, so the roster is honest about what the party has already filled
  // instead of silently hiding offices the student cannot enter.
  const seatChoices =
    partyMode === "new"
      ? [{ position: "President", state: "open" as const, requestCount: 0, requesters: [] }]
      : partyMode === "existing"
        ? partySeats
        : independentSeats;

  const buildCandidate = (baseCandidate?: Candidate): Candidate => {
    const isNewParty = partyMode === "new";
    const isIndependent = partyMode === "independent";
    return {
      id: baseCandidate?.id || crypto.randomUUID(),
      surname: form.surname.trim(),
      givenName: form.givenName.trim(),
      middleName: form.middleName.trim() || undefined,
      extensionName: form.extensionName.trim() || undefined,
      gradeLevel: form.gradeLevel,
      position: isNewParty ? "President" : form.position,
      partyAffiliation: isNewParty ? form.newPartyName.trim() : isIndependent ? undefined : form.partyAffiliation,
      gender: form.gender,
      dateOfBirth: form.dateOfBirth,
      age: parseInt(form.age),
      email: form.email.trim(),
      mobileNumber: form.mobileNumber.trim(),
      landline: form.landline.trim() || undefined,
      homeAddress: fullHomeAddress,
      parentGuardianName: [form.parentGuardianFirstName.trim(), form.parentGuardianMiddleInitial.trim() ? form.parentGuardianMiddleInitial.trim() + "." : "", form.parentGuardianLastName.trim()].filter(Boolean).join(" "),
      parentGuardianContact: form.parentGuardianContact.trim(),
      picture: form.picturePreview || undefined,
      documents: {
        applicationForm: true,
        introductoryProfile: false,
        screeningForm: false,
        reportCard: false,
        goodMoralCert: false,
        eafFront: false,
        eafBack: false,
      },
      eafFrontImage: undefined,
      eafBackImage: undefined,
      // Preview-only: the UI needs a gate to render before the row exists.
      // It is stripped from p_candidate_data before the RPC is called, and the
      // RPC derives the real gate server-side regardless of what a client says.
      positionApprovalStatus: (isNewParty || isIndependent) ? "notRequired" : "presidentApprovalRequired",
      leadershipProfile: {
        qualities: form.leadershipQualities.trim(),
        skills: form.leadershipSkills,
        skillsExplanation: form.leadershipSkillsExplanation.trim(),
        threeYearVision: form.threeYearVision.trim(),
        makaDiyosProject: form.makaDiyosProject.trim(),
        makaDiyosDescription: form.makaDiyosDescription.trim(),
        makaTaoProject: form.makaTaoProject.trim(),
        makaTaoDescription: form.makaTaoDescription.trim(),
        makakalikasanProject: form.makakalikasanProject.trim(),
        makakalikasanDescription: form.makakalikasanDescription.trim(),
        makabansaProject: form.makabansaProject.trim(),
        makabansaDescription: form.makabansaDescription.trim(),
      },
      status: "ongoingSubmission",
      submittedAt: baseCandidate?.submittedAt || new Date().toISOString().split("T")[0],
      votes: baseCandidate?.votes || 0,
      studentId: currentUser?.id || "",
    };
  };

  const handleGenerateEaf = async () => {
    const errs = validateStep(6);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    const ok = await generateEafConfirm.confirm();
    if (!ok) return;
    setLoading(true);
    try {
      const newCandidate = buildCandidate(editingExisting ? existing : undefined);

      if (isSupabaseConfigured && supabase) {
        let pictureUrl: string | undefined;

        if (form.picture) {
          const fileName = `candidate_${crypto.randomUUID()}_${Date.now()}.jpg`;
          pictureUrl = await uploadCandidateImage("candidate-pictures", form.picture, fileName);
        }

        const result = await submitCandidacyRpc({
          p_action: editingExisting ? "update" : "create",
          // The gate is stripped before it leaves the browser.  It is a local
          // preview only — submit_candidacy_rpc derives the real value from the
          // position and party it finds itself, and ignoring the payload is a
          // safety property, not an accident of naming.  Sending it would only
          // invite someone to read the field as something they can assert.
          p_candidate_data: editingExisting ? undefined : ({ ...newCandidate, positionApprovalStatus: undefined } as any),
          p_candidate_id: editingExisting ? existing?.id : undefined,
          p_picture_url: pictureUrl,
        });

        const dbRow = result as Record<string, any> | null;
        if (dbRow) {
          const serverCandidate: Candidate = {
            ...newCandidate,
            id: dbRow.id,
            picture: dbRow.picture_url || newCandidate.picture,
            eafFrontImage: dbRow.eaf_front_url || undefined,
            eafBackImage: dbRow.eaf_back_url || undefined,
            documents: {
              ...newCandidate.documents,
              eafFront: dbRow.doc_eaf_front ?? false,
              eafBack: dbRow.doc_eaf_back ?? false,
            },
          };
          setCandidates(
            editingExisting && existing
              ? candidates.map((c) => (c.id === existing.id ? serverCandidate : c))
              : [...candidates, serverCandidate]
          );
        }
      } else {
        setCandidates(
          editingExisting && existing
            ? candidates.map((c) => (c.id === existing.id ? newCandidate : c))
            : [...candidates, newCandidate]
        );
      }

      setEditingExisting(false);
    } catch (err) {
      setErrors({ submit: err instanceof Error ? err.message : "Submission failed" });
    } finally {
      setLoading(false);
    }
  };

  const handleEditExisting = (candidate: Candidate) => {
    // A founder is whoever registered the slate by running for its President.
    // Inferring it from positionApprovalStatus breaks the moment that founder
    // is approved, since the gate then reads 'presidentApproved'.
    const isNewParty = isPartyFounder(candidate);
    const isIndependent = !candidate.partyAffiliation;
    setPartyModeChosen(true);
    setPartyMode(isNewParty ? "new" : isIndependent ? "independent" : "existing");
    const addrParts = candidate.homeAddress.split(", ");
    let houseStreet = "", barangay = "", city = "", province = "";
    if (addrParts.length >= 4) {
      if (addrParts.length === 5) {
        houseStreet = addrParts[0];
        barangay = addrParts[1];
        city = addrParts[2];
        province = addrParts[3];
      } else {
        barangay = addrParts[0];
        city = addrParts[1];
        province = addrParts[2];
      }
    }
    setForm({
      surname: candidate.surname,
      givenName: candidate.givenName,
      middleName: candidate.middleName || "",
      extensionName: candidate.extensionName || "",
      gradeLevel: candidate.gradeLevel,
      position: candidate.position,
      partyAffiliation: isNewParty ? "" : candidate.partyAffiliation || "",
      newPartyName: isNewParty ? candidate.partyAffiliation || "" : "",
      gender: candidate.gender,
      dateOfBirth: candidate.dateOfBirth,
      age: String(candidate.age),
      email: candidate.email,
      mobileNumber: candidate.mobileNumber,
      landline: candidate.landline || "",
      provinceCode: "",
      provinceName: province,
      cityCode: "",
      cityName: city,
      barangayCode: "",
      barangayName: barangay,
      houseStreet: houseStreet,
      parentGuardianFirstName: candidate.parentGuardianName?.split(" ")[0] || "",
      parentGuardianMiddleInitial: candidate.parentGuardianName && candidate.parentGuardianName.split(" ").length > 2 ? candidate.parentGuardianName.split(" ").slice(1, -1).join(" ").replace(".", "") : "",
      parentGuardianLastName: candidate.parentGuardianName?.split(" ").slice(-1)[0] || "",
      parentGuardianContact: candidate.parentGuardianContact || "",
      leadershipQualities: candidate.leadershipProfile?.qualities || "",
      leadershipSkills: candidate.leadershipProfile?.skills || [],
      leadershipSkillsExplanation: candidate.leadershipProfile?.skillsExplanation || "",
      threeYearVision: candidate.leadershipProfile?.threeYearVision || "",
      makaDiyosProject: candidate.leadershipProfile?.makaDiyosProject || "",
      makaDiyosDescription: candidate.leadershipProfile?.makaDiyosDescription || "",
      makaTaoProject: candidate.leadershipProfile?.makaTaoProject || "",
      makaTaoDescription: candidate.leadershipProfile?.makaTaoDescription || "",
      makakalikasanProject: candidate.leadershipProfile?.makakalikasanProject || "",
      makakalikasanDescription: candidate.leadershipProfile?.makakalikasanDescription || "",
      makabansaProject: candidate.leadershipProfile?.makabansaProject || "",
      makabansaDescription: candidate.leadershipProfile?.makabansaDescription || "",
      picture: null,
      picturePreview: candidate.picture || "",
    });
    setErrors({});
    setEditingExisting(true);
    setStep(0);
  };

  const readEafImage = async (candidate: Candidate, side: "front" | "back", file?: File) => {
    if (!file) return;
    try {
      const base64 = await fileToBase64(file);

      if (isSupabaseConfigured && supabase) {
        const fileName = `eaf_${side}_${candidate.id}_${Date.now()}.jpg`;
        const url = await uploadCandidateImage("candidate-pictures", file, fileName);

        const result = await submitCandidacyRpc({
          p_action: "update",
          p_candidate_id: candidate.id,
          p_eaf_front_url: side === "front" ? url : undefined,
          p_eaf_back_url: side === "back" ? url : undefined,
        });

        const dbRow = result as Record<string, any> | null;
        if (dbRow) {
          setCandidates(
            candidates.map((c) => {
              if (c.id !== candidate.id) return c;
              return {
                ...c,
                eafFrontImage: dbRow.eaf_front_url || undefined,
                eafBackImage: dbRow.eaf_back_url || undefined,
                documents: {
                  ...c.documents,
                  eafFront: dbRow.doc_eaf_front ?? false,
                  eafBack: dbRow.doc_eaf_back ?? false,
                },
              };
            })
          );
        }
      } else {
        setCandidates(
          candidates.map((c) => {
            if (c.id !== candidate.id) return c;
            return {
              ...c,
              eafFrontImage: side === "front" ? base64 : c.eafFrontImage,
              eafBackImage: side === "back" ? base64 : c.eafBackImage,
              documents: {
                ...c.documents,
                eafFront: side === "front" ? true : c.documents.eafFront,
                eafBack: side === "back" ? true : c.documents.eafBack,
              },
            };
          })
        );
      }

      setErrors((e) => ({ ...e, eafUpload: "" }));
    } catch (err) {
      setErrors((e) => ({ ...e, eafUpload: err instanceof Error ? err.message : "Upload failed" }));
    }
  };

  const handleFinalSubmit = async (candidate: Candidate) => {
    if (!candidate.documents.eafFront || !candidate.documents.eafBack) {
      setErrors({ eafUpload: "Upload clear photos of both the front and back of the completed EAF." });
      return;
    }
    // The party President signs off BEFORE the EAF reaches Screening, so the
    // completed form cannot be submitted out from under them.  The button is
    // already disabled in that state; this is the same rule re-checked at the
    // one place that matters, and it fails instantly instead of round-tripping
    // to 057's guard_party_approval_before_finalize trigger.
    const block = partyApprovalBlockForSubmit(candidate);
    if (block === "seat-closed") {
      setErrors({
        eafUpload: `Another candidate was approved for ${candidate.position} in your party. You can only re-apply if the position opens up again.`,
      });
      return;
    }
    if (block === "awaiting-party-president") {
      setGateCheckError(null);
      setErrors({
        eafUpload: `The President of ${candidate.partyAffiliation || "your party"} has to approve this candidacy before you can submit the completed EAF.`,
      });
      return;
    }
    const ok = await finalSubmitConfirm.confirm();
    if (!ok) return;
    setFinalLoading(true);
    try {
      if (isSupabaseConfigured) {
        const result = await submitCandidacyRpc({
          p_action: "finalize",
          p_candidate_id: candidate.id,
        });

        const dbRow = result as Record<string, any> | null;
        if (dbRow) {
          setCandidates(
            candidates.map((c) =>
              c.id === candidate.id
                ? {
                    ...c,
                    documents: {
                      ...c.documents,
                      introductoryProfile: dbRow.doc_introductory_profile ?? true,
                      screeningForm: dbRow.doc_screening_form ?? true,
                      reportCard: dbRow.doc_report_card ?? true,
                      goodMoralCert: dbRow.doc_good_moral_cert ?? true,
                    },
                    status: dbRow.status as Candidate["status"],
                  }
                : c
            )
          );
        }
      } else {
        setCandidates(
          candidates.map((c) =>
            c.id === candidate.id
              ? {
                  ...c,
                  documents: {
                    ...c.documents,
                    introductoryProfile: true,
                    screeningForm: true,
                    reportCard: true,
                    goodMoralCert: true,
                  },
                  status: "pending",
                }
              : c
          )
        );
      }
      if (currentUser?.id) {
        insertNotification({
          userId: currentUser.id,
          role: "student",
          type: "candidacy_pending",
          title: "Application Submitted",
          message: `Your candidacy application for ${candidate.position} has been submitted. Awaiting Commissioner review.`,
          link: "/student/dashboard",
        });
      }
    } catch (err) {
      setErrors({ eafUpload: err instanceof Error ? err.message : "Submission failed" });
    } finally {
      setFinalLoading(false);
    }
  };

  const handleExportPdf = (candidate: Candidate) => {
    const eafDocument = document.querySelector('[data-eaf-document="true"]');
    const eafPage2 = document.querySelector('[data-eaf-page2="true"]');
    if (!eafDocument) {
      setErrors({ eafUpload: "EAF document not found." });
      return;
    }
    const fileName = `${candidate.givenName}-${candidate.surname}-EAF.pdf`;
    // NOTE: `content` is intentionally NOT run through escapeHtml — it is the
    // serialized preview DOM (EAFPreviewDocument renders candidate fields as
    // React-escaped text nodes, so outerHTML re-encodes them safely). Escaping
    // the serialized markup would turn the EAF tags into text entities.
    const content = eafDocument.outerHTML + (eafPage2 ? eafPage2.outerHTML : "");
    const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
      .map((el) => el.outerHTML)
      .join("\n");
    const pdfWindow = window.open("", "_blank", "width=900,height=1100");
    if (!pdfWindow) {
      setErrors({ eafUpload: "Allow pop-ups so the EAF can be saved as PDF." });
      return;
    }
    pdfWindow.document.write(`<!doctype html>
      <html>
        <head>
          <title>${escapeHtml(fileName)}</title>
          ${styles}
          <style>
            @page { size: letter; margin: 0; }
            html, body { margin: 0; padding: 0; width: 8.5in; min-height: 11in; background: #fff; }
            body { display: flex; flex-direction: column; align-items: center; }
            [data-eaf-document="true"], [data-eaf-page2="true"] { box-shadow: none !important; border-radius: 0 !important; width: 8.5in !important; min-height: 11in !important; padding: 0.32in !important; overflow: hidden !important; }
            .print\\:hidden, [class*="print:hidden"] { display: none !important; }
            @media print { html, body { width: 8.5in; min-height: 11in; overflow: visible; } [data-eaf-document="true"] { page-break-after: always; } [data-eaf-page2="true"] { page-break-before: always; } }
          </style>
        </head>
        <body>${content}</body>
      </html>`);
    pdfWindow.document.close();
    pdfWindow.focus();
    setTimeout(() => pdfWindow.print(), 500);
  };

  const statusLabel = (status: Candidate["status"]) =>
    status === "ongoingSubmission" ? "Ongoing Submission" : status.charAt(0).toUpperCase() + status.slice(1);
  const statusClasses = (status: Candidate["status"]) => {
    if (status === "approved") return "bg-green-100 text-green-700";
    if (status === "rejected") return "bg-red-100 text-red-700";
    if (status === "ongoingSubmission") return "bg-blue-100 text-blue-700";
    return "bg-amber-100 text-amber-700";
  };

  const renderEafStep = (candidate: Candidate) => {
    if (!currentStudent) return <div className="p-6 text-sm text-red-600">Student record not found.</div>;
    // The party President's approval is a precondition for submitting, not for
    // filing: a party candidate who has not been approved yet can still upload
    // both photos, but the submit button stays locked until they are.
    const submitBlock = partyApprovalBlockForSubmit(candidate);
    return (
      <div className="p-6 md:p-8 max-w-6xl mx-auto">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
          <h1 className="text-gray-900 mb-1">
            {candidate.givenName}-{candidate.surname}-EAF
          </h1>
          <p className="text-gray-500 text-sm">
            Print the EAF, complete the missing fields and signatures, then upload front and
            back photos. Party candidates submit to the Commissioner only after their party
            President has approved the candidacy.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5">
          <EAFPreviewDocument
            candidate={candidate}
            student={currentStudent}
            onPrint={() => handleExportPdf(candidate)}
          />

          <div className="space-y-4">
            <div className="bg-yellow-50 rounded-2xl shadow-sm border border-yellow-200 p-5">
              <h3 className="text-gray-900 mb-3 text-sm font-semibold">Submission Guide</h3>
              <ol className="space-y-2 text-xs text-gray-600 list-decimal pl-4">
                <li>Export the generated Election Application Form as a PDF.</li>
                <li>Fill in every required signature and any missing handwritten input.</li>
                <li>Answer Part IV on the back of the EAF.</li>
                <li>Take clear photos of the completed EAF front and back, then upload both here.</li>
                <li>
                  {isPartyFounder(candidate)
                    ? "As creator of this new party, your position is set as President. No party approval is needed — you can submit as soon as both photos are uploaded. Your party becomes visible to other students once Screening approves you."
                    : candidate.partyAffiliation
                      ? "Wait for the President of your party to approve your candidacy. They decide from their own dashboard, so use \"Check approval status\" above once they tell you it is done."
                      : "As an Independent candidate, no party approval is needed — you can submit as soon as both photos are uploaded."}
                </li>
                <li>Submit the EAF to the Commissioner on Screening and Validation.</li>
              </ol>
            </div>

            <div className="bg-yellow-50 rounded-2xl shadow-sm border border-yellow-200 p-5">
              <h3 className="text-gray-900 mb-3 text-sm font-semibold">Completed EAF Photos</h3>
              <div className="space-y-3">
                {[
                  { side: "front" as const, label: "Front side", image: candidate.eafFrontImage },
                  { side: "back" as const, label: "Back side", image: candidate.eafBackImage },
                ].map((item) => (
                  <label
                    key={item.side}
                    className="block rounded-xl border border-gray-200 p-3 cursor-pointer hover:border-red-100"
                  >
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => readEafImage(candidate, item.side, e.target.files?.[0])}
                    />
                    <div className="flex items-center gap-3">
                      <div className="w-14 h-14 rounded-lg bg-gray-50 border border-gray-100 overflow-hidden flex items-center justify-center">
                        {item.image ? (
                          <img src={item.image} alt={item.label} className="w-full h-full object-cover" />
                        ) : (
                          <FileImage size={18} className="text-gray-300" />
                        )}
                      </div>
                      <div>
                        <div className="text-sm text-gray-800">{item.label}</div>
                        <div className="text-xs text-gray-400">
                          {item.image ? "Uploaded" : "Tap to upload image"}
                        </div>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
              {errors.eafUpload && (
                <p className="text-xs text-red-500 mt-2 flex items-center gap-1">
                  <AlertCircle size={12} /> {errors.eafUpload}
                </p>
              )}

              {submitBlock === "awaiting-party-president" && (
                <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-200">
                  <div className="flex items-center gap-2 text-xs font-semibold text-amber-900 uppercase tracking-wide">
                    <AlertCircle size={13} className="text-amber-600" />
                    Awaiting your party President
                  </div>
                  <p className="text-xs text-amber-900 mt-1.5 leading-relaxed">
                    Both photos can be uploaded now, but the completed EAF cannot be submitted until
                    the President of <strong>{candidate.partyAffiliation || "your party"}</strong>{" "}
                    approves your candidacy for <strong>{candidate.position}</strong>.
                  </p>
                  <button
                    onClick={() => handleCheckApproval(candidate)}
                    disabled={gateCheckLoading}
                    className="mt-2.5 w-full py-2 rounded-lg border border-amber-300 bg-white text-amber-900 text-xs font-semibold hover:bg-amber-100 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {gateCheckLoading ? (
                      <>
                        <div className="w-3 h-3 border-2 border-amber-300 border-t-amber-700 rounded-full animate-spin" />
                        Checking...
                      </>
                    ) : (
                      "Check approval status"
                    )}
                  </button>
                  {gateCheckedAt && (
                    <p className="text-[11px] text-amber-700 mt-1.5">
                      Last checked at {gateCheckedAt} — still waiting.
                    </p>
                  )}
                  {gateCheckError && (
                    <p className="text-[11px] text-red-600 mt-1.5">{gateCheckError}</p>
                  )}
                </div>
              )}

              {submitBlock === "seat-closed" && (
                <div className="mt-4 p-3 rounded-xl bg-red-50 border border-red-200">
                  <div className="flex items-center gap-2 text-xs font-semibold text-red-800 uppercase tracking-wide">
                    <XCircle size={13} className="text-red-600" />
                    Position already filled
                  </div>
                  <p className="text-xs text-red-900 mt-1.5 leading-relaxed">
                    Another candidate was approved for <strong>{candidate.position}</strong> in your
                    party, so this EAF cannot be submitted. You can re-apply if the position opens up
                    again.
                  </p>
                  {reapplyError && (
                    <p className="text-[11px] text-red-700 mt-1.5">{reapplyError}</p>
                  )}
                  {/* Re-apply lives here as well as in partyGateBanner: the
                      President now decides while the candidate is still in
                      'ongoingSubmission', which is exactly the branch that
                      partyGateBanner never renders. */}
                  <button
                    onClick={handleReapply}
                    disabled={reapplyLoading}
                    className="mt-2.5 w-full py-2 rounded-lg text-white text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
                    style={{ backgroundColor: "#5C0102" }}
                  >
                    {reapplyLoading ? "Re-applying..." : "Re-apply for this position"}
                  </button>
                </div>
              )}

              <button
                onClick={() => handleFinalSubmit(candidate)}
                disabled={finalLoading || candidate.status !== "ongoingSubmission" || !!submitBlock}
                className="w-full mt-4 py-3 text-white rounded-xl text-sm font-medium transition-all hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                style={{ backgroundColor: "#5C0102" }}
              >
                {finalLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Submitting...
                  </>
                ) : submitBlock === "awaiting-party-president" ? (
                  "Waiting for your party President's approval"
                ) : submitBlock === "seat-closed" ? (
                  "Submission closed — position already filled"
                ) : (
                  "Submit Completed EAF to Commissioner on Screening and Validation"
                )}
              </button>
            </div>

            <button
              onClick={() => handleExportPdf(candidate)}
              className="w-full py-3 rounded-xl border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 flex items-center justify-center gap-2"
            >
              <FileDown size={16} /> Download PDF
            </button>
            <button
              onClick={() => handleEditExisting(candidate)}
              className="w-full py-3 rounded-xl border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 flex items-center justify-center gap-2"
            >
              <Pencil size={16} /> Edit Information
            </button>
          </div>
        </div>
      </div>
    );
  };

  const handleReapply = async () => {
    if (!existing) return;
    setReapplyLoading(true);
    setReapplyError(null);
    try {
      const updated = await reapplyPartyCandidacyRpc(existing.id);
      // The RPC returns the raw row, which has no parties(name) join — so
      // patch just the gate fields instead of replacing the whole candidate.
      setCandidates(
        candidates.map((c) =>
          c.id === existing.id
            ? {
                ...c,
                positionApprovalStatus: updated?.position_approval_status ?? c.positionApprovalStatus,
                partyDecidedAt: updated?.party_decided_at ?? undefined,
              }
            : c
        )
      );
    } catch (err) {
      setReapplyError(err instanceof Error ? err.message : "Could not re-apply");
    } finally {
      setReapplyLoading(false);
    }
  };

  /**
   * Re-read this candidacy to pick up the party President's decision.
   *
   * The President approves from their own dashboard, so the write lands in the
   * database with nothing to push it into this page's already-hydrated state.
   * The full mapped row comes back, so the gate, the decision timestamp and the
   * document flags all settle from one read rather than a full page reload.
   */
  const handleCheckApproval = async (candidate: Candidate) => {
    setGateCheckLoading(true);
    setGateCheckError(null);
    try {
      const fresh = await fetchCandidateGate(candidate.id);
      if (!fresh) {
        setGateCheckError("Could not read your application. Please try again.");
        return;
      }
      setCandidates(candidates.map((c) => (c.id === fresh.id ? fresh : c)));
      setGateCheckedAt(new Date().toLocaleTimeString());
      if (fresh.positionApprovalStatus === "presidentApproved") {
        setErrors({});
      }
    } catch (err) {
      setGateCheckError(err instanceof Error ? err.message : "Could not check approval status");
    } finally {
      setGateCheckLoading(false);
    }
  };

  /**
   * Where a party candidacy sits with the President.  Independents and
   * Presidents carry 'notRequired' and get nothing here.
   */
  const partyGateBanner = (candidate: Candidate) => {
    if (!candidate.partyAffiliation) return null;

    if (candidate.positionApprovalStatus === "presidentApprovalRequired") {
      return (
        <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-xl text-left">
          <div className="text-xs font-medium text-amber-800 mb-1 uppercase tracking-wide">
            Waiting for your party President
          </div>
          <p className="text-sm text-amber-900">
            Your candidacy for <strong>{candidate.position}</strong> is with the President of{" "}
            <strong>{candidate.partyAffiliation}</strong>. Once they approve it you can submit your
            completed EAF to the Commissioner on Screening and Validation.
          </p>
        </div>
      );
    }

    if (candidate.positionApprovalStatus === "presidentApproved") {
      return (
        <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-xl text-left">
          <div className="text-xs font-medium text-green-800 mb-1 uppercase tracking-wide">
            Approved by your party President
          </div>
          <p className="text-sm text-green-900">
            The President of <strong>{candidate.partyAffiliation}</strong> approved your candidacy
            for <strong>{candidate.position}</strong>, so the completed EAF has been submitted to
            the Commissioner on Screening and Validation.
          </p>
        </div>
      );
    }

    if (candidate.positionApprovalStatus === "presidentRejected") {
      return (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl text-left">
          <div className="text-xs font-medium text-red-800 mb-1 uppercase tracking-wide">
            Position already filled
          </div>
          <p className="text-sm text-red-900">
            Another candidate was approved for <strong>{candidate.position}</strong> in your party.
            You can re-apply if that position opens up again.
          </p>
          {reapplyError && (
            <p className="mt-2 text-xs text-red-700">{reapplyError}</p>
          )}
          <button
            onClick={handleReapply}
            disabled={reapplyLoading}
            className="mt-3 px-4 py-2 text-white rounded-lg text-xs font-medium hover:opacity-90 transition-all disabled:opacity-60 flex items-center gap-2"
            style={{ backgroundColor: "#5C0102" }}
          >
            {reapplyLoading ? "Re-applying..." : "Re-apply for this position"}
          </button>
        </div>
      );
    }

    return null;
  };

  if (existing?.status === "ongoingSubmission" && !editingExisting) {
    return <>{renderEafStep(existing)}{generateEafConfirm.dialog}{finalSubmitConfirm.dialog}</>;
  }

  if (existing && existing.status !== "ongoingSubmission") {
    const isRejected = existing.status === "rejected";
    const isLowTier = isRejected && existing.rejectionTier === "low";
    const isHighTier = isRejected && existing.rejectionTier === "high";
    return (
      <div className="p-6 md:p-8 max-w-4xl mx-auto">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
          {isRejected ? (
            <>
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 bg-red-100">
                <XCircle size={28} className="text-red-600" />
              </div>
              <h2 className="text-gray-900 mb-2">Application Rejected</h2>
              <p className="text-gray-500 text-sm mb-4">Your candidacy application was not approved.</p>
              <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium bg-red-100 text-red-700`}>
                Status: Rejected
              </div>
              {existing.rejectionReason && (
                <div className="mt-4 bg-red-50 border border-red-200 rounded-xl p-4 text-left">
                  <div className="text-xs font-medium text-red-700 mb-1 uppercase tracking-wide">Reason</div>
                  <div className="text-sm text-red-800 font-medium">{existing.rejectionReason}</div>
                  {existing.rejectionTier && (
                    <span className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                      existing.rejectionTier === "low" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
                    }`}>
                      {existing.rejectionTier === "low" ? "Low Severity — Can be fixed" : "High Severity — Disqualified"}
                    </span>
                  )}
                  {existing.rejectionDetails && (
                    <div className="mt-2 text-xs text-red-600">{existing.rejectionDetails}</div>
                  )}
                </div>
              )}
              <div className="mt-4 text-sm text-gray-500">
                <p>Position: <strong>{existing.position}</strong></p>
                <p>Party: <strong>{existing.partyAffiliation || "Independent"}</strong></p>
              </div>
              {isLowTier && (
                <button
                  onClick={() => {
                    setEditingExisting(true);
                    setStep(0);
                  }}
                  className="mt-5 px-6 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 transition-all flex items-center gap-2 mx-auto"
                  style={{ backgroundColor: "#5C0102" }}
                >
                  <Pencil size={16} /> Revise and Resubmit
                </button>
              )}
              {isHighTier && (
                <div className="mt-4 p-4 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-600">
                  You are disqualified from running in this election period. Please contact the
                  Commissioner of Grievance if you believe this is an error.
                </div>
              )}
            </>
          ) : (
            <>
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: "#E8F5E9" }}>
                <CheckCircle size={28} style={{ color: "#2E7D32" }} />
              </div>
              <h2 className="text-gray-900 mb-2">Application Already Submitted</h2>
              <p className="text-gray-500 text-sm mb-4">You have already submitted a candidacy application.</p>
              <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium ${statusClasses(existing.status)}`}>
                Status: {statusLabel(existing.status)}
              </div>
              <div className="mt-4 text-sm text-gray-500">
                <p>Position: <strong>{existing.position}</strong></p>
                <p>Party: <strong>{existing.status === "approved" ? (existing.partyAffiliation || "Independent") : "Pending approval"}</strong></p>
                <p>Submitted on: <strong>{existing.submittedAt}</strong></p>
              </div>
              {partyGateBanner(existing)}
            </>
          )}
        </div>
        {generateEafConfirm.dialog}
        {finalSubmitConfirm.dialog}
      </div>
    );
  }

  // 058: new applications are only accepted while the Candidate Application
  // Period is open. The RPC enforces this too — this is the friendly version.
  // A student who already started an application is never locked out of it.
  if (!electionPeriod.candidacyOpen && !editingExisting) {
    const meeting = electionPeriod.rulesDiscussionAt
      ? new Date(electionPeriod.rulesDiscussionAt)
      : null;
    const meetingText =
      meeting && !Number.isNaN(meeting.getTime())
        ? meeting.toLocaleString(undefined, {
            year: "numeric", month: "long", day: "numeric",
            hour: "2-digit", minute: "2-digit",
          })
        : null;
    return (
      <div className="p-6 md:p-8 max-w-2xl mx-auto">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 bg-amber-100">
            <AlertCircle size={28} className="text-amber-600" />
          </div>
          <h2 className="text-gray-900 mb-2">The Candidate Application Period is closed</h2>
          <p className="text-gray-500 text-sm mb-4">
            The Electoral Board is not accepting new candidacy applications right now.
            {electionPeriod.schoolYear ? ` This election is for School Year ${electionPeriod.schoolYear}.` : ""}
          </p>

          {meetingText ? (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4 text-left">
              <div className="text-xs font-medium text-blue-700 mb-1 uppercase tracking-wide">
                Rules Discussion Meeting
              </div>
              <div className="text-sm text-blue-900 font-medium">{meetingText}</div>
              <p className="text-xs text-blue-700 mt-2">
                The meeting is announced in each approved candidate&rsquo;s page. It is where
                campaign rules are discussed and questions are answered.
              </p>
            </div>
          ) : (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-4 text-left text-sm text-gray-600">
              The Rules Discussion Meeting has not been scheduled yet. Check back later.
            </div>
          )}

          <p className="text-xs text-gray-400">
            If you believe the application period is still open, please see the Screening and
            Validation Commissioner.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-gray-900 mb-1">
          {editingExisting ? "Edit EAF Information" : "Apply for Candidacy"}
        </h1>
        <p className="text-gray-500 text-sm">
          {editingExisting
            ? "Update your information, then regenerate the EAF PDF preview."
            : "Complete all steps below. The system will generate your printable EAF at the end."}
        </p>
      </motion.div>

      {/* Step Indicator */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          {STEPS.map((label, i) => (
            <div key={i} className="flex items-center flex-1">
              <div className="flex flex-col items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                    i < step
                      ? "bg-green-500 text-white"
                      : i === step
                      ? "text-white"
                      : "bg-gray-200 text-gray-500"
                  }`}
                  style={i === step ? { backgroundColor: "#5C0102" } : {}}
                >
                  {i < step ? <Check size={14} /> : i + 1}
                </div>
                <span
                  className={`text-[10px] mt-1.5 text-center leading-tight max-w-[70px] ${
                    i === step ? "font-semibold" : "text-gray-400"
                  }`}
                  style={i === step ? { color: "#5C0102" } : {}}
                >
                  {label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={`flex-1 h-0.5 mx-2 mt-[-1.2rem] ${
                    i < step ? "bg-green-500" : "bg-gray-200"
                  }`}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-6">
          {errors.submit && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-start gap-2">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
              <span>{errors.submit}</span>
            </div>
          )}
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              {/* Step 0: Personal Information */}
              {step === 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-4 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full text-white text-xs flex items-center justify-center" style={{ backgroundColor: "#5C0102" }}>1</span>
                    Personal Information
                  </h3>

                  {/* 2x2 Picture */}
                  <div className="mb-6 p-4 rounded-xl" style={{ backgroundColor: "#FFF5F5" }}>
                    <p className="text-sm mb-3" style={{ color: "#5C0102" }}>
                      2x2 Picture <span className="text-red-500">*</span>
                    </p>
                    <div className="flex items-center gap-5">
                      <div
                        className="w-20 h-20 rounded-lg border-2 border-dashed overflow-hidden flex items-center justify-center bg-white"
                        style={{ borderColor: errors.picture ? "#ef4444" : "#5C0102" }}
                      >
                        {form.picturePreview ? (
                          <img src={form.picturePreview} alt="Preview" className="w-full h-full object-cover" />
                        ) : (
                          <Upload size={20} className="text-gray-300" />
                        )}
                      </div>
                      <div>
                        <label className="block">
                          <input type="file" accept="image/*" className="hidden" onChange={handlePictureUpload} />
                          <span
                            className="px-4 py-2 rounded-lg text-white text-sm cursor-pointer inline-block hover:opacity-90 transition-all"
                            style={{ backgroundColor: "#5C0102" }}
                          >
                            Upload Photo
                          </span>
                        </label>
                        <p className="text-xs text-gray-400 mt-1.5">JPG, PNG - 2x2 format preferred</p>
                        {errors.picture && (
                          <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                            <AlertCircle size={12} /> {errors.picture}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <InputField label="Surname" field="surname" value={form.surname} onChange={update} error={errors.surname} placeholder="e.g. Santos" />
                    <InputField label="Given Name" field="givenName" value={form.givenName} onChange={update} error={errors.givenName} placeholder="e.g. Maria" />
                    <InputField label="Middle Name" field="middleName" value={form.middleName} onChange={update} error={errors.middleName} placeholder="Optional" required={false} />
                    <InputField label="Extension Name" field="extensionName" value={form.extensionName} onChange={update} error={errors.extensionName} placeholder="Jr., Sr., III (optional)" required={false} />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
                    <div>
                      <label className="block text-sm text-gray-700 mb-1.5">Grade Level <span className="text-red-500">*</span></label>
                      <select
                        value={form.gradeLevel}
                        onChange={(e) => update("gradeLevel", e.target.value)}
                        className={`w-full px-4 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102] bg-gray-50 ${errors.gradeLevel ? "border-red-400" : "border-gray-200"}`}
                      >
                        <option value="">Select grade level</option>
                        {GRADE_LEVELS.map(g => <option key={g}>{g}</option>)}
                      </select>
                      {errors.gradeLevel && <p className="text-xs text-red-500 mt-1"><AlertCircle size={12} /> {errors.gradeLevel}</p>}
                    </div>
                    <div>
                      <label className="block text-sm text-gray-700 mb-1.5">Gender <span className="text-red-500">*</span></label>
                      <select
                        value={form.gender}
                        onChange={(e) => update("gender", e.target.value)}
                        className={`w-full px-4 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102] bg-gray-50 ${errors.gender ? "border-red-400" : "border-gray-200"}`}
                      >
                        <option value="">Select gender</option>
                        {GENDERS.map(g => <option key={g}>{g}</option>)}
                      </select>
                      {errors.gender && <p className="text-xs text-red-500 mt-1"><AlertCircle size={12} /> {errors.gender}</p>}
                    </div>
                    <InputField label="Date of Birth" field="dateOfBirth" type="date" value={form.dateOfBirth} onChange={update} error={errors.dateOfBirth} />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
                    <InputField label="Age" field="age" value={form.age} onChange={update} hint="Auto-calculated" readonly />
                    <InputField label="Email Address" field="email" type="email" value={form.email} onChange={update} error={errors.email} placeholder="your.email@example.com" />
                    <InputField label="Mobile Number" field="mobileNumber" value={form.mobileNumber} onChange={update} error={errors.mobileNumber} placeholder="09XXXXXXXXX" />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                    <InputField label="Landline" field="landline" value={form.landline} onChange={update} error={errors.landline} placeholder="Optional" required={false} />
                  </div>
                </div>
              )}

              {/* Step 1: Home Address */}
              {step === 1 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-4 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full text-white text-xs flex items-center justify-center" style={{ backgroundColor: "#5C0102" }}>2</span>
                    Home Address (Region V - Bicol)
                  </h3>
                  <div className="space-y-3">
                    {addressError && (
                      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-2 text-xs text-yellow-700">
                        ⚠️ {addressError}
                      </div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Province <span className="text-red-500">*</span></label>
                        <select
                          value={form.provinceCode}
                          onChange={(e) => {
                            const prov = provinces.find(p => p.code === e.target.value);
                            if (prov) handleProvinceChange(prov.code, prov.name);
                          }}
                          className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102] bg-gray-50"
                          disabled={loadingAddress && provinces.length === 0}
                        >
                          <option value="">Select province</option>
                          {provinces.map(p => (
                            <option key={p.code} value={p.code}>{p.name}</option>
                          ))}
                        </select>
                        {errors.province && <p className="text-xs text-red-500 mt-1"><AlertCircle size={12} /> {errors.province}</p>}
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">City / Municipality <span className="text-red-500">*</span></label>
                        <select
                          value={form.cityCode}
                          onChange={(e) => {
                            const city = cities.find(c => c.code === e.target.value);
                            if (city) handleCityChange(city.code, city.name);
                          }}
                          className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102] bg-gray-50"
                          disabled={loadingAddress && cities.length === 0}
                        >
                          <option value="">Select city/municipality</option>
                          {cities.map(c => (
                            <option key={c.code} value={c.code}>{c.name}</option>
                          ))}
                        </select>
                        {errors.city && <p className="text-xs text-red-500 mt-1"><AlertCircle size={12} /> {errors.city}</p>}
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Barangay <span className="text-red-500">*</span></label>
                      <select
                        value={form.barangayCode}
                        onChange={(e) => {
                          const brgy = barangays.find(b => b.code === e.target.value);
                          if (brgy) handleBarangayChange(brgy.code, brgy.name);
                        }}
                        className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102] bg-gray-50"
                        disabled={loadingAddress && barangays.length === 0}
                      >
                        <option value="">Select barangay</option>
                        {barangays.map(b => (
                          <option key={b.code} value={b.code}>{b.name}</option>
                        ))}
                      </select>
                      {errors.barangay && <p className="text-xs text-red-500 mt-1"><AlertCircle size={12} /> {errors.barangay}</p>}
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">House Number / Street (optional)</label>
                      <input
                        type="text"
                        value={form.houseStreet}
                        onChange={(e) => update("houseStreet", e.target.value)}
                        className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102] bg-gray-50"
                        placeholder="e.g., Block 1 Lot 2, Purok 1"
                      />
                    </div>
                    <div className="bg-gray-50 p-3 rounded-lg text-xs text-gray-600">
                      <span className="font-medium">Full address to be saved:</span> {fullHomeAddress || "(incomplete)"}
                    </div>
                    {loadingAddress && (
                      <div className="text-xs text-gray-400 text-center py-1">Loading address data...</div>
                    )}
                  </div>
                </div>
              )}

              {/* Step 2: Parent/Guardian Contact */}
              {step === 2 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-4 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full text-white text-xs flex items-center justify-center" style={{ backgroundColor: "#5C0102" }}>3</span>
                    Parent / Guardian Contact
                  </h3>
                  <div>
                    <label className="block text-sm text-gray-700 mb-1.5">Parent/Guardian Name <span className="text-red-500">*</span></label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <input
                          type="text"
                          value={form.parentGuardianFirstName}
                          onChange={(e) => update("parentGuardianFirstName", e.target.value)}
                          placeholder="First name"
                          className={`w-full px-4 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102] bg-gray-50 ${errors.parentGuardianFirstName ? "border-red-400" : "border-gray-200"}`}
                        />
                        {errors.parentGuardianFirstName && <p className="text-xs text-red-500 mt-1"><AlertCircle size={12} /> {errors.parentGuardianFirstName}</p>}
                      </div>
                      <div>
                        <input
                          type="text"
                          value={form.parentGuardianMiddleInitial}
                          onChange={(e) => update("parentGuardianMiddleInitial", e.target.value.replace(/[^a-zA-Z]/g, "").slice(0, 1))}
                          placeholder="M.I."
                          className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102] bg-gray-50"
                          maxLength={1}
                        />
                      </div>
                      <div>
                        <input
                          type="text"
                          value={form.parentGuardianLastName}
                          onChange={(e) => update("parentGuardianLastName", e.target.value)}
                          placeholder="Last name"
                          className={`w-full px-4 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102] bg-gray-50 ${errors.parentGuardianLastName ? "border-red-400" : "border-gray-200"}`}
                        />
                        {errors.parentGuardianLastName && <p className="text-xs text-red-500 mt-1"><AlertCircle size={12} /> {errors.parentGuardianLastName}</p>}
                      </div>
                    </div>
                  </div>
                  <InputField
                    label="Parent/Guardian Contact Number"
                    field="parentGuardianContact"
                    value={form.parentGuardianContact}
                    onChange={update}
                    error={errors.parentGuardianContact}
                    placeholder="09XXXXXXXXX"
                  />
                </div>
              )}

              {/* Step 3: Party Affiliation and Elective Position */}
              {step === 3 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-4 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full text-white text-xs flex items-center justify-center" style={{ backgroundColor: "#5C0102" }}>4</span>
                    Party Affiliation and Elective Position
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm text-gray-700 mb-1.5">Party Type <span className="text-red-500">*</span></label>
                      <select
                        value={partyMode}
                        onChange={(e) => {
                          setPartyModeChosen(true);
                          setPartyMode(e.target.value as "existing" | "new" | "independent");
                        }}
                        className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102] bg-gray-50"
                      >
                        <option value="independent">Independent (No Party)</option>
                        {existingParties.length > 0 && <option value="existing">Existing party</option>}
                        <option value="new">Create new party</option>
                      </select>
                    </div>

                    {partyMode === "existing" && (
                      <div>
                        <label className="block text-sm text-gray-700 mb-1.5">Existing Party <span className="text-red-500">*</span></label>
                        <select
                          value={form.partyAffiliation}
                          onChange={(e) => update("partyAffiliation", e.target.value)}
                          className={`w-full px-4 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102] bg-gray-50 ${errors.party ? "border-red-400" : "border-gray-200"}`}
                        >
                          {partyOptions.map(party => (
                            <option
                              key={party.id}
                              value={party.name}
                              disabled={!!party.blockedReason}
                            >
                              {party.name}
                              {party.blockedReason === "awaiting-president"
                                ? " — awaiting President screening"
                                : party.blockedReason === "full"
                                  ? " — all positions filled"
                                  : ""}
                            </option>
                          ))}
                        </select>
                        {errors.party && <p className="text-xs text-red-500 mt-1"><AlertCircle size={12} /> {errors.party}</p>}
                        {partyOptions.length === 0 ? (
                          <p className="text-xs text-gray-400 mt-1">No parties have been registered for this election yet.</p>
                        ) : joinableParties.length === 0 ? (
                          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-2 mt-1.5">
                            <p className="font-medium">No parties are accepting applicants right now.</p>
                            <p className="mt-0.5 text-amber-800">
                              {partyOptions.length} part{partyOptions.length === 1 ? "y is" : "ies are"} listed above, but
                              each one is either full or still waiting for its President to be screened in. You can run as an
                              Independent candidate or create a new party in the meantime.
                            </p>
                          </div>
                        ) : selectedParty ? (
                          <div className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-md px-2.5 py-2 mt-1.5">
                            <p className="font-medium text-gray-700">{selectedParty.name}</p>
                            {selectedParty.blockedReason === "awaiting-president" ? (
                              <p className="mt-0.5 text-amber-800">Awaiting President screening — this party cannot accept members until its President is approved.</p>
                            ) : selectedParty.blockedReason === "full" ? (
                              <p className="mt-0.5 text-amber-800">Party already full — every {form.gradeLevel || "grade"} position already has a candidate.</p>
                            ) : openPartySeats.length > 0 ? (
                              <p className="mt-0.5">
                                Open {form.gradeLevel || "grade"} positions: {openPartySeats.map(s => s.position).join(", ")}.
                              </p>
                            ) : (
                              <p className="mt-0.5">No position is open for {form.gradeLevel || "your grade"} in this party.</p>
                            )}
                          </div>
                        ) : null}
                      </div>
                    )}

                    {partyMode === "new" && (
                      <div>
                        <label className="block text-sm text-gray-700 mb-1.5">New Party Name <span className="text-red-500">*</span></label>
                        <input
                          value={form.newPartyName}
                          onChange={(e) => update("newPartyName", e.target.value)}
                          placeholder="Enter party name"
                          className={`w-full px-4 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102] bg-gray-50 ${errors.party ? "border-red-400" : "border-gray-200"}`}
                        />
                        {errors.party && <p className="text-xs text-red-500 mt-1"><AlertCircle size={12} /> {errors.party}</p>}
                        <p className="text-xs text-gray-400 mt-1">New party creators are automatically assigned President.</p>
                      </div>
                    )}

                    {partyMode !== "independent" && (
                      <div>
                        <label className="block text-sm text-gray-700 mb-1.5">Elective Position <span className="text-red-500">*</span></label>
                        <select
                          value={form.position}
                          onChange={(e) => update("position", e.target.value)}
                          disabled={partyMode === "new"}
                          className={`w-full px-4 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102] ${partyMode === "new" ? "bg-gray-100 text-gray-500 cursor-not-allowed" : "bg-gray-50"} ${errors.position ? "border-red-400" : "border-gray-200"}`}
                        >
                          <option value="">Select position</option>
                          {seatChoices.map(seat => {
                            const selectable = isSeatSelectable(seat, partyMode === "existing");
                            const suffix =
                              seat.state === "filled"
                                ? " — filled"
                                : seat.requestCount > 0
                                  ? ` — ${seat.requestCount} in the running`
                                  : "";
                            return (
                              <option key={seat.position} value={seat.position} disabled={!selectable}>
                                {seat.position}{suffix}
                              </option>
                            );
                          })}
                        </select>
                        {errors.position && <p className="text-xs text-red-500 mt-1"><AlertCircle size={12} /> {errors.position}</p>}
                        <p className="text-xs text-gray-400 mt-1">
                          {partyMode === "existing" ? "Other students may contest the same position; your party President decides who wins. Positions marked filled already have an approved candidate." : "Locked to President for a new party."}
                        </p>
                      </div>
                    )}

                    {partyMode === "independent" && (
                      <div>
                        <label className="block text-sm text-gray-700 mb-1.5">Elective Position <span className="text-red-500">*</span></label>
                        <select
                          value={form.position}
                          onChange={(e) => update("position", e.target.value)}
                          className={`w-full px-4 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102] bg-gray-50 ${errors.position ? "border-red-400" : "border-gray-200"}`}
                        >
                          <option value="">Select position</option>
                          {seatChoices.map(seat => (
                            <option
                              key={seat.position}
                              value={seat.position}
                              disabled={!isSeatSelectable(seat)}
                            >
                              {seat.position}
                              {seat.state === "filled" ? " — filled" : ""}
                            </option>
                          ))}
                        </select>
                        {errors.position && <p className="text-xs text-red-500 mt-1"><AlertCircle size={12} /> {errors.position}</p>}
                        <p className="text-xs text-gray-400 mt-1">Independent candidates may run for any open position.</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Step 4: Introductory Profile */}
              {step === 4 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-4 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full text-white text-xs flex items-center justify-center" style={{ backgroundColor: "#5C0102" }}>5</span>
                    Introductory Profile
                  </h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm text-gray-700 mb-1.5">
                        What qualities do you possess as an inspiring student leader? <span className="text-red-500">*</span>
                      </label>
                      <textarea
                        value={form.leadershipQualities}
                        onChange={(e) => update("leadershipQualities", e.target.value)}
                        rows={5}
                        className={`w-full px-4 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102] bg-gray-50 ${errors.leadershipQualities ? "border-red-400" : "border-gray-200"}`}
                      />
                      <p className={`text-xs mt-1 ${wordCount(form.leadershipQualities) >= MIN_WORDS ? "text-green-600" : "text-gray-400"}`}>
                        {wordCount(form.leadershipQualities)}/{MIN_WORDS} words
                      </p>
                      {errors.leadershipQualities && <p className="text-xs text-red-500 mt-1"><AlertCircle size={12} /> {errors.leadershipQualities}</p>}
                    </div>
                    <div>
                      <label className="block text-sm text-gray-700 mb-2">
                        Check the organizational skills applicable to you <span className="text-red-500">*</span>
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {LEADERSHIP_SKILLS.map((skill) => (
                          <label key={skill} className="flex items-center gap-2 text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                            <input
                              type="checkbox"
                              checked={form.leadershipSkills.includes(skill)}
                              onChange={(e) => {
                                update(
                                  "leadershipSkills",
                                  e.target.checked
                                    ? [...form.leadershipSkills, skill]
                                    : form.leadershipSkills.filter((item) => item !== skill)
                                );
                              }}
                            />
                            {skill}
                          </label>
                        ))}
                      </div>
                      {errors.leadershipSkills && <p className="text-xs text-red-500 mt-1"><AlertCircle size={12} /> {errors.leadershipSkills}</p>}
                    </div>
                    <div>
                      <label className="block text-sm text-gray-700 mb-1.5">
                        Why are these skills applicable to you? <span className="text-red-500">*</span>
                      </label>
                      <textarea
                        value={form.leadershipSkillsExplanation}
                        onChange={(e) => update("leadershipSkillsExplanation", e.target.value)}
                        rows={5}
                        className={`w-full px-4 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102] bg-gray-50 ${errors.leadershipSkillsExplanation ? "border-red-400" : "border-gray-200"}`}
                      />
                      <p className={`text-xs mt-1 ${wordCount(form.leadershipSkillsExplanation) >= MIN_WORDS ? "text-green-600" : "text-gray-400"}`}>
                        {wordCount(form.leadershipSkillsExplanation)}/{MIN_WORDS} words
                      </p>
                      {errors.leadershipSkillsExplanation && <p className="text-xs text-red-500 mt-1"><AlertCircle size={12} /> {errors.leadershipSkillsExplanation}</p>}
                    </div>
                    <div>
                      <label className="block text-sm text-gray-700 mb-1.5">
                        What is your vision of the Learner Government in 3 years' time? <span className="text-red-500">*</span>
                      </label>
                      <textarea
                        value={form.threeYearVision}
                        onChange={(e) => update("threeYearVision", e.target.value)}
                        rows={5}
                        className={`w-full px-4 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102] bg-gray-50 ${errors.threeYearVision ? "border-red-400" : "border-gray-200"}`}
                      />
                      <p className={`text-xs mt-1 ${wordCount(form.threeYearVision) >= MIN_WORDS ? "text-green-600" : "text-gray-400"}`}>
                        {wordCount(form.threeYearVision)}/{MIN_WORDS} words
                      </p>
                      {errors.threeYearVision && <p className="text-xs text-red-500 mt-1"><AlertCircle size={12} /> {errors.threeYearVision}</p>}
                    </div>
                  </div>
                </div>
              )}

              {/* Step 5: Leadership Capsule */}
              {step === 5 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-4 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full text-white text-xs flex items-center justify-center" style={{ backgroundColor: "#5C0102" }}>6</span>
                    Leadership Capsule
                  </h3>
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5 text-sm text-amber-800 leading-relaxed">
                    <p className="font-medium mb-1">IV. Leadership Capsule</p>
                    <p className="indent-7">
                      Direction: Answer the guide question below. Also, write at least one SSLG/YES-O project
                      or program for each core value: Maka-Diyos, Maka-Tao, Makakalikasan, at Makabansa.
                      Include the name of each project or program and write a description about it as part of
                      your SSLG/YES-O platform/pledge for the school.
                    </p>
                  </div>

                  <div className="space-y-5">
                    <div>
                      <label className="block text-sm text-gray-700 mb-2 font-medium">
                        What are your qualities that you believe can make a great leader?
                      </label>
                      <textarea
                        value={form.leadershipQualities}
                        onChange={(e) => update("leadershipQualities", e.target.value)}
                        rows={4}
                        className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102] bg-gray-50"
                      />
                    </div>

                    {([
                      { key: "makaDiyos", label: "Maka-Diyos" },
                      { key: "makaTao", label: "Maka-Tao" },
                      { key: "makakalikasan", label: "Makakalikasan" },
                      { key: "makabansa", label: "Makabansa" },
                    ] as const).map(({ key, label }) => (
                      <div key={key} className="border border-gray-200 rounded-xl p-4">
                        <h4 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">{label}</h4>
                        <div className="space-y-3">
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">Project/Program Name <span className="text-red-500">*</span></label>
                            <input
                              type="text"
                              value={form[`${key}Project` as keyof typeof form] as string}
                              onChange={(e) => update(`${key}Project`, e.target.value)}
                              placeholder="e.g., Outreach Program"
                              className={`w-full px-4 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102] bg-gray-50 ${errors[`${key}Project`] ? "border-red-400" : "border-gray-200"}`}
                            />
                            {errors[`${key}Project`] && <p className="text-xs text-red-500 mt-1"><AlertCircle size={12} /> {errors[`${key}Project`]}</p>}
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">Description <span className="text-red-500">*</span></label>
                            <textarea
                              value={form[`${key}Description` as keyof typeof form] as string}
                              onChange={(e) => update(`${key}Description`, e.target.value)}
                              rows={3}
                              placeholder="Describe the project/program..."
                              className={`w-full px-4 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-[#5C0102] bg-gray-50 ${errors[`${key}Description`] ? "border-red-400" : "border-gray-200"}`}
                            />
                            {errors[`${key}Description`] && <p className="text-xs text-red-500 mt-1"><AlertCircle size={12} /> {errors[`${key}Description`]}</p>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 6: Generate Printable EAF */}
              {step === 6 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-4 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full text-white text-xs flex items-center justify-center" style={{ backgroundColor: "#5C0102" }}>7</span>
                    Generate Printable EAF
                  </h3>

                  <div className="bg-gray-50 rounded-xl p-4 space-y-3 mb-5">
                    <h4 className="text-sm font-medium text-gray-700">Summary of Information</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                      <div><span className="text-gray-500">Name:</span> <span className="font-medium">{form.givenName} {form.middleName} {form.surname} {form.extensionName}</span></div>
                      <div><span className="text-gray-500">Grade Level:</span> <span className="font-medium">{form.gradeLevel}</span></div>
                      <div><span className="text-gray-500">Gender:</span> <span className="font-medium">{form.gender}</span></div>
                      <div><span className="text-gray-500">Date of Birth:</span> <span className="font-medium">{form.dateOfBirth}</span></div>
                      <div><span className="text-gray-500">Email:</span> <span className="font-medium">{form.email}</span></div>
                      <div><span className="text-gray-500">Mobile:</span> <span className="font-medium">{form.mobileNumber}</span></div>
                      <div className="sm:col-span-2 break-words whitespace-normal"><span className="text-gray-500">Address:</span> <span className="font-medium">{fullHomeAddress}</span></div>
                      <div><span className="text-gray-500">Parent/Guardian:</span> <span className="font-medium">{[form.parentGuardianFirstName, form.parentGuardianMiddleInitial ? form.parentGuardianMiddleInitial + "." : "", form.parentGuardianLastName].filter(Boolean).join(" ")}</span></div>
                      <div><span className="text-gray-500">Parent Contact:</span> <span className="font-medium">{form.parentGuardianContact}</span></div>
                      <div><span className="text-gray-500">Party:</span> <span className="font-medium">{partyMode === "independent" ? "Independent" : partyMode === "new" ? form.newPartyName : form.partyAffiliation}</span></div>
                      <div><span className="text-gray-500">Position:</span> <span className="font-medium">{partyMode === "new" ? "President" : form.position}</span></div>
                    </div>
                  </div>

                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-xs text-blue-800 mb-5">
                    <strong>What happens next:</strong> The system will generate a printable EAF PDF with your information pre-filled. You'll need to print it, complete the missing fields and signatures, then upload front/back photos for Commissioner on Screening and Validation review.
                  </div>

                  <button
                    onClick={handleGenerateEaf}
                    disabled={loading}
                    className="w-full py-3 text-white rounded-xl text-sm font-medium transition-all hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    style={{ backgroundColor: "#5C0102" }}
                  >
                    {loading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Generating EAF...
                      </>
                    ) : editingExisting ? (
                      "Update Printable EAF"
                    ) : (
                      "Generate Printable EAF"
                    )}
                  </button>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {/* Navigation Buttons */}
          <div className="flex items-center justify-between mt-8 pt-6 border-t border-gray-100">
            <button
              onClick={handleBack}
              disabled={step === 0}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              <ChevronLeft size={16} /> Back
            </button>

            <div className="flex items-center gap-2">
              {step < STEPS.length - 1 && (
                <button
                  onClick={handleNext}
                  className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-white text-sm font-medium hover:opacity-90 transition-all"
                  style={{ backgroundColor: "#5C0102" }}
                >
                  Next <ChevronRight size={16} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      {generateEafConfirm.dialog}
      {finalSubmitConfirm.dialog}
    </div>
  );
}
