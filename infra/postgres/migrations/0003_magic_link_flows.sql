BEGIN;

ALTER TABLE verification_tokens
  ADD COLUMN return_to text NOT NULL DEFAULT '/panel',
  ADD COLUMN requested_display_name text,
  ADD COLUMN consent_version text,
  ADD COLUMN delivery_status text NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending', 'sent', 'failed')),
  ADD COLUMN delivered_at timestamptz,
  ADD COLUMN delivery_failed_at timestamptz,
  ADD CONSTRAINT verification_tokens_return_path
    CHECK (
      char_length(return_to) BETWEEN 1 AND 2048
      AND left(return_to, 1) = '/'
      AND left(return_to, 2) <> '//'
      AND position(E'\\' in return_to) = 0
    ),
  ADD CONSTRAINT verification_tokens_display_name_length
    CHECK (requested_display_name IS NULL OR char_length(requested_display_name) BETWEEN 2 AND 60),
  ADD CONSTRAINT verification_tokens_registration_fields
    CHECK (
      purpose = 'verify_email'
      OR (requested_display_name IS NULL AND consent_version IS NULL)
    );

CREATE INDEX verification_tokens_delivery_idx
  ON verification_tokens (delivery_status, created_at)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

COMMIT;
