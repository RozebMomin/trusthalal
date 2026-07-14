"""The worker — polls the local queue and runs claimed jobs.

Single-process poll loop. FOR UPDATE SKIP LOCKED in claim_one means you can
scale to N worker containers later without double-processing.
"""
from __future__ import annotations

import time
import traceback

from ops import jobsdb
from ops.runners import JOB_KINDS

POLL_SECONDS = 2.0


def run_forever() -> None:
    jobsdb.init_schema()
    orphaned = jobsdb.fail_orphaned()
    if orphaned:
        print(f"[worker] marked {orphaned} orphaned running job(s) as failed", flush=True)
    print("[worker] up — polling for jobs", flush=True)
    while True:
        job = jobsdb.claim_one()
        if job is None:
            time.sleep(POLL_SECONDS)
            continue

        job_id = str(job["id"])
        kind = job["kind"]
        params = job["params"] or {}
        print(f"[worker] claimed {job_id} kind={kind}", flush=True)

        runner = JOB_KINDS.get(kind)
        if runner is None:
            jobsdb.finish(job_id, "failed", error=f"unknown job kind: {kind}")
            print(f"[worker] {job_id} unknown kind {kind}", flush=True)
            continue

        try:
            result = runner(job_id, params)
            jobsdb.finish(job_id, "succeeded", result=result)
            print(f"[worker] {job_id} succeeded", flush=True)
        except Exception as exc:
            tb = traceback.format_exc()
            print(f"[worker] {job_id} FAILED: {exc}", flush=True)
            print(tb, flush=True)
            # Mark the job failed FIRST so it never gets stuck in 'running'.
            # Logging is best-effort — a logging failure must not crash the worker.
            try:
                jobsdb.finish(job_id, "failed", error=str(exc))
            except Exception as fin_exc:
                print(f"[worker] could not mark {job_id} failed: {fin_exc}", flush=True)
            try:
                jobsdb.add_log(job_id, tb)
            except Exception as log_exc:
                print(f"[worker] could not write logs for {job_id}: {log_exc}", flush=True)


if __name__ == "__main__":
    run_forever()
