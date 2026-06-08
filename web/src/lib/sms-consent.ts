import { promises as fs } from "fs";
import path from "path";
import { getRedis, isVercelProduction } from "./redis";
import { normalizePhone } from "./store";

const OPT_OUT_KEY = "onpar:sms-opt-out";
const DATA_DIR = path.join(process.cwd(), "data");
const OPT_OUT_FILE = path.join(DATA_DIR, "sms-opt-out.json");

async function readOptOutList(): Promise<string[]> {
  const redis = getRedis();
  if (redis) {
    const data = await redis.get<string[]>(OPT_OUT_KEY);
    return Array.isArray(data) ? data : [];
  }
  try {
    const raw = await fs.readFile(OPT_OUT_FILE, "utf-8");
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeOptOutList(phones: string[]): Promise<void> {
  const redis = getRedis();
  if (redis) {
    await redis.set(OPT_OUT_KEY, phones);
    return;
  }
  if (isVercelProduction()) return;
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(OPT_OUT_FILE, JSON.stringify(phones, null, 2), "utf-8");
}

export async function isSmsOptedOut(phone: string): Promise<boolean> {
  try {
    const normalized = normalizePhone(phone);
    const list = await readOptOutList();
    return list.includes(normalized);
  } catch {
    return false;
  }
}

export async function addSmsOptOut(phone: string): Promise<void> {
  const normalized = normalizePhone(phone);
  const list = await readOptOutList();
  if (!list.includes(normalized)) {
    list.push(normalized);
    await writeOptOutList(list);
  }
}

export async function removeSmsOptOut(phone: string): Promise<void> {
  const normalized = normalizePhone(phone);
  const list = await readOptOutList();
  await writeOptOutList(list.filter((p) => p !== normalized));
}
