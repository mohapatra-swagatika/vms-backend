-- Admin notification config for towers and organizations (same JSONB shape as companies/locations).
ALTER TABLE towers
  ADD COLUMN IF NOT EXISTS notify_channels JSONB DEFAULT '{"whatsapp":true,"email":true,"call":false,"push":true,"notify_gate":false,"notify_front_desk":true,"notify_admin":true,"gate_user_ids":[],"front_desk_user_ids":[],"request_timeout_minutes":15}'::jsonb;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS notify_channels JSONB DEFAULT '{"whatsapp":true,"email":true,"call":false,"push":true,"notify_gate":false,"notify_front_desk":true,"notify_admin":true,"gate_user_ids":[],"front_desk_user_ids":[],"request_timeout_minutes":15}'::jsonb;
