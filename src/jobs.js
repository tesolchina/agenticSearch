// In-memory job runner with progress stages. Jobs are polled by the UI:
//   POST endpoints create a job -> { jobId }
//   GET /api/jobs/:id -> { id, kind, status, stage, stages[], result, error }
const jobs = new Map();
const JOB_TTL_MS = 60 * 60 * 1000;

export function createJob(kind, stages, fn) {
  const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const job = {
    id,
    kind,
    status: "running",
    stage: stages[0] || "working",
    stages: stages.map((name) => ({ name, status: "pending" })),
    result: null,
    error: null,
    createdAt: Date.now(),
  };
  jobs.set(id, job);

  // cleanup old jobs
  for (const [k, j] of jobs) {
    if (Date.now() - j.createdAt > JOB_TTL_MS) jobs.delete(k);
  }

  (async () => {
    const setStage = (name) => {
      const idx = job.stages.findIndex((s) => s.name === name);
      if (idx >= 0) {
        for (let i = 0; i < idx; i++) if (job.stages[i].status === "pending") job.stages[i].status = "done";
        job.stages[idx].status = "running";
        job.stage = name;
      }
    };
    try {
      const result = await fn(setStage);
      for (const s of job.stages) s.status = "done";
      job.status = "success";
      job.result = result;
    } catch (e) {
      job.status = "failed";
      job.error = String(e.message || e);
    }
  })();

  return job;
}

export function getJob(id) {
  const j = jobs.get(id);
  if (!j) return null;
  const { id: _i, ...rest } = j;
  return rest;
}
