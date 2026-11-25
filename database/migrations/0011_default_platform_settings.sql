-- Up Migration
-- Initial operational policy. Every value is admin-configurable at runtime
-- (changes are audited). Matching weights are initial configurable weights,
-- not scientifically validated ones.
INSERT INTO platform_settings (key, value, description) VALUES
  ('matching.weights', '{"distance":20,"food_requirement":20,"quantity_capacity":15,"food_preference":10,"urgency":15,"pickup_availability":10,"reliability":5,"beneficiary_demand":5}',
     'Weighted ranking criteria (must sum to 100)'),
  ('matching.max_radius_km', '25', 'Upper bound for candidate search radius (km)'),
  ('matching.max_notified', '10', 'Maximum candidates notified per matching run'),
  ('matching.min_lead_minutes', '30', 'Reservations close this many minutes before the pickup deadline'),
  ('pickup.qr_ttl_minutes', '30', 'Lifetime of a pickup QR pass'),
  ('otp.policy', '{"ttl_minutes":10,"max_attempts":5,"max_sends":3,"resend_cooldown_seconds":60}', 'Pickup OTP policy'),
  ('tracking.stale_after_seconds', '60', 'A position older than this is shown as stale'),
  ('billing.tax', '{"enabled":false,"name":"GST","rate_percent":18}',
     'Tax applied on top of the base service fee. Disabled until legally applicable; production tax treatment requires professional validation.'),
  ('billing.invoice_due_days', '15', 'Invoice payment term in days'),
  ('assistant.max_steps', '5', 'Maximum LLM steps per assistant turn');

-- Down Migration
DELETE FROM platform_settings WHERE key IN (
  'matching.weights', 'matching.max_radius_km', 'matching.max_notified', 'matching.min_lead_minutes',
  'pickup.qr_ttl_minutes', 'otp.policy', 'tracking.stale_after_seconds', 'billing.tax',
  'billing.invoice_due_days', 'assistant.max_steps');
