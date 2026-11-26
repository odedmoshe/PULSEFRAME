/**
 * The real MadeRunner (made/contract.ts) of «קליפ מקוד» (wave 8 motioncode, W1): the routes (W2) call it after their scope, project
 * and body checks. It adds the job rules the runner owns: the job must be a made render of THAT project (404 made_job_not_found
 * otherwise), and a job's report, stills, file and dismissal belong to the owner's session and to the credential that submitted it
 * (403 not_your_job for another agent; in open mode every stamped agent acts as the owner, ADR-0036). Applying is open (decision 2): any credential that may edit applies, committed as itself.
 */
import fs from 'node:fs';
import { MADE_JOB_TYPE, type MadeApplyRequest, type MadeRenderRequest } from '@pulseframe/core';
import type { Principal } from '../governance.ts';
import { ApiError, type JobRow, type Store } from '../store.ts';
import { actsAsOwner } from '../autonomy.ts';
import { madeError, type MadeRunner } from './contract.ts';
import { MadeJobs } from './job.ts';
import { MADE_TEMPLATES } from './templates/index.ts';

export interface MadeRuntime extends MadeRunner {
  jobs: MadeJobs;
  /** the generic cancel (REST /jobs/:id/cancel and MCP cancel_job) for a made.render job */
  cancel(jobId: string, actor: string): { jobId: string; status: string; outcome: string };
  recover(): number;
  stop(): Promise<void>;
}

export function createMadeRunner(store: Store, jobs: MadeJobs): MadeRuntime {
  const jobOf = (projectId: string, jobId: string): JobRow => {
    let j: JobRow;
    try { j = store.getJob(jobId); } catch { throw madeError('jobNotFound', { jobId }); }
    if (j.type !== MADE_JOB_TYPE || j.projectId !== projectId) throw madeError('jobNotFound', { jobId });
    return j;
  };
  const mayRead = (p: Principal, j: JobRow) => {
    if (actsAsOwner(p) || p.actor === j.actor) return; // decision 5 (ADR-0036): the owner, every open agent, or the submitter
    throw new ApiError(403, 'not_your_job', 'a render\'s report, pictures and file belong to the owner and to the credential that started it', { jobId: j.id, startedBy: j.actor }, 'Read only renders this credential started, or ask the owner.');
  };
  const finished = (j: JobRow) => { if (j.status !== 'succeeded' || !j.output?.fileSha256) throw madeError('jobNotDone', { jobId: j.id, status: j.status }); };
  return {
    jobs,
    async start(p: Principal, projectId: string, req: MadeRenderRequest, page) {
      const t = page.templateId ? MADE_TEMPLATES.find((x) => x.id === page.templateId) : undefined;
      return jobs.start(p, projectId, req, { ...page, ...(t ? { fields: t.fields } : {}) });
    },
    report(p, projectId, jobId) { const j = jobOf(projectId, jobId); mayRead(p, j); return jobs.report(j); },
    still(p, projectId, jobId, index) {
      const j = jobOf(projectId, jobId); mayRead(p, j); finished(j);
      return { png: fs.readFileSync(store.blobPath(j.output.stills[index])) };
    },
    file(p, projectId, jobId) {
      const j = jobOf(projectId, jobId); mayRead(p, j); finished(j);
      const path = store.blobPath(j.output.fileSha256);
      return { path, bytes: fs.statSync(path).size };
    },
    async apply(p: Principal, projectId: string, jobId: string, req: MadeApplyRequest) { return jobs.apply(p, jobOf(projectId, jobId), req); },
    dismiss(p, projectId, jobId) { const j = jobOf(projectId, jobId); mayRead(p, j); jobs.dismiss(j.id, p.actor); },
    cancel: (jobId, actor) => jobs.cancel(jobId, actor),
    recover: () => jobs.recover(),
    stop: () => jobs.stop(),
  };
}
