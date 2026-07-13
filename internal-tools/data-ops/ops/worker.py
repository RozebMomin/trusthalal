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
            jobsdb.add_log(job_id, tb)
            jobsdb.finish(job_id, "failed", error=str(exc))
            print(f"[worker] {job_id} FAILED: {exc}", flush=True)


if __name__ == "__main__":
    run_forever()
