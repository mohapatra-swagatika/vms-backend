-- Visitor status is approval workflow only: pending, approved, rejected.
-- Check-in/out are tracked via checked_in_at / checked_out_at, not status.

UPDATE visitors SET status = 'approved' WHERE status IN ('checked_in', 'checked_out');
UPDATE visitors SET status = 'rejected' WHERE status = 'cancelled';

ALTER TABLE visitors DROP CONSTRAINT IF EXISTS visitors_status_check;

ALTER TABLE visitors ADD CONSTRAINT visitors_status_check CHECK (status IN (
  'pending', 'approved', 'rejected'
));
