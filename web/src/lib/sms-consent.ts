import { promises as fs } from "fs";
import path from "path";
import { getSupabaseAdmin } from "./supabase";
import { normalizePhone } from "./store";

const DATA_DIR = path.join(process.cwd(), "data");
const OPT_OUT_FILE = path.join(DATA_DIR, "sms-opt-out.json");

async function readFileOptOutList(): Promise<string[]> {
  try {
    const raw = await fs.readFile(OPT_OUT_FILE, "utf-8");
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeFileOptOutList(phones: string[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(OPT_OUT_FILE, JSON.stringify(phones, null, 2), "utf-8");
}

export async function isSmsOptedOut(phone: string): Promise<boolean> {
  try {
    const normalized = normalizePhone(phone);
    const supabase = getSupabaseAdmin();
    if (supabase) {
      const { data } = await supabase
        .from("customers")
        .select("sms_opted_out")
        .eq("phone", normalized)
        .maybeSingle();
      return data?.sms_opted_out === true;
    }
    const list = await readFileOptOutList();
    return list.includes(normalized);
  } catch {
    return false;
  }
}

export async function addSmsOptOut(phone: string): Promise<void> {
  const normalized = normalizePhone(phone);
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data: existing } = await supabase
      .from("customers")
      .select("id")
      .eq("phone", normalized)
      .maybeSingle();
    if (existing) {
      await supabase
        .from("customers")
        .update({ sms_opted_out: true })
        .eq("id", existing.id);
    } else {
      await supabase.from("customers").insert({
        phone: normalized,
        name: "Guest",
        sms_opted_out: true,
      });
    }
    return;
  }
  const list = await readFileOptOutList();
  if (!list.includes(normalized)) {
    list.push(normalized);
    await writeFileOptOutList(list);
  }
}

export async function removeSmsOptOut(phone: string): Promise<void> {
  const normalized = normalizePhone(phone);
  const supabase = getSupabaseAdmin();
  if (supabase) {
    await supabase
      .from("customers")
      .update({ sms_opted_out: false })
      .eq("phone", normalized);
    return;
  }
  const list = await readFileOptOutList();
  await writeFileOptOutList(list.filter((p) => p !== normalized));
}
