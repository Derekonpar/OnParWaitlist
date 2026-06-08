import { promises as fs } from "fs";
import path from "path";
import { Redis } from "@upstash/redis";
import { randomUUID } from "crypto";
import { displayName } from "./display";
import {
  ACTIVITIES,
  type Activity,
  type ActivityStats,
  ACTIVITY_LABELS,
  MINUTES_PER_PARTY,
  type WaitlistEntry,
  type WaitlistStatus,
} from "./types";

const STORE_KEY = "onpar:waitlist";
const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "waitlist.json");

let storeLock: Promise<unknown> = Promise.resolve();

function withStoreLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = storeLock.then(fn, fn);
  storeLock = run.catch(() => {});
  return run;
}

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

async function readAllUnsafe(): Promise<WaitlistEntry[]> {
  const redis = getRedis();
  if (redis) {
    try {
      const data = await redis.get<WaitlistEntry[]>(STORE_KEY);
      return Array.isArray(data) ? data : [];
    } catch (err) {
      console.error("[store] Redis read failed, using empty queue:", err);
      return [];
    }
  }

  try {
    const raw = await fs.readFile(DATA_FILE, "utf-8");
    const parsed = JSON.parse(raw) as WaitlistEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeAllUnsafe(entries: WaitlistEntry[]): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(STORE_KEY, entries);
      return;
    } catch (err) {
      console.error("[store] Redis write failed:", err);
      throw new Error("STORE_WRITE_FAILED");
    }
  }

  await fs.mkdir(DATA_DIR, { recursive: true });
  const tempFile = `${DATA_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(entries, null, 2), "utf-8");
  await fs.rename(tempFile, DATA_FILE);
}

async function readAll(): Promise<WaitlistEntry[]> {
  return withStoreLock(readAllUnsafe);
}

async function writeAll(entries: WaitlistEntry[]): Promise<void> {
  return withStoreLock(() => writeAllUnsafe(entries));
}

export interface QueuePreview {
  position: number;
  displayName: string;
  status: WaitlistStatus;
}

export interface ActivityBoard {
  stats: ActivityStats;
  queue: QueuePreview[];
}

export async function getStats(): Promise<ActivityStats[]> {
  const entries = await readAll();
  return ACTIVITIES.map((activity) => buildStats(activity, entries));
}

function buildStats(
  activity: Activity,
  entries: WaitlistEntry[],
): ActivityStats {
  const waiting = entries.filter(
    (e) => e.activity === activity && e.status === "waiting",
  );
  const count = waiting.length;
  return {
    activity,
    label: ACTIVITY_LABELS[activity],
    waitingCount: count,
    estimatedWaitMinutes: count * MINUTES_PER_PARTY[activity],
  };
}

export async function getBoard(): Promise<ActivityBoard[]> {
  const entries = await readAll();
  return ACTIVITIES.map((activity) => {
    const waiting = entries
      .filter(
        (e) =>
          e.activity === activity &&
          (e.status === "waiting" || e.status === "notified"),
      )
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );

    return {
      stats: buildStats(activity, entries),
      queue: waiting.map((e, i) => ({
        position: i + 1,
        displayName: displayName(e.name),
        status: e.status,
      })),
    };
  });
}

export async function getQueue(activity: Activity): Promise<WaitlistEntry[]> {
  const entries = await readAll();
  return entries
    .filter((e) => e.activity === activity && e.status !== "cancelled")
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
}

export async function getPosition(
  id: string,
): Promise<{ entry: WaitlistEntry; position: number } | null> {
  const entries = await readAll();
  const entry = entries.find((e) => e.id === id);
  if (!entry || entry.status !== "waiting") return null;

  const ahead = entries.filter(
    (e) =>
      e.activity === entry.activity &&
      e.status === "waiting" &&
      new Date(e.createdAt).getTime() < new Date(entry.createdAt).getTime(),
  );
  return { entry, position: ahead.length + 1 };
}

export async function joinWaitlist(input: {
  activity: Activity;
  name: string;
  phone: string;
  smsOptIn: boolean;
}): Promise<WaitlistEntry> {
  return withStoreLock(async () => {
    const entries = await readAllUnsafe();
    const normalizedPhone = normalizePhone(input.phone);

    const duplicate = entries.find(
      (e) =>
        e.activity === input.activity &&
        e.phone === normalizedPhone &&
        (e.status === "waiting" || e.status === "notified"),
    );
    if (duplicate) {
      throw new Error("ALREADY_ON_WAITLIST");
    }

    const entry: WaitlistEntry = {
      id: randomUUID(),
      activity: input.activity,
      name: input.name.trim(),
      phone: normalizedPhone,
      smsOptIn: input.smsOptIn,
      status: "waiting",
      createdAt: new Date().toISOString(),
    };

    entries.push(entry);
    await writeAllUnsafe(entries);
    return entry;
  });
}

export async function updateStatus(
  id: string,
  status: WaitlistStatus,
): Promise<WaitlistEntry | null> {
  return withStoreLock(async () => {
    const entries = await readAllUnsafe();
    const idx = entries.findIndex((e) => e.id === id);
    if (idx === -1) return null;

    entries[idx] = {
      ...entries[idx],
      status,
      ...(status === "notified"
        ? { notifiedAt: new Date().toISOString() }
        : {}),
    };
    await writeAllUnsafe(entries);
    return entries[idx];
  });
}

export async function cancelActiveEntriesForPhone(phone: string): Promise<number> {
  return withStoreLock(async () => {
    const normalized = normalizePhone(phone);
    const entries = await readAllUnsafe();
    let count = 0;
    for (let i = 0; i < entries.length; i++) {
      if (
        entries[i].phone === normalized &&
        (entries[i].status === "waiting" || entries[i].status === "notified")
      ) {
        entries[i] = { ...entries[i], status: "cancelled" };
        count++;
      }
    }
    if (count > 0) await writeAllUnsafe(entries);
    return count;
  });
}

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (phone.startsWith("+")) return phone;
  if (digits.length >= 10) return `+${digits}`;
  throw new Error("INVALID_PHONE");
}
