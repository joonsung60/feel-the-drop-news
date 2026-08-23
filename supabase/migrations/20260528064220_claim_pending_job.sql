CREATE OR REPLACE FUNCTION claim_pending_job()
RETURNS SETOF job_queue
LANGUAGE sql
AS $$
  UPDATE job_queue
  SET status = 'processing', updated_at = now()
  WHERE id = (
    SELECT id FROM job_queue
    WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;
