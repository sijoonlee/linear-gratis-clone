CREATE OR REPLACE FUNCTION notify_cron_task_pending()
RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'pending' THEN
    PERFORM pg_notify('cron_task_pending', json_build_object(
      'id', NEW.id,
      'schedule_id', NEW.schedule_id
    )::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cron_task_pending_trigger
AFTER INSERT ON cron_tasks
FOR EACH ROW EXECUTE FUNCTION notify_cron_task_pending();
