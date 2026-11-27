-- Separate AI credits from traditional Hafez credits.
-- Existing traditional RPCs remain untouched.

ALTER TABLE public.profile
  ADD COLUMN IF NOT EXISTS ai_free_remaining integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS remained_ai integer NOT NULL DEFAULT 0;

ALTER TABLE public.profile
  ALTER COLUMN free_remaining SET DEFAULT 3;

-- This project currently has one user; align the existing profile with the
-- confirmed launch allowances. Purchased balances are preserved.
UPDATE public.profile
SET free_remaining = 3,
    ai_free_remaining = 2;

CREATE OR REPLACE FUNCTION public.consume_ai_credit(p_tgid bigint)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  p record;
BEGIN
  SELECT * INTO p
  FROM public.profile
  WHERE tgid = p_tgid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'reason', 'no_profile');
  END IF;

  IF COALESCE(p.remained_ai, 0) > 0 THEN
    UPDATE public.profile
    SET remained_ai = remained_ai - 1,
        last_visit = now()
    WHERE tgid = p_tgid
    RETURNING * INTO p;
  ELSIF COALESCE(p.ai_free_remaining, 0) > 0 THEN
    UPDATE public.profile
    SET ai_free_remaining = ai_free_remaining - 1,
        last_visit = now()
    WHERE tgid = p_tgid
    RETURNING * INTO p;
  ELSE
    RETURN json_build_object(
      'ok', false,
      'reason', 'no_credit',
      'profile', row_to_json(p)
    );
  END IF;

  RETURN json_build_object('ok', true, 'profile', row_to_json(p));
END;
$function$;

CREATE OR REPLACE FUNCTION public.process_paid_ai_payment(p_invoice_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_payment record;
  v_grant integer;
  v_updated integer;
BEGIN
  SELECT *
  INTO v_payment
  FROM public.payment
  WHERE invoice_id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_invoice');
  END IF;

  IF v_payment.status = 'PAID' THEN
    RETURN jsonb_build_object('ok', true, 'already_paid', true, 'granted', 0);
  END IF;

  IF v_payment.status <> 'PENDING' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_payment_status');
  END IF;

  v_grant := CASE v_payment.package_id
    WHEN 'ai_1' THEN 1
    WHEN 'ai_5' THEN 5
    WHEN 'ai_10' THEN 10
    ELSE NULL
  END;

  IF v_grant IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_ai_package');
  END IF;

  UPDATE public.profile
  SET remained_ai = COALESCE(remained_ai, 0) + v_grant
  WHERE tgid = v_payment.tgid;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RAISE EXCEPTION 'Profile not found for tgid %', v_payment.tgid;
  END IF;

  UPDATE public.payment
  SET status = 'PAID', paid_at = NOW()
  WHERE invoice_id = p_invoice_id;

  RETURN jsonb_build_object('ok', true, 'already_paid', false, 'granted', v_grant);
END;
$function$;

REVOKE ALL ON FUNCTION public.consume_ai_credit(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_paid_ai_payment(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_ai_credit(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.process_paid_ai_payment(bigint) TO service_role;
