CREATE OR REPLACE FUNCTION prevent_attendance_event_mutation()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'AttendanceEvent rows are immutable';
  END IF;

  IF (to_jsonb(NEW) - ARRAY['latitude', 'longitude', 'accuracyMeters'])
    IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['latitude', 'longitude', 'accuracyMeters'])
  THEN
    RAISE EXCEPTION 'AttendanceEvent facts are immutable';
  END IF;

  IF (NEW."latitude" IS DISTINCT FROM OLD."latitude" AND NEW."latitude" IS NOT NULL)
    OR (NEW."longitude" IS DISTINCT FROM OLD."longitude" AND NEW."longitude" IS NOT NULL)
    OR (NEW."accuracyMeters" IS DISTINCT FROM OLD."accuracyMeters" AND NEW."accuracyMeters" IS NOT NULL)
  THEN
    RAISE EXCEPTION 'AttendanceEvent GPS data may only be redacted';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AttendanceEvent_immutable_update"
BEFORE UPDATE ON "AttendanceEvent"
FOR EACH ROW EXECUTE FUNCTION prevent_attendance_event_mutation();

CREATE TRIGGER "AttendanceEvent_immutable_delete"
BEFORE DELETE ON "AttendanceEvent"
FOR EACH ROW EXECUTE FUNCTION prevent_attendance_event_mutation();
