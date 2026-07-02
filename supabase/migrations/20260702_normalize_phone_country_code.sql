-- Normalize all stored phone numbers to a single canonical form: "+967" + 9-digit local.
--
-- Background: the app is the single source of truth for the "+967" country code — numbers
-- are meant to be stored WITH the prefix (via the client's e164() helper) and rendered
-- as-is. Some rows drifted out of that shape:
--   * profiles rows stored the number without the leading "+" ("967XXXXXXXXX").
--   * a stray attempt log even doubled the country code ("+967967XXXXXXXXX").
-- This left the UI unsure whether to prepend "+967", which is what produced the
-- "+967 +967 XXXXXXXXX" duplication on the account page.
--
-- Canonicalization: strip every non-digit, take the last 9 digits (the Yemen mobile
-- local part), and re-prefix a single "+967". This is idempotent for already-correct
-- rows (they equal their normalized form and are skipped) and collapses any duplicated
-- country code. Rows with fewer than 9 digits are left untouched to avoid corrupting
-- unexpected data.

UPDATE profiles
   SET phone = '+967' || right(regexp_replace(phone, '\D', '', 'g'), 9)
 WHERE phone IS NOT NULL
   AND length(regexp_replace(phone, '\D', '', 'g')) >= 9
   AND phone <> '+967' || right(regexp_replace(phone, '\D', '', 'g'), 9);

UPDATE customers
   SET phone = '+967' || right(regexp_replace(phone, '\D', '', 'g'), 9)
 WHERE phone IS NOT NULL
   AND length(regexp_replace(phone, '\D', '', 'g')) >= 9
   AND phone <> '+967' || right(regexp_replace(phone, '\D', '', 'g'), 9);

UPDATE farmers
   SET phone = '+967' || right(regexp_replace(phone, '\D', '', 'g'), 9)
 WHERE phone IS NOT NULL
   AND length(regexp_replace(phone, '\D', '', 'g')) >= 9
   AND phone <> '+967' || right(regexp_replace(phone, '\D', '', 'g'), 9);

UPDATE retail_stores
   SET phone = '+967' || right(regexp_replace(phone, '\D', '', 'g'), 9)
 WHERE phone IS NOT NULL
   AND length(regexp_replace(phone, '\D', '', 'g')) >= 9
   AND phone <> '+967' || right(regexp_replace(phone, '\D', '', 'g'), 9);

UPDATE wholesale_stores
   SET phone = '+967' || right(regexp_replace(phone, '\D', '', 'g'), 9)
 WHERE phone IS NOT NULL
   AND length(regexp_replace(phone, '\D', '', 'g')) >= 9
   AND phone <> '+967' || right(regexp_replace(phone, '\D', '', 'g'), 9);

UPDATE vendor_verifications
   SET phone = '+967' || right(regexp_replace(phone, '\D', '', 'g'), 9)
 WHERE phone IS NOT NULL
   AND length(regexp_replace(phone, '\D', '', 'g')) >= 9
   AND phone <> '+967' || right(regexp_replace(phone, '\D', '', 'g'), 9);

UPDATE vendor_authorizations
   SET phone = '+967' || right(regexp_replace(phone, '\D', '', 'g'), 9)
 WHERE phone IS NOT NULL
   AND length(regexp_replace(phone, '\D', '', 'g')) >= 9
   AND phone <> '+967' || right(regexp_replace(phone, '\D', '', 'g'), 9);

UPDATE reports
   SET reporter_phone = '+967' || right(regexp_replace(reporter_phone, '\D', '', 'g'), 9)
 WHERE reporter_phone IS NOT NULL
   AND length(regexp_replace(reporter_phone, '\D', '', 'g')) >= 9
   AND reporter_phone <> '+967' || right(regexp_replace(reporter_phone, '\D', '', 'g'), 9);

UPDATE deletion_requests
   SET phone = '+967' || right(regexp_replace(phone, '\D', '', 'g'), 9)
 WHERE phone IS NOT NULL
   AND length(regexp_replace(phone, '\D', '', 'g')) >= 9
   AND phone <> '+967' || right(regexp_replace(phone, '\D', '', 'g'), 9);
