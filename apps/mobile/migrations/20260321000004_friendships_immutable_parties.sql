-- Task #646 (Immutable Parties): Prevent requester_id/addressee_id from being
-- mutated after a friendship row is created.
--
-- Because RLS WITH CHECK can only validate the *new* row, a BEFORE UPDATE
-- trigger is needed to raise an error if either party column changes.

CREATE OR REPLACE FUNCTION public.enforce_friendships_parties_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.requester_id IS DISTINCT FROM OLD.requester_id
     OR NEW.addressee_id IS DISTINCT FROM OLD.addressee_id THEN
    RAISE EXCEPTION 'requester_id and addressee_id are immutable once created';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS friendships_parties_immutable ON public.friendships;

CREATE TRIGGER friendships_parties_immutable
  BEFORE UPDATE ON public.friendships
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_friendships_parties_immutable();
