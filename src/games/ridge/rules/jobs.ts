/**
 * The stages: each a short job with an objective. The first five teach the
 * rifle a lesson at a time (range and drop, leading a moving man, a timed
 * stop, being hunted, the wind at long range); from the sixth the jobs come
 * round again, harder and mixed - more men, gustier wind, less mist,
 * faster targets, a counter-sniper watching, and mortars once the valley is
 * alerted.
 */
import type { Difficulty } from "../../../engine/types";
import { CONVOY_TIME, DIFFICULTY, OFFICER_INSPECT } from "./tuning";

export type Job = "sentries" | "patrol" | "convoy" | "sniper" | "officer";

export const JOBS: readonly Job[] = ["sentries", "patrol", "convoy", "sniper", "officer"];

/** The title card's name and its line on the job. */
export const JOB_WORDS: Readonly<Record<Job, { name: string; line: string }>> = {
  sentries: { name: "Sentries", line: "Three sentries at the checkpoint. Take them quietly." },
  patrol: { name: "Patrol", line: "A patrol on the river road. Lead them as they walk." },
  convoy: { name: "Convoy", line: "Stop the lead truck before it crosses the bridge." },
  sniper: { name: "Counter-Sniper", line: "A sniper is watching the ridge. Find his glint first." },
  officer: { name: "The Officer", line: "Take the officer before he reaches the tunnel." },
};

export interface StageSpec {
  stage: number;
  job: Job;
  /** 0 the first time the jobs come round, 1 the second... */
  round: number;
  /** Men for the job itself (sentries, the patrol, each truck's load, the officer's guards). */
  men: number;
  /** A counter-sniper watching the ridge as well (the mixed stages). */
  sniper: boolean;
  /** A mortar team that fires once the valley is alerted. */
  mortars: boolean;
  /** Everyone who walks or drives does so this much faster. */
  pace: number;
  /** The convoy's time to the bridge, or the officer's to his jeep, seconds (the difficulty's own). */
  time: number;
  /** How thick the morning mist lies over the river at the stage's start, 0..1. */
  mist: number;
  /** Who else is in the valley. */
  farmer: boolean;
  cyclist: boolean;
  shepherd: boolean;
  children: boolean;
}

export function jobFor(stage: number): Job {
  return JOBS[(Math.max(1, Math.floor(stage)) - 1) % JOBS.length] as Job;
}

export function stageSpec(stage: number, difficulty: Difficulty = "standard"): StageSpec {
  const s = Math.max(1, Math.floor(stage));
  const job = jobFor(s);
  const round = Math.floor((s - 1) / JOBS.length);
  const tune = DIFFICULTY[difficulty];
  const baseMen: Record<Job, number> = { sentries: 3, patrol: 4, convoy: 2, sniper: 1, officer: 2 };
  const men = baseMen[job] + (job === "sniper" ? 0 : round * (job === "convoy" ? 1 : 2));
  const pace = 1 + Math.min(0.45, round * 0.15);
  const baseTime = job === "convoy" ? CONVOY_TIME : job === "officer" ? OFFICER_INSPECT : 0;
  // Later rounds give the clock a little less time, never under two thirds.
  const time = baseTime * tune.timeFactor * Math.max(0.67, 1 - round * 0.12);
  return {
    stage: s,
    job,
    round,
    men,
    sniper: round >= 1 && job !== "sniper",
    mortars: s >= 6,
    pace,
    time,
    mist: Math.max(0.25, 1 - (s - 1) * 0.12),
    farmer: true,
    cyclist: job === "patrol" || job === "convoy" || round >= 1,
    shepherd: job === "sniper" || job === "officer" || round >= 1,
    children: job === "sniper",
  };
}

/** "Stage 3 — Convoy" */
export function stageTitle(stage: number): string {
  return `Stage ${stage} — ${JOB_WORDS[jobFor(stage)].name}`;
}
