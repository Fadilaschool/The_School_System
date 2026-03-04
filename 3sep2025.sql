--
-- PostgreSQL database dump
--

-- Dumped from database version 17.5
-- Dumped by pg_dump version 17.5

-- Started on 2026-02-17 12:55:55

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- TOC entry 6 (class 2615 OID 2200)
-- Name: public; Type: SCHEMA; Schema: -; Owner: pg_database_owner
--

CREATE SCHEMA public;


ALTER SCHEMA public OWNER TO pg_database_owner;

--
-- TOC entry 6072 (class 0 OID 0)
-- Dependencies: 6
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: pg_database_owner
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- TOC entry 369 (class 1255 OID 156003)
-- Name: can_validate_month(integer, integer, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.can_validate_month(p_year integer, p_month integer, p_department_id uuid DEFAULT NULL::uuid) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE
    employee_rec RECORD;
    pending_count INTEGER;
BEGIN
    -- Check each employee for pending cases
    FOR employee_rec IN 
        SELECT e.id 
        FROM employees e
        WHERE (p_department_id IS NULL OR e.department_id = p_department_id)
    LOOP
        pending_count := get_employee_pending_count(employee_rec.id, p_year, p_month);
        IF pending_count > 0 THEN
            RETURN FALSE;
        END IF;
    END LOOP;
    
    RETURN TRUE;
END;
$$;


ALTER FUNCTION public.can_validate_month(p_year integer, p_month integer, p_department_id uuid) OWNER TO postgres;

--
-- TOC entry 6073 (class 0 OID 0)
-- Dependencies: 369
-- Name: FUNCTION can_validate_month(p_year integer, p_month integer, p_department_id uuid); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.can_validate_month(p_year integer, p_month integer, p_department_id uuid) IS 'Checks if month validation is allowed (returns false if any pending cases exist)';


--
-- TOC entry 302 (class 1255 OID 190142)
-- Name: check_task_completion(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.check_task_completion() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ DECLARE not_completed_count INTEGER; BEGIN IF NEW.status = 'Completed' THEN SELECT COUNT(*) INTO not_completed_count FROM public.task_assignments WHERE task_id = NEW.id AND status <> 'Completed'; IF not_completed_count > 0 THEN RAISE EXCEPTION 'Impossible de marquer la tâche % comme Completed : certains employés n''ont pas encore terminé.', NEW.id; END IF; END IF; RETURN NEW; END; $$;


ALTER FUNCTION public.check_task_completion() OWNER TO postgres;

--
-- TOC entry 318 (class 1255 OID 107221)
-- Name: extract_month_from_timestamp_immutable(timestamp with time zone); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.extract_month_from_timestamp_immutable(ts_val timestamp with time zone) RETURNS integer
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN
    RETURN EXTRACT(MONTH FROM ts_val)::integer;
END;
$$;


ALTER FUNCTION public.extract_month_from_timestamp_immutable(ts_val timestamp with time zone) OWNER TO postgres;

--
-- TOC entry 315 (class 1255 OID 107219)
-- Name: extract_month_immutable(date); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.extract_month_immutable(date_val date) RETURNS integer
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN
    RETURN EXTRACT(MONTH FROM date_val)::integer;
END;
$$;


ALTER FUNCTION public.extract_month_immutable(date_val date) OWNER TO postgres;

--
-- TOC entry 332 (class 1255 OID 107222)
-- Name: extract_year_from_timestamp_immutable(timestamp with time zone); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.extract_year_from_timestamp_immutable(ts_val timestamp with time zone) RETURNS integer
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN
    RETURN EXTRACT(YEAR FROM ts_val)::integer;
END;
$$;


ALTER FUNCTION public.extract_year_from_timestamp_immutable(ts_val timestamp with time zone) OWNER TO postgres;

--
-- TOC entry 335 (class 1255 OID 107220)
-- Name: extract_year_immutable(date); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.extract_year_immutable(date_val date) RETURNS integer
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN
    RETURN EXTRACT(YEAR FROM date_val)::integer;
END;
$$;


ALTER FUNCTION public.extract_year_immutable(date_val date) OWNER TO postgres;

--
-- TOC entry 366 (class 1255 OID 106741)
-- Name: get_employee_name_match_condition(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_employee_name_match_condition() RETURNS text
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN '(
        LOWER(TRIM(REPLACE(rp.employee_name, '' '', ''''))) = LOWER(TRIM(REPLACE(e.first_name || '' '' || e.last_name, '' '', ''''))) OR
        LOWER(TRIM(REPLACE(rp.employee_name, '' '', ''''))) = LOWER(TRIM(REPLACE(e.last_name || '' '' || e.first_name, '' '', ''''))) OR
        LOWER(TRIM(REPLACE(rp.employee_name, '' '', ''''))) = LOWER(TRIM(REPLACE(e.first_name || e.last_name, '' '', ''''))) OR
        LOWER(TRIM(REPLACE(rp.employee_name, '' '', ''''))) = LOWER(TRIM(REPLACE(e.last_name || e.first_name, '' '', '''')))
    )';
END;
$$;


ALTER FUNCTION public.get_employee_name_match_condition() OWNER TO postgres;

--
-- TOC entry 367 (class 1255 OID 156002)
-- Name: get_employee_pending_count(uuid, integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_employee_pending_count(p_employee_id uuid, p_year integer, p_month integer) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    pending_count INTEGER := 0;
    rec RECORD;
BEGIN
    -- Count days where employee has exactly 1 punch and no pending treatment
    FOR rec IN 
        SELECT DATE(rp.punch_time) as punch_date, COUNT(*) as punch_count
        FROM raw_punches rp
        JOIN employees e ON e.id = p_employee_id
        WHERE (
            -- Simple name matching (case insensitive)
            UPPER(REPLACE(rp.employee_name, ' ', '')) = UPPER(REPLACE(e.first_name || ' ' || e.last_name, ' ', '')) OR
            UPPER(REPLACE(rp.employee_name, ' ', '')) = UPPER(REPLACE(e.last_name || ' ' || e.first_name, ' ', ''))
        )
        AND EXTRACT(YEAR FROM rp.punch_time) = p_year
        AND EXTRACT(MONTH FROM rp.punch_time) = p_month
        GROUP BY DATE(rp.punch_time)
        HAVING COUNT(*) = 1
    LOOP
        -- Check if this date has been treated
        IF NOT EXISTS (
            SELECT 1 FROM attendance_overrides ao 
            WHERE ao.employee_id = p_employee_id 
            AND ao.date = rec.punch_date
            AND ao.pending_status IN ('full_day', 'half_day', 'refused')
        ) THEN
            pending_count := pending_count + 1;
        END IF;
    END LOOP;
    
    RETURN pending_count;
END;
$$;


ALTER FUNCTION public.get_employee_pending_count(p_employee_id uuid, p_year integer, p_month integer) OWNER TO postgres;

--
-- TOC entry 6074 (class 0 OID 0)
-- Dependencies: 367
-- Name: FUNCTION get_employee_pending_count(p_employee_id uuid, p_year integer, p_month integer); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.get_employee_pending_count(p_employee_id uuid, p_year integer, p_month integer) IS 'Returns count of pending partial cases for an employee in a specific month';


--
-- TOC entry 316 (class 1255 OID 172418)
-- Name: levels_compatible(character varying, character varying); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.levels_compatible(req_level character varying, cand_level character varying) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE
    WHEN req_level IS NULL OR cand_level IS NULL THEN false
    WHEN lower(req_level) = lower(cand_level) THEN true
    WHEN lower(req_level) IN ('preschool','primary') AND lower(cand_level) IN ('preschool','primary') THEN true
    ELSE false
  END;
$$;


ALTER FUNCTION public.levels_compatible(req_level character varying, cand_level character varying) OWNER TO postgres;

--
-- TOC entry 345 (class 1255 OID 172420)
-- Name: on_attendance_exception_status_change(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.on_attendance_exception_status_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status = 'Approved' AND OLD.status IS DISTINCT FROM NEW.status
     AND NEW.type IN ('LeaveRequest','HolidayAssignment') THEN
    PERFORM public.process_approved_leave_exception(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.on_attendance_exception_status_change() OWNER TO postgres;

--
-- TOC entry 323 (class 1255 OID 172419)
-- Name: process_approved_leave_exception(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.process_approved_leave_exception(p_exception_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  ex record;
  absent_emp record;
  d date;
  req_id uuid;
  req_minutes int;
  interval_rec record;
  cand record;
  cand_itv record;
  overlap_start time;
  overlap_end time;
  overlap_minutes int;
BEGIN
  SELECT * INTO ex FROM public.attendance_exceptions WHERE id = p_exception_id;
  IF ex IS NULL OR ex.status <> 'Approved' OR ex.type NOT IN ('LeaveRequest','HolidayAssignment') THEN
    RETURN;
  END IF;

  SELECT e.*, p.name AS position_name INTO absent_emp
  FROM public.employees e
  LEFT JOIN public.positions p ON p.id = e.position_id
  WHERE e.id = ex.employee_id;

  IF absent_emp.position_name IS NULL OR lower(absent_emp.position_name) <> 'teacher' THEN
    RETURN; -- only for teachers
  END IF;

  FOR d IN SELECT g::date FROM generate_series(ex.date, COALESCE(ex.end_date, ex.date), '1 day') AS g LOOP
    -- Determine absent windows via the employee timetable intervals for that weekday
    FOR interval_rec IN
      SELECT ti.start_time, ti.end_time
      FROM public.employee_timetables et
      JOIN public.timetable_intervals ti ON ti.timetable_id = et.timetable_id
      WHERE et.employee_id = ex.employee_id
        AND (et.effective_to IS NULL OR d BETWEEN et.effective_from AND et.effective_to)
        AND ti.weekday = EXTRACT(DOW FROM d)
    LOOP
      req_minutes := EXTRACT(EPOCH FROM (interval_rec.end_time - interval_rec.start_time))::int / 60;
      INSERT INTO public.substitution_requests(
        exception_id, absent_employee_id, institution, education_level,
        date, start_time, end_time, total_minutes, remaining_minutes, status
      ) VALUES (
        ex.id, ex.employee_id, COALESCE(absent_emp.institution, ''), absent_emp.education_level,
        d, interval_rec.start_time, interval_rec.end_time, req_minutes, req_minutes, 'open'
      ) RETURNING id INTO req_id;

      -- Find candidates: same institution, compatible level, teacher, with on_call slots overlapping
      FOR cand IN
        SELECT e2.id AS employee_id
        FROM public.employees e2
        JOIN public.positions p2 ON p2.id = e2.position_id
        WHERE lower(p2.name) = 'teacher'
          AND e2.id <> ex.employee_id
          AND COALESCE(e2.institution,'') = COALESCE(absent_emp.institution,'')
          AND public.levels_compatible(absent_emp.education_level, e2.education_level)
      LOOP
        FOR cand_itv IN
          SELECT ti2.start_time, ti2.end_time
          FROM public.employee_timetables et2
          JOIN public.timetable_intervals ti2 ON ti2.timetable_id = et2.timetable_id
          WHERE et2.employee_id = cand.employee_id
            AND (et2.effective_to IS NULL OR d BETWEEN et2.effective_from AND et2.effective_to)
            AND ti2.weekday = EXTRACT(DOW FROM d)
            AND ti2.on_call_flag = true
        LOOP
          -- overlap
          overlap_start := GREATEST(interval_rec.start_time, cand_itv.start_time);
          overlap_end   := LEAST(interval_rec.end_time,   cand_itv.end_time);
          IF overlap_end > overlap_start THEN
            overlap_minutes := EXTRACT(EPOCH FROM (overlap_end - overlap_start))::int / 60;
            INSERT INTO public.substitution_invitations(
              request_id, candidate_employee_id, date, start_time, end_time, minutes
            ) VALUES (
              req_id, cand.employee_id, d, overlap_start, overlap_end, overlap_minutes
            );
          END IF;
        END LOOP;
      END LOOP;
    END LOOP;
  END LOOP;
END;
$$;


ALTER FUNCTION public.process_approved_leave_exception(p_exception_id uuid) OWNER TO postgres;

--
-- TOC entry 344 (class 1255 OID 123211)
-- Name: recalculate_employee_monthly_data(uuid, integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.recalculate_employee_monthly_data(p_employee_id uuid, p_month integer, p_year integer) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
DECLARE
    result jsonb;
    settings_rec record;
BEGIN
    -- Get attendance settings
    SELECT * INTO settings_rec 
    FROM attendance_settings 
    WHERE scope = 'global' 
    ORDER BY created_at DESC 
    LIMIT 1;
    
    -- If no settings found, use defaults
    IF settings_rec IS NULL THEN
        settings_rec.grace_period_lateness_minutes := 15;
        settings_rec.grace_period_early_departure_minutes := 15;
        settings_rec.calculate_late_early_hours := true;
        settings_rec.auto_calculate_overtime := true;
        settings_rec.default_scheduled_work_hours := 8.0;
    END IF;
    
    -- Clear existing calculated data for this employee/month
    DELETE FROM attendance_calculations_cache 
    WHERE employee_id = p_employee_id 
    AND month = p_month 
    AND year = p_year;
    
    -- Clear validation status
    DELETE FROM employee_monthly_validations
    WHERE employee_id = p_employee_id 
    AND month = p_month 
    AND year = p_year;
    
    -- Delete from monthly summaries if exists
    DELETE FROM employee_monthly_summaries
    WHERE employee_id = p_employee_id 
    AND month = p_month 
    AND year = p_year;
    
    -- Return success
    result := jsonb_build_object(
        'success', true,
        'message', 'Employee monthly data recalculated successfully',
        'employee_id', p_employee_id,
        'month', p_month,
        'year', p_year,
        'settings_applied', row_to_json(settings_rec)
    );
    
    RETURN result;
END;
$$;


ALTER FUNCTION public.recalculate_employee_monthly_data(p_employee_id uuid, p_month integer, p_year integer) OWNER TO postgres;

--
-- TOC entry 6075 (class 0 OID 0)
-- Dependencies: 344
-- Name: FUNCTION recalculate_employee_monthly_data(p_employee_id uuid, p_month integer, p_year integer); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.recalculate_employee_monthly_data(p_employee_id uuid, p_month integer, p_year integer) IS 'Recalculates employee monthly attendance data from raw punches';


--
-- TOC entry 305 (class 1255 OID 172422)
-- Name: respond_to_invitation(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.respond_to_invitation(p_invitation_id uuid, p_actor_user_id uuid, p_action text) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
DECLARE inv record; req record; actor_emp uuid; updated_status text; new_remaining int; hours numeric(5,2);
BEGIN
  SELECT i.*, r.* AS req_row INTO inv
  FROM public.substitution_invitations i
  JOIN public.substitution_requests r ON r.id = i.request_id
  WHERE i.id = p_invitation_id;
  IF inv.id IS NULL THEN RETURN jsonb_build_object('success', false, 'message','Invitation not found'); END IF;

  SELECT e.id INTO actor_emp FROM public.employees e JOIN public.users u ON u.id = e.user_id WHERE u.id = p_actor_user_id;
  IF actor_emp IS NULL OR actor_emp <> inv.candidate_employee_id THEN
    RETURN jsonb_build_object('success', false, 'message','Unauthorized');
  END IF;

  IF p_action = 'accept' AND inv.status = 'pending' THEN
    UPDATE public.substitution_invitations SET status='accepted', responded_at=CURRENT_TIMESTAMP WHERE id = inv.id;
    -- mark overlapping invitations as occupied
    UPDATE public.substitution_invitations si
      SET status='occupied'
    WHERE si.request_id = inv.request_id AND si.id <> inv.id AND si.date = inv.date
      AND tstzrange(si.date + si.start_time, si.date + si.end_time, '[)') &&
          tstzrange(inv.date + inv.start_time, inv.date + inv.end_time, '[)')
      AND si.status IN ('pending');
    RETURN jsonb_build_object('success', true, 'message','Accepted');
  ELSIF p_action = 'deny' AND inv.status = 'pending' THEN
    UPDATE public.substitution_invitations SET status='declined', responded_at=CURRENT_TIMESTAMP WHERE id = inv.id;
    RETURN jsonb_build_object('success', true, 'message','Declined');
  ELSIF p_action = 'drop' AND inv.status = 'accepted' THEN
    UPDATE public.substitution_invitations SET status='dropped', responded_at=CURRENT_TIMESTAMP WHERE id = inv.id;
    -- reopen overlapping invitations
    UPDATE public.substitution_invitations si
      SET status='pending', responded_at=NULL
    WHERE si.request_id = inv.request_id AND si.date = inv.date
      AND tstzrange(si.date + si.start_time, si.date + si.end_time, '[)') &&
          tstzrange(inv.date + inv.start_time, inv.date + inv.end_time, '[)')
      AND si.status = 'occupied';
    RETURN jsonb_build_object('success', true, 'message','Dropped');
  ELSIF p_action = 'taught' AND inv.status = 'accepted' THEN
    -- write overtime hours and close
    hours := (inv.minutes::numeric / 60.0);
    INSERT INTO public.employee_overtime_hours(employee_id, date, hours, description)
    VALUES (inv.candidate_employee_id, inv.date, hours, 'Substitution for request '||inv.request_id);
    UPDATE public.substitution_invitations SET status='completed', responded_at=CURRENT_TIMESTAMP WHERE id = inv.id;
    -- reduce remaining
    UPDATE public.substitution_requests SET remaining_minutes = GREATEST(0, remaining_minutes - inv.minutes),
      status = CASE WHEN GREATEST(0, remaining_minutes - inv.minutes) = 0 THEN 'filled' ELSE 'partial' END
    WHERE id = inv.request_id;
    RETURN jsonb_build_object('success', true, 'message','Completed');
  ELSE
    RETURN jsonb_build_object('success', false, 'message','Invalid action or state');
  END IF;
END;$$;


ALTER FUNCTION public.respond_to_invitation(p_invitation_id uuid, p_actor_user_id uuid, p_action text) OWNER TO postgres;

--
-- TOC entry 312 (class 1255 OID 190143)
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.set_updated_at() OWNER TO postgres;

--
-- TOC entry 309 (class 1255 OID 190144)
-- Name: update_task_status_on_completion(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_task_status_on_completion() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN IF NOT EXISTS (SELECT 1 FROM public.task_assignments WHERE task_id = NEW.task_id AND status != 'Completed') THEN UPDATE public.tasks SET status = 'Completed', updated_at = CURRENT_TIMESTAMP WHERE id = NEW.task_id; END IF; RETURN NEW; END; $$;


ALTER FUNCTION public.update_task_status_on_completion() OWNER TO postgres;

--
-- TOC entry 349 (class 1255 OID 66171)
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_updated_at_column() OWNER TO postgres;

--
-- TOC entry 307 (class 1255 OID 123212)
-- Name: validate_employee_monthly_data(uuid, integer, integer, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.validate_employee_monthly_data(p_employee_id uuid, p_month integer, p_year integer, p_validated_by_user_id uuid) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
DECLARE
    result jsonb;
    stats_rec record;
BEGIN
    -- Get current statistics
    SELECT * INTO stats_rec
    FROM comprehensive_monthly_statistics 
    WHERE employee_id = p_employee_id 
    AND month = p_month 
    AND year = p_year;
    
    IF stats_rec IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'No data found for the specified employee and month'
        );
    END IF;
    
    -- Insert/update into employee_monthly_summaries
    INSERT INTO employee_monthly_summaries (
        employee_id, month, year, 
        total_worked_days, absence_days, 
        late_hours, early_departure_hours,
        total_overtime_hours, total_wage_changes,
        is_validated, validated_by_user_id, validated_at,
        calculation_method
    ) VALUES (
        p_employee_id, p_month, p_year,
        stats_rec.total_worked_days, stats_rec.absence_days,
        stats_rec.late_hours, stats_rec.early_departure_hours,
        stats_rec.overtime_hours, stats_rec.wage_changes,
        true, p_validated_by_user_id, CURRENT_TIMESTAMP,
        'validated'
    ) ON CONFLICT (employee_id, month, year) 
    DO UPDATE SET 
        total_worked_days = EXCLUDED.total_worked_days,
        absence_days = EXCLUDED.absence_days,
        late_hours = EXCLUDED.late_hours,
        early_departure_hours = EXCLUDED.early_departure_hours,
        total_overtime_hours = EXCLUDED.total_overtime_hours,
        total_wage_changes = EXCLUDED.total_wage_changes,
        is_validated = true,
        validated_by_user_id = p_validated_by_user_id,
        validated_at = CURRENT_TIMESTAMP,
        calculation_method = 'validated',
        updated_at = CURRENT_TIMESTAMP;
    
    -- Insert into validations table
    INSERT INTO employee_monthly_validations (
        employee_id, month, year, validated_by_user_id, validated_at
    ) VALUES (
        p_employee_id, p_month, p_year, p_validated_by_user_id, CURRENT_TIMESTAMP
    ) ON CONFLICT (employee_id, month, year) 
    DO UPDATE SET 
        validated_by_user_id = p_validated_by_user_id,
        validated_at = CURRENT_TIMESTAMP;
        
    -- Log audit trail
    INSERT INTO audit_logs (
        entity_type, entity_id, action, actor_user_id, data
    ) VALUES (
        'employee_monthly_validation', p_employee_id, 'validate_month', p_validated_by_user_id,
        jsonb_build_object(
            'month', p_month,
            'year', p_year,
            'validated_statistics', row_to_json(stats_rec)
        )
    );
    
    result := jsonb_build_object(
        'success', true,
        'message', 'Employee monthly data validated successfully',
        'employee_id', p_employee_id,
        'month', p_month,
        'year', p_year,
        'statistics', row_to_json(stats_rec)
    );
    
    RETURN result;
END;
$$;


ALTER FUNCTION public.validate_employee_monthly_data(p_employee_id uuid, p_month integer, p_year integer, p_validated_by_user_id uuid) OWNER TO postgres;

--
-- TOC entry 6076 (class 0 OID 0)
-- Dependencies: 307
-- Name: FUNCTION validate_employee_monthly_data(p_employee_id uuid, p_month integer, p_year integer, p_validated_by_user_id uuid); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.validate_employee_monthly_data(p_employee_id uuid, p_month integer, p_year integer, p_validated_by_user_id uuid) IS 'Validates and persists employee monthly attendance statistics';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 262 (class 1259 OID 190145)
-- Name: attendance; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.attendance (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    employee_id uuid,
    check_in_time timestamp without time zone NOT NULL,
    check_out_time timestamp without time zone,
    total_hours numeric(4,2),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    check_in timestamp without time zone,
    check_out timestamp without time zone
);


ALTER TABLE public.attendance OWNER TO postgres;

--
-- TOC entry 248 (class 1259 OID 123181)
-- Name: attendance_calculations_cache; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.attendance_calculations_cache (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    employee_id uuid NOT NULL,
    date date NOT NULL,
    month integer NOT NULL,
    year integer NOT NULL,
    raw_data jsonb NOT NULL,
    calculated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.attendance_calculations_cache OWNER TO postgres;

--
-- TOC entry 6077 (class 0 OID 0)
-- Dependencies: 248
-- Name: TABLE attendance_calculations_cache; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.attendance_calculations_cache IS 'Cache for real-time attendance calculations to improve performance';


--
-- TOC entry 232 (class 1259 OID 90376)
-- Name: attendance_exceptions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.attendance_exceptions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    employee_id uuid NOT NULL,
    type character varying(40) NOT NULL,
    status character varying(20) DEFAULT 'Pending'::character varying NOT NULL,
    date date NOT NULL,
    end_date date,
    payload jsonb NOT NULL,
    submitted_by_user_id uuid,
    reviewed_by_user_id uuid,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    document_upload_id uuid,
    document_url character varying(1000),
    CONSTRAINT attendance_exceptions_status_check CHECK (((status)::text = ANY ((ARRAY['Pending'::character varying, 'Approved'::character varying, 'Rejected'::character varying])::text[]))),
    CONSTRAINT attendance_exceptions_type_check CHECK (((type)::text = ANY (ARRAY[('MissingPunchFix'::character varying)::text, ('LeaveRequest'::character varying)::text, ('HolidayAssignment'::character varying)::text, ('DayEdit'::character varying)::text])))
);


ALTER TABLE public.attendance_exceptions OWNER TO postgres;

--
-- TOC entry 233 (class 1259 OID 90406)
-- Name: attendance_overrides; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.attendance_overrides (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    employee_id uuid NOT NULL,
    date date NOT NULL,
    override_type character varying(30) NOT NULL,
    details jsonb NOT NULL,
    exception_id uuid,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    pending_status character varying(20) DEFAULT NULL::character varying,
    CONSTRAINT attendance_overrides_override_type_check CHECK (((override_type)::text = ANY (ARRAY[('punch_add'::character varying)::text, ('punch_remove'::character varying)::text, ('status_override'::character varying)::text, ('leave'::character varying)::text, ('holiday'::character varying)::text, ('day_edit'::character varying)::text]))),
    CONSTRAINT chk_pending_status CHECK (((pending_status IS NULL) OR ((pending_status)::text = ANY ((ARRAY['pending'::character varying, 'full_day'::character varying, 'half_day'::character varying, 'refused'::character varying])::text[]))))
);


ALTER TABLE public.attendance_overrides OWNER TO postgres;

--
-- TOC entry 6078 (class 0 OID 0)
-- Dependencies: 233
-- Name: COLUMN attendance_overrides.pending_status; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.attendance_overrides.pending_status IS 'Status for partial attendance cases: pending, full_day, half_day, refused';


--
-- TOC entry 230 (class 1259 OID 90328)
-- Name: attendance_punches; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.attendance_punches (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    employee_id uuid NOT NULL,
    punch_time timestamp with time zone NOT NULL,
    source character varying(50) DEFAULT 'upload'::character varying,
    device_id character varying(100),
    upload_id uuid,
    raw_employee_name text,
    is_duplicate boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone
);


ALTER TABLE public.attendance_punches OWNER TO postgres;

--
-- TOC entry 231 (class 1259 OID 90351)
-- Name: attendance_settings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.attendance_settings (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    scope character varying(20) NOT NULL,
    department_id uuid,
    timezone character varying(100) DEFAULT 'UTC'::character varying,
    grace_minutes integer DEFAULT 0,
    rounding_minutes integer DEFAULT 0,
    min_shift_minutes integer DEFAULT 0,
    cross_midnight_boundary time without time zone DEFAULT '05:00:00'::time without time zone,
    valid_window_start time without time zone,
    valid_window_end time without time zone,
    weekend_days smallint[] DEFAULT ARRAY[6, 0],
    holidays date[] DEFAULT ARRAY[]::date[],
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    grace_period_lateness_minutes integer DEFAULT 0,
    grace_period_early_departure_minutes integer DEFAULT 0,
    default_scheduled_work_hours numeric(5,2) DEFAULT 8.0,
    auto_calculate_overtime boolean DEFAULT true,
    calculate_late_early_hours boolean DEFAULT true,
    bulk_validation_enabled boolean DEFAULT true,
    real_time_calculations boolean DEFAULT true,
    audit_trail_retention_days integer DEFAULT 365,
    CONSTRAINT attendance_settings_scope_check CHECK (((scope)::text = ANY ((ARRAY['global'::character varying, 'department'::character varying])::text[])))
);


ALTER TABLE public.attendance_settings OWNER TO postgres;

--
-- TOC entry 234 (class 1259 OID 90432)
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    entity_type character varying(100) NOT NULL,
    entity_id uuid,
    action character varying(50) NOT NULL,
    actor_user_id uuid,
    data jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.audit_logs OWNER TO postgres;

--
-- TOC entry 258 (class 1259 OID 164249)
-- Name: branch_levels; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.branch_levels (
    branch_id uuid NOT NULL,
    level_id uuid NOT NULL
);


ALTER TABLE public.branch_levels OWNER TO postgres;

--
-- TOC entry 257 (class 1259 OID 164237)
-- Name: branches; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.branches (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    website character varying(255),
    phone character varying(50),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    address text,
    wilaya character varying(100),
    registration_number character varying(100)
);


ALTER TABLE public.branches OWNER TO postgres;

--
-- TOC entry 6079 (class 0 OID 0)
-- Dependencies: 257
-- Name: COLUMN branches.address; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.branches.address IS 'Full address of the branch (e.g., "Cité BENADJEL (20 août) BOUDOUAOU")';


--
-- TOC entry 6080 (class 0 OID 0)
-- Dependencies: 257
-- Name: COLUMN branches.wilaya; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.branches.wilaya IS 'Wilaya (province) where the branch is located (e.g., "BOUMERDES")';


--
-- TOC entry 6081 (class 0 OID 0)
-- Dependencies: 257
-- Name: COLUMN branches.registration_number; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.branches.registration_number IS 'Registration number (N° Adhérent) of the branch (e.g., "35370248 57")';


--
-- TOC entry 277 (class 1259 OID 205191)
-- Name: complaint_attachments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.complaint_attachments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    complaint_id uuid NOT NULL,
    file_path text NOT NULL,
    file_name text,
    uploaded_by uuid,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.complaint_attachments OWNER TO postgres;

--
-- TOC entry 278 (class 1259 OID 205198)
-- Name: complaint_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.complaint_history (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    complaint_id uuid NOT NULL,
    changed_by uuid NOT NULL,
    old_status text,
    new_status text,
    comment text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.complaint_history OWNER TO postgres;

--
-- TOC entry 279 (class 1259 OID 205205)
-- Name: complaint_messages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.complaint_messages (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    complaint_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    sender_role text NOT NULL,
    body text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT complaint_messages_sender_role_check CHECK ((sender_role = ANY (ARRAY['employee'::text, 'director'::text])))
);


ALTER TABLE public.complaint_messages OWNER TO postgres;

--
-- TOC entry 280 (class 1259 OID 205213)
-- Name: complaint_notifications; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.complaint_notifications (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    complaint_id uuid NOT NULL,
    recipient_id uuid,
    message text NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    title text,
    recipient_user_id uuid
);


ALTER TABLE public.complaint_notifications OWNER TO postgres;

--
-- TOC entry 281 (class 1259 OID 205221)
-- Name: complaint_types; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.complaint_types (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.complaint_types OWNER TO postgres;

--
-- TOC entry 282 (class 1259 OID 205228)
-- Name: complaints; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.complaints (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    employee_id uuid NOT NULL,
    type_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    priority text DEFAULT 'medium'::text NOT NULL,
    is_anonymous boolean DEFAULT false NOT NULL,
    attachment_path text,
    status text DEFAULT 'pending'::text NOT NULL,
    manager_comment text,
    handled_by uuid,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    completed_at timestamp without time zone,
    due_date timestamp without time zone,
    resolved_at timestamp without time zone,
    satisfaction_rating integer,
    feedback text,
    department_id uuid,
    CONSTRAINT complaints_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]))),
    CONSTRAINT complaints_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text])))
);


ALTER TABLE public.complaints OWNER TO postgres;

--
-- TOC entry 222 (class 1259 OID 41184)
-- Name: departments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.departments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(255) NOT NULL,
    responsible_id uuid,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.departments OWNER TO postgres;

--
-- TOC entry 223 (class 1259 OID 41199)
-- Name: employee_departments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.employee_departments (
    employee_id uuid NOT NULL,
    department_id uuid NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.employee_departments OWNER TO postgres;

--
-- TOC entry 245 (class 1259 OID 114892)
-- Name: employee_monthly_summaries; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.employee_monthly_summaries (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    employee_id uuid NOT NULL,
    month integer NOT NULL,
    year integer NOT NULL,
    total_worked_days numeric(5,2) DEFAULT 0,
    absence_days numeric(5,2) DEFAULT 0,
    late_hours numeric(5,2) DEFAULT 0,
    early_departure_hours numeric(5,2) DEFAULT 0,
    total_overtime_hours numeric(5,2) DEFAULT 0,
    total_wage_changes numeric(10,2) DEFAULT 0,
    is_validated boolean DEFAULT false,
    validated_by_user_id uuid,
    validated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    audit_entry_id uuid,
    late_minutes integer DEFAULT 0,
    early_departure_minutes integer DEFAULT 0,
    overtime_hours_calculated numeric(5,2) DEFAULT 0,
    overtime_hours_approved numeric(5,2) DEFAULT 0,
    missing_punches_count integer DEFAULT 0,
    justified_absences integer DEFAULT 0,
    calculation_method character varying(20) DEFAULT 'calculated'::character varying,
    last_recalculated_at timestamp with time zone,
    half_days numeric(5,2) DEFAULT 0,
    CONSTRAINT employee_monthly_summaries_calculation_method_check CHECK (((calculation_method)::text = ANY (ARRAY[('calculated'::character varying)::text, ('validated'::character varying)::text, ('mixed'::character varying)::text])))
);


ALTER TABLE public.employee_monthly_summaries OWNER TO postgres;

--
-- TOC entry 6082 (class 0 OID 0)
-- Dependencies: 245
-- Name: COLUMN employee_monthly_summaries.half_days; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.employee_monthly_summaries.half_days IS 'Count of days treated as half-day (pending cases treated as half_day). These days are counted in total_worked_days but paid at 0.5x daily rate.';


--
-- TOC entry 243 (class 1259 OID 107193)
-- Name: employee_monthly_validations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.employee_monthly_validations (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    employee_id uuid NOT NULL,
    month integer NOT NULL,
    year integer NOT NULL,
    validated_by_user_id uuid NOT NULL,
    validated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    notes text,
    CONSTRAINT employee_monthly_validations_month_check CHECK (((month >= 1) AND (month <= 12))),
    CONSTRAINT employee_monthly_validations_year_check CHECK (((year >= 2020) AND (year <= 2100)))
);


ALTER TABLE public.employee_monthly_validations OWNER TO postgres;

--
-- TOC entry 6083 (class 0 OID 0)
-- Dependencies: 243
-- Name: TABLE employee_monthly_validations; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.employee_monthly_validations IS 'Tracks validation status of employee monthly attendance data';


--
-- TOC entry 6084 (class 0 OID 0)
-- Dependencies: 243
-- Name: COLUMN employee_monthly_validations.month; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.employee_monthly_validations.month IS 'Month (1-12)';


--
-- TOC entry 6085 (class 0 OID 0)
-- Dependencies: 243
-- Name: COLUMN employee_monthly_validations.year; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.employee_monthly_validations.year IS 'Year (2020-2100)';


--
-- TOC entry 6086 (class 0 OID 0)
-- Dependencies: 243
-- Name: COLUMN employee_monthly_validations.notes; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.employee_monthly_validations.notes IS 'Optional validation notes';


--
-- TOC entry 242 (class 1259 OID 107169)
-- Name: employee_overtime_hours; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.employee_overtime_hours (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    employee_id uuid NOT NULL,
    date date NOT NULL,
    hours numeric(5,2) NOT NULL,
    description text,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT employee_overtime_hours_hours_check CHECK (((hours >= (0)::numeric) AND (hours <= (24)::numeric)))
);


ALTER TABLE public.employee_overtime_hours OWNER TO postgres;

--
-- TOC entry 6087 (class 0 OID 0)
-- Dependencies: 242
-- Name: TABLE employee_overtime_hours; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.employee_overtime_hours IS 'Tracks overtime hours worked by employees on specific dates';


--
-- TOC entry 6088 (class 0 OID 0)
-- Dependencies: 242
-- Name: COLUMN employee_overtime_hours.hours; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.employee_overtime_hours.hours IS 'Number of overtime hours worked (0-24)';


--
-- TOC entry 6089 (class 0 OID 0)
-- Dependencies: 242
-- Name: COLUMN employee_overtime_hours.description; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.employee_overtime_hours.description IS 'Optional description or reason for overtime';


--
-- TOC entry 241 (class 1259 OID 106712)
-- Name: employee_salary_adjustments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.employee_salary_adjustments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    employee_id uuid NOT NULL,
    adjustment_type character varying(20) NOT NULL,
    amount numeric(10,2) NOT NULL,
    description text,
    effective_date date NOT NULL,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT employee_salary_adjustments_adjustment_type_check CHECK (((adjustment_type)::text = ANY ((ARRAY['credit'::character varying, 'decrease'::character varying, 'raise'::character varying])::text[])))
);


ALTER TABLE public.employee_salary_adjustments OWNER TO postgres;

--
-- TOC entry 6090 (class 0 OID 0)
-- Dependencies: 241
-- Name: TABLE employee_salary_adjustments; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.employee_salary_adjustments IS 'Employee-specific salary adjustments (credit, decrease, raise)';


--
-- TOC entry 228 (class 1259 OID 58158)
-- Name: employee_timetables; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.employee_timetables (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    employee_id uuid NOT NULL,
    timetable_id uuid NOT NULL,
    effective_from date NOT NULL,
    effective_to date,
    priority integer DEFAULT 1,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.employee_timetables OWNER TO postgres;

--
-- TOC entry 221 (class 1259 OID 41162)
-- Name: employees; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.employees (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    position_id uuid,
    institution character varying(255),
    first_name character varying(255) NOT NULL,
    last_name character varying(255) NOT NULL,
    foreign_name character varying(255),
    foreign_last_name character varying(255),
    gender character varying(20),
    birth_date date,
    phone character varying(20),
    email character varying(255),
    nationality character varying(100),
    address text,
    foreign_address text,
    join_date date,
    marital_status character varying(50),
    visible_to_parents_in_chat boolean DEFAULT false,
    profile_picture_url character varying(500),
    cv_url character varying(500),
    education_level character varying(100),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    emergency_contact_name character varying(255),
    emergency_contact_phone character varying(20),
    emergency_contact_relationship character varying(100),
    language_preference character varying(10) DEFAULT 'en'::character varying,
    notification_preferences jsonb DEFAULT '{"sms": false, "push": true, "email": true}'::jsonb,
    theme_preference character varying(20) DEFAULT 'light'::character varying,
    place_of_birth character varying(255),
    social_security_number character varying(50),
    CONSTRAINT employees_gender_check CHECK (((gender)::text = ANY ((ARRAY['Male'::character varying, 'Female'::character varying, 'Other'::character varying])::text[]))),
    CONSTRAINT employees_marital_status_check CHECK (((marital_status)::text = ANY ((ARRAY['Single'::character varying, 'Married'::character varying, 'Divorced'::character varying, 'Widowed'::character varying])::text[])))
);


ALTER TABLE public.employees OWNER TO postgres;

--
-- TOC entry 6091 (class 0 OID 0)
-- Dependencies: 221
-- Name: COLUMN employees.place_of_birth; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.employees.place_of_birth IS 'Place of birth of the employee (e.g., "EL HAMMAMAT")';


--
-- TOC entry 6092 (class 0 OID 0)
-- Dependencies: 221
-- Name: COLUMN employees.social_security_number; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.employees.social_security_number IS 'Social security number (e.g., "00 1076 0037 64")';


--
-- TOC entry 239 (class 1259 OID 98513)
-- Name: raw_punches; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.raw_punches (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    employee_name text NOT NULL,
    punch_time timestamp with time zone NOT NULL,
    source character varying(50) DEFAULT 'file_upload'::character varying,
    uploaded_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    raw_data jsonb
);


ALTER TABLE public.raw_punches OWNER TO postgres;

--
-- TOC entry 227 (class 1259 OID 58142)
-- Name: timetable_intervals; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.timetable_intervals (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    timetable_id uuid NOT NULL,
    weekday integer NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    break_minutes integer DEFAULT 0,
    on_call_flag boolean DEFAULT false,
    overnight boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    grade_level integer,
    CONSTRAINT timetable_intervals_grade_level_check CHECK (((grade_level >= 1) AND (grade_level <= 5))),
    CONSTRAINT timetable_intervals_weekday_check CHECK (((weekday >= 0) AND (weekday <= 6)))
);


ALTER TABLE public.timetable_intervals OWNER TO postgres;

--
-- TOC entry 249 (class 1259 OID 123255)
-- Name: comprehensive_monthly_statistics; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.comprehensive_monthly_statistics AS
 WITH employee_base AS (
         SELECT e.id AS employee_id,
            (((e.first_name)::text || ' '::text) || (e.last_name)::text) AS employee_name,
            d.name AS department_name,
            e.first_name,
            e.last_name
           FROM ((public.employees e
             LEFT JOIN public.employee_departments ed ON ((e.id = ed.employee_id)))
             LEFT JOIN public.departments d ON ((ed.department_id = d.id)))
        ), scheduled_days_calc AS (
         SELECT eb.employee_id,
            EXTRACT(month FROM d.date_series) AS month,
            EXTRACT(year FROM d.date_series) AS year,
            count(DISTINCT d.date_series) AS scheduled_days
           FROM (((employee_base eb
             CROSS JOIN generate_series((date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone) - '1 mon'::interval), (date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone) - '1 day'::interval), '1 day'::interval) d(date_series))
             LEFT JOIN public.employee_timetables et ON (((eb.employee_id = et.employee_id) AND (d.date_series >= et.effective_from) AND ((et.effective_to IS NULL) OR (d.date_series <= et.effective_to)))))
             LEFT JOIN public.timetable_intervals ti ON (((et.timetable_id = ti.timetable_id) AND (EXTRACT(dow FROM d.date_series) = (ti.weekday)::numeric))))
          WHERE (ti.timetable_id IS NOT NULL)
          GROUP BY eb.employee_id, (EXTRACT(month FROM d.date_series)), (EXTRACT(year FROM d.date_series))
        ), monthly_calculations AS (
         SELECT eb.employee_id,
            eb.employee_name,
            eb.department_name,
            EXTRACT(month FROM rp.punch_time) AS month,
            EXTRACT(year FROM rp.punch_time) AS year,
            count(DISTINCT date(rp.punch_time)) AS worked_days,
            GREATEST((0)::numeric, (COALESCE((sd.scheduled_days)::numeric, EXTRACT(day FROM ((date_trunc('month'::text, max(rp.punch_time)) + '1 mon'::interval) - '1 day'::interval))) - (count(DISTINCT date(rp.punch_time)))::numeric)) AS absence_days_calculated,
            ((sum(
                CASE
                    WHEN (EXTRACT(hour FROM rp.punch_time) >= (9)::numeric) THEN 1
                    ELSE 0
                END))::numeric * 0.5) AS late_hours_estimated,
            ((sum(
                CASE
                    WHEN (EXTRACT(hour FROM rp.punch_time) <= (16)::numeric) THEN 1
                    ELSE 0
                END))::numeric * 0.3) AS early_departure_hours_estimated
           FROM ((employee_base eb
             LEFT JOIN public.raw_punches rp ON (((((lower(TRIM(BOTH FROM replace(rp.employee_name, ' '::text, ''::text))) = lower(TRIM(BOTH FROM replace((((eb.first_name)::text || ' '::text) || (eb.last_name)::text), ' '::text, ''::text)))) OR (lower(TRIM(BOTH FROM replace(rp.employee_name, ' '::text, ''::text))) = lower(TRIM(BOTH FROM replace((((eb.last_name)::text || ' '::text) || (eb.first_name)::text), ' '::text, ''::text))))) OR (lower(TRIM(BOTH FROM replace(rp.employee_name, ' '::text, ''::text))) = lower(TRIM(BOTH FROM replace(((eb.first_name)::text || (eb.last_name)::text), ' '::text, ''::text))))) OR (lower(TRIM(BOTH FROM replace(rp.employee_name, ' '::text, ''::text))) = lower(TRIM(BOTH FROM replace(((eb.last_name)::text || (eb.first_name)::text), ' '::text, ''::text)))))))
             LEFT JOIN scheduled_days_calc sd ON (((eb.employee_id = sd.employee_id) AND (EXTRACT(month FROM rp.punch_time) = sd.month) AND (EXTRACT(year FROM rp.punch_time) = sd.year))))
          WHERE (rp.punch_time IS NOT NULL)
          GROUP BY eb.employee_id, eb.employee_name, eb.department_name, (EXTRACT(month FROM rp.punch_time)), (EXTRACT(year FROM rp.punch_time)), sd.scheduled_days
        ), validated_summaries AS (
         SELECT ems.employee_id,
            eb.employee_name,
            eb.department_name,
            ems.month,
            ems.year,
            ems.total_worked_days,
            ems.absence_days,
            ems.late_hours,
            ems.early_departure_hours,
            ems.total_overtime_hours,
            ems.total_wage_changes,
            ems.is_validated,
            ems.validated_by_user_id,
            ems.validated_at,
            'validated'::text AS data_source
           FROM (public.employee_monthly_summaries ems
             JOIN employee_base eb ON ((ems.employee_id = eb.employee_id)))
          WHERE (ems.is_validated = true)
        ), calculated_summaries AS (
         SELECT mc.employee_id,
            mc.employee_name,
            mc.department_name,
            mc.month,
            mc.year,
            mc.worked_days AS total_worked_days,
            mc.absence_days_calculated AS absence_days,
            mc.late_hours_estimated AS late_hours,
            mc.early_departure_hours_estimated AS early_departure_hours,
            COALESCE(oh.total_overtime, (0)::numeric) AS total_overtime_hours,
            COALESCE(sa.total_adjustments, (0)::numeric) AS total_wage_changes,
            false AS is_validated,
            NULL::uuid AS validated_by_user_id,
            NULL::timestamp with time zone AS validated_at,
            'calculated'::text AS data_source
           FROM (((monthly_calculations mc
             LEFT JOIN ( SELECT employee_overtime_hours.employee_id,
                    EXTRACT(month FROM employee_overtime_hours.date) AS month,
                    EXTRACT(year FROM employee_overtime_hours.date) AS year,
                    sum(employee_overtime_hours.hours) AS total_overtime
                   FROM public.employee_overtime_hours
                  GROUP BY employee_overtime_hours.employee_id, (EXTRACT(month FROM employee_overtime_hours.date)), (EXTRACT(year FROM employee_overtime_hours.date))) oh ON (((mc.employee_id = oh.employee_id) AND (mc.month = oh.month) AND (mc.year = oh.year))))
             LEFT JOIN ( SELECT employee_salary_adjustments.employee_id,
                    EXTRACT(month FROM employee_salary_adjustments.effective_date) AS month,
                    EXTRACT(year FROM employee_salary_adjustments.effective_date) AS year,
                    sum(
                        CASE
                            WHEN ((employee_salary_adjustments.adjustment_type)::text = 'decrease'::text) THEN (- employee_salary_adjustments.amount)
                            ELSE employee_salary_adjustments.amount
                        END) AS total_adjustments
                   FROM public.employee_salary_adjustments
                  GROUP BY employee_salary_adjustments.employee_id, (EXTRACT(month FROM employee_salary_adjustments.effective_date)), (EXTRACT(year FROM employee_salary_adjustments.effective_date))) sa ON (((mc.employee_id = sa.employee_id) AND (mc.month = sa.month) AND (mc.year = sa.year))))
             LEFT JOIN public.employee_monthly_validations emv ON (((mc.employee_id = emv.employee_id) AND (mc.month = (emv.month)::numeric) AND (mc.year = (emv.year)::numeric))))
          WHERE (emv.id IS NULL)
        )
 SELECT COALESCE(vs.employee_id, cs.employee_id) AS employee_id,
    COALESCE(vs.employee_name, cs.employee_name) AS employee_name,
    COALESCE(vs.department_name, cs.department_name) AS department_name,
    COALESCE((vs.month)::numeric, cs.month) AS month,
    COALESCE((vs.year)::numeric, cs.year) AS year,
    COALESCE(vs.total_worked_days, (cs.total_worked_days)::numeric) AS total_worked_days,
    COALESCE(vs.absence_days, cs.absence_days) AS absence_days,
    COALESCE(vs.late_hours, cs.late_hours) AS late_hours,
    COALESCE(vs.early_departure_hours, cs.early_departure_hours) AS early_departure_hours,
    COALESCE(vs.total_overtime_hours, cs.total_overtime_hours) AS overtime_hours,
    COALESCE(vs.total_wage_changes, cs.total_wage_changes) AS wage_changes,
    COALESCE(vs.is_validated, cs.is_validated) AS is_validated,
    COALESCE(vs.validated_by_user_id, cs.validated_by_user_id) AS validated_by_user_id,
    COALESCE(vs.validated_at, cs.validated_at) AS validated_at,
    COALESCE(vs.data_source, cs.data_source) AS data_source
   FROM (validated_summaries vs
     FULL JOIN calculated_summaries cs ON (((vs.employee_id = cs.employee_id) AND ((vs.month)::numeric = cs.month) AND ((vs.year)::numeric = cs.year))));


ALTER VIEW public.comprehensive_monthly_statistics OWNER TO postgres;

--
-- TOC entry 6093 (class 0 OID 0)
-- Dependencies: 249
-- Name: VIEW comprehensive_monthly_statistics; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON VIEW public.comprehensive_monthly_statistics IS 'Comprehensive monthly attendance statistics combining validated data and real-time calculations with improved name matching';


--
-- TOC entry 299 (class 1259 OID 205629)
-- Name: localisations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.localisations (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    code_emplacement text NOT NULL,
    batiment text NOT NULL,
    etage text NOT NULL,
    description_fr text,
    description_ar text,
    type_local text,
    type_local_custom text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT localisations_type_local_check CHECK ((type_local = ANY (ARRAY['salle'::text, 'bureau'::text, 'sanitaire'::text, 'laboratoire'::text, 'salle_informatique'::text, 'atelier'::text, 'restaurant'::text, 'stockage'::text, 'autre'::text])))
);


ALTER TABLE public.localisations OWNER TO postgres;

--
-- TOC entry 283 (class 1259 OID 205240)
-- Name: signalisations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.signalisations (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    type_id uuid NOT NULL,
    created_by uuid NOT NULL,
    title text NOT NULL,
    description text,
    photo_path text,
    is_viewed boolean DEFAULT false NOT NULL,
    is_treated boolean DEFAULT false NOT NULL,
    treated_by uuid,
    treated_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    localisation_id uuid,
    location text,
    priority text DEFAULT 'medium'::text NOT NULL,
    satisfaction_rating integer,
    feedback text,
    CONSTRAINT signalisations_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]))),
    CONSTRAINT signalisations_satisfaction_rating_check CHECK (((satisfaction_rating >= 1) AND (satisfaction_rating <= 5)))
);


ALTER TABLE public.signalisations OWNER TO postgres;

--
-- TOC entry 284 (class 1259 OID 205252)
-- Name: suggestions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.suggestions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    employee_id uuid NOT NULL,
    type_id uuid,
    title text NOT NULL,
    description text,
    category text,
    department_id uuid,
    status text DEFAULT 'under_review'::text NOT NULL,
    director_comment text,
    handled_by uuid,
    redirected_to uuid,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    reviewed_at timestamp without time zone,
    decision_at timestamp without time zone,
    CONSTRAINT suggestions_status_check CHECK ((status = ANY (ARRAY['under_review'::text, 'accepted'::text, 'rejected'::text])))
);


ALTER TABLE public.suggestions OWNER TO postgres;

--
-- TOC entry 300 (class 1259 OID 205649)
-- Name: critical_alerts; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.critical_alerts AS
 SELECT 'suggestion_stalled'::text AS alert_type,
    s.id,
    s.title,
    (((e.first_name)::text || ' '::text) || (e.last_name)::text) AS employee,
    d.name AS department,
    EXTRACT(day FROM (CURRENT_TIMESTAMP - (s.created_at)::timestamp with time zone)) AS days_pending
   FROM ((public.suggestions s
     JOIN public.employees e ON ((s.employee_id = e.id)))
     LEFT JOIN public.departments d ON ((s.department_id = d.id)))
  WHERE ((s.status = 'under_review'::text) AND (s.created_at < (CURRENT_DATE - '15 days'::interval)))
UNION ALL
 SELECT 'signal_untreated'::text AS alert_type,
    sig.id,
    sig.title,
    (((e.first_name)::text || ' '::text) || (e.last_name)::text) AS employee,
    COALESCE((((l.code_emplacement || ' ('::text) || COALESCE(l.description_ar, ''::text)) || ')'::text), sig.location) AS department,
    EXTRACT(day FROM (CURRENT_TIMESTAMP - (sig.created_at)::timestamp with time zone)) AS days_pending
   FROM ((public.signalisations sig
     JOIN public.employees e ON ((sig.created_by = e.id)))
     LEFT JOIN public.localisations l ON ((sig.localisation_id = l.id)))
  WHERE ((sig.is_treated = false) AND (sig.created_at < (CURRENT_DATE - '7 days'::interval)))
  ORDER BY 6 DESC;


ALTER VIEW public.critical_alerts OWNER TO postgres;

--
-- TOC entry 285 (class 1259 OID 205261)
-- Name: department_performance_detail; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.department_performance_detail AS
 SELECT d.name AS department,
    count(DISTINCT s.id) AS total_suggestions,
    count(DISTINCT s.id) FILTER (WHERE (s.status = 'under_review'::text)) AS pending_suggestions,
    count(DISTINCT s.id) FILTER (WHERE (s.status = 'accepted'::text)) AS accepted_suggestions,
    count(DISTINCT s.id) FILTER (WHERE (s.status = 'rejected'::text)) AS rejected_suggestions,
    count(DISTINCT sig.id) AS total_signals,
    count(DISTINCT sig.id) FILTER (WHERE (sig.is_treated = false)) AS pending_signals,
    count(DISTINCT sig.id) FILTER (WHERE (sig.is_treated = true)) AS treated_signals,
    round(avg((EXTRACT(epoch FROM (s.reviewed_at - s.created_at)) / (86400)::numeric)), 2) AS avg_suggestion_review_days,
    round(avg((EXTRACT(epoch FROM (sig.treated_at - sig.created_at)) / (86400)::numeric)), 2) AS avg_signal_treatment_days,
    count(DISTINCT s.employee_id) AS employees_with_suggestions,
    count(DISTINCT sig.created_by) AS employees_with_signals
   FROM ((public.departments d
     LEFT JOIN public.suggestions s ON ((d.id = s.department_id)))
     LEFT JOIN public.signalisations sig ON ((d.id = sig.localisation_id)))
  GROUP BY d.id, d.name
  ORDER BY (count(DISTINCT s.id)) DESC;


ALTER VIEW public.department_performance_detail OWNER TO postgres;

--
-- TOC entry 286 (class 1259 OID 205266)
-- Name: director_dashboard; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.director_dashboard AS
 WITH response_time_metrics AS (
         SELECT 'suggestion_review'::text AS metric,
            percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY (((EXTRACT(epoch FROM (suggestions.reviewed_at - suggestions.created_at)) / (3600)::numeric))::double precision)) AS median_hours
           FROM public.suggestions
          WHERE (suggestions.reviewed_at IS NOT NULL)
        UNION ALL
         SELECT 'signal_treatment'::text AS metric,
            percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY (((EXTRACT(epoch FROM (signalisations.treated_at - signalisations.created_at)) / (3600)::numeric))::double precision)) AS median_hours
           FROM public.signalisations
          WHERE (signalisations.treated_at IS NOT NULL)
        )
 SELECT ( SELECT count(*) AS count
           FROM public.suggestions) AS total_suggestions,
    ( SELECT count(*) AS count
           FROM public.suggestions
          WHERE (suggestions.status = 'under_review'::text)) AS pending_suggestions,
    ( SELECT count(*) AS count
           FROM public.signalisations) AS total_signals,
    ( SELECT count(*) AS count
           FROM public.signalisations
          WHERE (signalisations.is_treated = false)) AS pending_signals,
    round((((( SELECT count(*) AS count
           FROM public.suggestions
          WHERE (suggestions.status = ANY (ARRAY['accepted'::text, 'rejected'::text]))))::numeric * 100.0) / (NULLIF(( SELECT count(*) AS count
           FROM public.suggestions), 0))::numeric), 2) AS suggestion_resolution_rate,
    round((((( SELECT count(*) AS count
           FROM public.signalisations
          WHERE (signalisations.is_treated = true)))::numeric * 100.0) / (NULLIF(( SELECT count(*) AS count
           FROM public.signalisations), 0))::numeric), 2) AS signal_resolution_rate,
    ( SELECT response_time_metrics.median_hours
           FROM response_time_metrics
          WHERE (response_time_metrics.metric = 'suggestion_review'::text)) AS median_review_hours,
    ( SELECT response_time_metrics.median_hours
           FROM response_time_metrics
          WHERE (response_time_metrics.metric = 'signal_treatment'::text)) AS median_treatment_hours;


ALTER VIEW public.director_dashboard OWNER TO postgres;

--
-- TOC entry 252 (class 1259 OID 164182)
-- Name: employee_compensations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.employee_compensations (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    employee_id uuid NOT NULL,
    base_salary numeric(10,2),
    hourly_rate numeric(8,2),
    overtime_rate numeric(8,2),
    effective_date date DEFAULT CURRENT_DATE NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.employee_compensations OWNER TO postgres;

--
-- TOC entry 301 (class 1259 OID 221575)
-- Name: employee_contracts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.employee_contracts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    employee_id uuid NOT NULL,
    position_id uuid,
    start_date date NOT NULL,
    end_date date,
    contract_type character varying(50),
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.employee_contracts OWNER TO postgres;

--
-- TOC entry 6094 (class 0 OID 0)
-- Dependencies: 301
-- Name: TABLE employee_contracts; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.employee_contracts IS 'Stores employee contract history. Each contract represents a period of employment with a specific position. NULL end_date indicates current/active contract.';


--
-- TOC entry 246 (class 1259 OID 114919)
-- Name: employee_daily_attendance; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.employee_daily_attendance (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    employee_id uuid NOT NULL,
    date date NOT NULL,
    scheduled_shift_start time without time zone,
    scheduled_shift_end time without time zone,
    entry_time timestamp with time zone,
    exit_time timestamp with time zone,
    work_hours numeric(5,2) DEFAULT 0,
    overtime_hours numeric(5,2) DEFAULT 0,
    absence_status character varying(50),
    late_minutes integer DEFAULT 0,
    early_departure_minutes integer DEFAULT 0,
    missing_punches text[] DEFAULT ARRAY[]::text[],
    is_validated boolean DEFAULT false,
    validated_by_user_id uuid,
    validated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    audit_entry_id uuid,
    calculated_late_minutes integer DEFAULT 0,
    calculated_early_departure_minutes integer DEFAULT 0,
    overtime_hours_calculated numeric(5,2) DEFAULT 0,
    overtime_hours_approved numeric(5,2) DEFAULT 0
);


ALTER TABLE public.employee_daily_attendance OWNER TO postgres;

--
-- TOC entry 244 (class 1259 OID 107223)
-- Name: employee_monthly_statistics; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.employee_monthly_statistics AS
 WITH monthly_attendance AS (
         SELECT e.id AS employee_id,
            (((e.first_name)::text || ' '::text) || (e.last_name)::text) AS employee_name,
            d.name AS department_name,
            public.extract_month_from_timestamp_immutable(ap.punch_time) AS month,
            public.extract_year_from_timestamp_immutable(ap.punch_time) AS year,
            (ap.punch_time)::date AS attendance_date,
            count(ap.id) AS daily_punches
           FROM (((public.employees e
             LEFT JOIN public.employee_departments ed ON ((e.id = ed.employee_id)))
             LEFT JOIN public.departments d ON ((ed.department_id = d.id)))
             LEFT JOIN public.attendance_punches ap ON ((e.id = ap.employee_id)))
          WHERE (ap.punch_time IS NOT NULL)
          GROUP BY e.id, e.first_name, e.last_name, d.name, (public.extract_month_from_timestamp_immutable(ap.punch_time)), (public.extract_year_from_timestamp_immutable(ap.punch_time)), ((ap.punch_time)::date)
        ), monthly_summary AS (
         SELECT monthly_attendance.employee_id,
            monthly_attendance.employee_name,
            monthly_attendance.department_name,
            monthly_attendance.month,
            monthly_attendance.year,
            count(DISTINCT monthly_attendance.attendance_date) AS total_worked_days,
            count(
                CASE
                    WHEN (monthly_attendance.daily_punches < 2) THEN 1
                    ELSE NULL::integer
                END) AS incomplete_days,
            ((EXTRACT(day FROM ((date_trunc('month'::text, (make_date(monthly_attendance.year, monthly_attendance.month, 1))::timestamp with time zone) + '1 mon'::interval) - '1 day'::interval)))::integer - count(DISTINCT monthly_attendance.attendance_date)) AS absence_days
           FROM monthly_attendance
          GROUP BY monthly_attendance.employee_id, monthly_attendance.employee_name, monthly_attendance.department_name, monthly_attendance.month, monthly_attendance.year
        )
 SELECT ms.employee_id,
    ms.employee_name,
    ms.department_name,
    ms.month,
    ms.year,
    ms.total_worked_days,
    ms.incomplete_days,
    ms.absence_days,
    COALESCE(oh.total_overtime_hours, (0)::numeric) AS overtime_hours,
    COALESCE(sa.total_wage_changes, (0)::numeric) AS wage_changes,
        CASE
            WHEN (mv.id IS NOT NULL) THEN true
            ELSE false
        END AS is_validated,
    mv.validated_at,
    mv.validated_by_user_id
   FROM (((monthly_summary ms
     LEFT JOIN ( SELECT employee_overtime_hours.employee_id,
            public.extract_month_immutable(employee_overtime_hours.date) AS month,
            public.extract_year_immutable(employee_overtime_hours.date) AS year,
            sum(employee_overtime_hours.hours) AS total_overtime_hours
           FROM public.employee_overtime_hours
          GROUP BY employee_overtime_hours.employee_id, (public.extract_month_immutable(employee_overtime_hours.date)), (public.extract_year_immutable(employee_overtime_hours.date))) oh ON (((ms.employee_id = oh.employee_id) AND (ms.month = oh.month) AND (ms.year = oh.year))))
     LEFT JOIN ( SELECT employee_salary_adjustments.employee_id,
            public.extract_month_immutable(employee_salary_adjustments.effective_date) AS month,
            public.extract_year_immutable(employee_salary_adjustments.effective_date) AS year,
            sum(
                CASE
                    WHEN ((employee_salary_adjustments.adjustment_type)::text = 'decrease'::text) THEN (- employee_salary_adjustments.amount)
                    ELSE employee_salary_adjustments.amount
                END) AS total_wage_changes
           FROM public.employee_salary_adjustments
          GROUP BY employee_salary_adjustments.employee_id, (public.extract_month_immutable(employee_salary_adjustments.effective_date)), (public.extract_year_immutable(employee_salary_adjustments.effective_date))) sa ON (((ms.employee_id = sa.employee_id) AND (ms.month = sa.month) AND (ms.year = sa.year))))
     LEFT JOIN public.employee_monthly_validations mv ON (((ms.employee_id = mv.employee_id) AND (ms.month = mv.month) AND (ms.year = mv.year))));


ALTER VIEW public.employee_monthly_statistics OWNER TO postgres;

--
-- TOC entry 6095 (class 0 OID 0)
-- Dependencies: 244
-- Name: VIEW employee_monthly_statistics; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON VIEW public.employee_monthly_statistics IS 'Consolidated view of employee monthly attendance statistics including overtime and wage changes';


--
-- TOC entry 263 (class 1259 OID 190151)
-- Name: employee_reports; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.employee_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    title character varying(255) NOT NULL,
    subject text NOT NULL,
    content text NOT NULL,
    concerned_employees uuid[],
    status character varying(30) DEFAULT 'pending'::character varying,
    remarks text,
    pdf_url text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    recipients uuid[],
    include_director boolean DEFAULT true,
    analysis jsonb,
    analysis_embedding_json jsonb,
    CONSTRAINT employee_reports_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('acknowledged'::character varying)::text]))),
    CONSTRAINT include_director_always_true CHECK ((include_director = true))
);


ALTER TABLE public.employee_reports OWNER TO postgres;

--
-- TOC entry 225 (class 1259 OID 41404)
-- Name: position_salaries; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.position_salaries (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    position_id uuid,
    base_salary numeric(10,2),
    hourly_rate numeric(8,2),
    overtime_rate numeric(8,2),
    bonus_rate numeric(5,2),
    effective_date date DEFAULT CURRENT_DATE NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.position_salaries OWNER TO postgres;

--
-- TOC entry 220 (class 1259 OID 41152)
-- Name: positions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.positions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(255) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.positions OWNER TO postgres;

--
-- TOC entry 253 (class 1259 OID 164199)
-- Name: employee_salary_calculation_view; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.employee_salary_calculation_view AS
 WITH latest_position_rates AS (
         SELECT p_1.id AS position_id,
            ps.base_salary,
            ps.hourly_rate,
            ps.overtime_rate
           FROM (public.positions p_1
             LEFT JOIN LATERAL ( SELECT ps1.base_salary,
                    ps1.hourly_rate,
                    ps1.overtime_rate
                   FROM public.position_salaries ps1
                  WHERE ((ps1.position_id = p_1.id) AND (ps1.effective_date <= CURRENT_DATE))
                  ORDER BY ps1.effective_date DESC
                 LIMIT 1) ps ON (true))
        ), latest_employee_rates AS (
         SELECT e_1.id AS employee_id,
            ec.base_salary,
            ec.hourly_rate,
            ec.overtime_rate
           FROM (public.employees e_1
             LEFT JOIN LATERAL ( SELECT ec1.base_salary,
                    ec1.hourly_rate,
                    ec1.overtime_rate
                   FROM public.employee_compensations ec1
                  WHERE ((ec1.employee_id = e_1.id) AND (ec1.effective_date <= CURRENT_DATE))
                  ORDER BY ec1.effective_date DESC
                 LIMIT 1) ec ON (true))
        )
 SELECT e.id AS employee_id,
    (((e.first_name)::text || ' '::text) || (e.last_name)::text) AS employee_name,
    e.first_name,
    e.last_name,
    p.name AS position_name,
    COALESCE(ler.base_salary, lpr.base_salary) AS base_salary,
    COALESCE(ler.hourly_rate, lpr.hourly_rate) AS hourly_rate,
    COALESCE(ler.overtime_rate, lpr.overtime_rate) AS overtime_rate,
    d.name AS department_name
   FROM (((((public.employees e
     LEFT JOIN public.positions p ON ((e.position_id = p.id)))
     LEFT JOIN latest_position_rates lpr ON ((lpr.position_id = p.id)))
     LEFT JOIN latest_employee_rates ler ON ((ler.employee_id = e.id)))
     LEFT JOIN public.employee_departments ed ON ((e.id = ed.employee_id)))
     LEFT JOIN public.departments d ON ((ed.department_id = d.id)));


ALTER VIEW public.employee_salary_calculation_view OWNER TO postgres;

--
-- TOC entry 264 (class 1259 OID 190163)
-- Name: instruction_recipients; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.instruction_recipients (
    instruction_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    acknowledged boolean DEFAULT false NOT NULL,
    acknowledged_at timestamp with time zone,
    completed boolean DEFAULT false NOT NULL,
    completed_at timestamp with time zone
);


ALTER TABLE public.instruction_recipients OWNER TO postgres;

--
-- TOC entry 265 (class 1259 OID 190169)
-- Name: instructions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.instructions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    body text NOT NULL,
    priority text DEFAULT 'normal'::text NOT NULL,
    due_at timestamp with time zone,
    status text DEFAULT 'active'::text NOT NULL,
    created_by_user_id uuid,
    created_by_employee_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT instructions_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text]))),
    CONSTRAINT instructions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text, 'cancelled'::text])))
);


ALTER TABLE public.instructions OWNER TO postgres;

--
-- TOC entry 256 (class 1259 OID 164220)
-- Name: level_subjects; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.level_subjects (
    level_id uuid NOT NULL,
    subject_id uuid NOT NULL
);


ALTER TABLE public.level_subjects OWNER TO postgres;

--
-- TOC entry 255 (class 1259 OID 164212)
-- Name: levels; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.levels (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(255) NOT NULL
);


ALTER TABLE public.levels OWNER TO postgres;

--
-- TOC entry 266 (class 1259 OID 190181)
-- Name: meeting_attendees; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.meeting_attendees (
    meeting_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.meeting_attendees OWNER TO postgres;

--
-- TOC entry 267 (class 1259 OID 190185)
-- Name: meetings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.meetings (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    scheduled_by uuid,
    start_time timestamp without time zone NOT NULL,
    end_time timestamp without time zone NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.meetings OWNER TO postgres;

--
-- TOC entry 268 (class 1259 OID 190193)
-- Name: notifications; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.notifications (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    recipient_id uuid,
    sender_id uuid,
    type character varying(100) NOT NULL,
    message text,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    user_id uuid NOT NULL,
    title text NOT NULL,
    body text,
    ref_type text,
    ref_id uuid
);


ALTER TABLE public.notifications OWNER TO postgres;

--
-- TOC entry 247 (class 1259 OID 123146)
-- Name: overtime_requests; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.overtime_requests (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    employee_id uuid NOT NULL,
    date date NOT NULL,
    requested_hours numeric(5,2) NOT NULL,
    description text,
    status character varying(20) DEFAULT 'Pending'::character varying NOT NULL,
    submitted_by_user_id uuid,
    reviewed_by_user_id uuid,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT overtime_requests_hours_check CHECK (((requested_hours >= (0)::numeric) AND (requested_hours <= (24)::numeric))),
    CONSTRAINT overtime_requests_status_check CHECK (((status)::text = ANY (ARRAY[('Pending'::character varying)::text, ('Approved'::character varying)::text, ('Declined'::character varying)::text])))
);


ALTER TABLE public.overtime_requests OWNER TO postgres;

--
-- TOC entry 6096 (class 0 OID 0)
-- Dependencies: 247
-- Name: TABLE overtime_requests; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.overtime_requests IS 'Employee overtime requests that require approval';


--
-- TOC entry 250 (class 1259 OID 147804)
-- Name: payslip_batches; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.payslip_batches (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    month integer NOT NULL,
    year integer NOT NULL,
    uploaded_by_user_id uuid,
    total_files integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT payslip_batches_month_check CHECK (((month >= 1) AND (month <= 12))),
    CONSTRAINT payslip_batches_year_check CHECK ((year >= 2000))
);


ALTER TABLE public.payslip_batches OWNER TO postgres;

--
-- TOC entry 251 (class 1259 OID 147819)
-- Name: payslips; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.payslips (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    employee_id uuid,
    month integer NOT NULL,
    year integer NOT NULL,
    upload_id uuid,
    status character varying(20) DEFAULT 'uploaded'::character varying NOT NULL,
    matched_confidence numeric(4,2) DEFAULT 0,
    batch_id uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT payslips_month_check CHECK (((month >= 1) AND (month <= 12))),
    CONSTRAINT payslips_status_check CHECK (((status)::text = ANY ((ARRAY['uploaded'::character varying, 'unmatched'::character varying, 'not_uploaded'::character varying])::text[]))),
    CONSTRAINT payslips_year_check CHECK ((year >= 2000))
);


ALTER TABLE public.payslips OWNER TO postgres;

--
-- TOC entry 269 (class 1259 OID 190201)
-- Name: permission_requests; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.permission_requests (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    employee_id uuid,
    type character varying(50) NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    reason text NOT NULL,
    document_url character varying(500),
    status character varying(20) DEFAULT 'Pending'::character varying NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT permission_requests_status_check CHECK (((status)::text = ANY (ARRAY[('Pending'::character varying)::text, ('Accepted'::character varying)::text, ('Denied'::character varying)::text]))),
    CONSTRAINT permission_requests_type_check CHECK (((type)::text = ANY (ARRAY[('Vacation'::character varying)::text, ('Day Off'::character varying)::text, ('Absence Justification'::character varying)::text])))
);


ALTER TABLE public.permission_requests OWNER TO postgres;

--
-- TOC entry 237 (class 1259 OID 90495)
-- Name: punch_file_uploads; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.punch_file_uploads (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    filename character varying(255) NOT NULL,
    original_filename character varying(255) NOT NULL,
    file_path character varying(500) NOT NULL,
    file_size bigint NOT NULL,
    uploaded_by_user_id uuid NOT NULL,
    upload_date timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    processed_at timestamp with time zone,
    status character varying(20) DEFAULT 'uploaded'::character varying NOT NULL,
    total_records integer DEFAULT 0,
    processed_records integer DEFAULT 0,
    error_records integer DEFAULT 0,
    processing_errors jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT punch_file_uploads_status_check CHECK (((status)::text = ANY ((ARRAY['uploaded'::character varying, 'processing'::character varying, 'completed'::character varying, 'failed'::character varying])::text[])))
);


ALTER TABLE public.punch_file_uploads OWNER TO postgres;

--
-- TOC entry 270 (class 1259 OID 190212)
-- Name: report_acknowledgements; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.report_acknowledgements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    report_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    acknowledged boolean DEFAULT false,
    acknowledged_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.report_acknowledgements OWNER TO postgres;

--
-- TOC entry 298 (class 1259 OID 205587)
-- Name: report_viewed_tracking; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.report_viewed_tracking (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    report_id uuid NOT NULL,
    viewer_id uuid NOT NULL,
    viewed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.report_viewed_tracking OWNER TO postgres;

--
-- TOC entry 271 (class 1259 OID 190219)
-- Name: reports; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.reports (
    id uuid NOT NULL,
    task_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    description text NOT NULL,
    remarks text,
    created_at timestamp without time zone DEFAULT now(),
    pdf_url text
);


ALTER TABLE public.reports OWNER TO postgres;

--
-- TOC entry 272 (class 1259 OID 190225)
-- Name: salaries; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.salaries (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    employee_id uuid,
    position_id uuid,
    amount numeric(10,2) NOT NULL,
    currency character varying(10) DEFAULT 'DZD'::character varying,
    payment_frequency character varying(20) NOT NULL,
    effective_date date NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT salaries_payment_frequency_check CHECK (((payment_frequency)::text = ANY (ARRAY[('Monthly'::character varying)::text, ('Daily'::character varying)::text, ('Hourly'::character varying)::text])))
);


ALTER TABLE public.salaries OWNER TO postgres;

--
-- TOC entry 238 (class 1259 OID 90512)
-- Name: salary_calculations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.salary_calculations (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    employee_id uuid NOT NULL,
    calculation_period_start date NOT NULL,
    calculation_period_end date NOT NULL,
    base_salary numeric(10,2) DEFAULT 0 NOT NULL,
    worked_days integer DEFAULT 0 NOT NULL,
    total_absences integer DEFAULT 0 NOT NULL,
    overtime_hours numeric(5,2) DEFAULT 0 NOT NULL,
    deductions numeric(10,2) DEFAULT 0 NOT NULL,
    bonuses numeric(10,2) DEFAULT 0 NOT NULL,
    gross_salary numeric(10,2) DEFAULT 0 NOT NULL,
    net_salary numeric(10,2) DEFAULT 0 NOT NULL,
    status character varying(20) DEFAULT 'calculated'::character varying NOT NULL,
    paid_at timestamp with time zone,
    calculated_by_user_id uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT salary_calculations_status_check CHECK (((status)::text = ANY ((ARRAY['calculated'::character varying, 'approved'::character varying, 'paid'::character varying])::text[])))
);


ALTER TABLE public.salary_calculations OWNER TO postgres;

--
-- TOC entry 273 (class 1259 OID 190233)
-- Name: salary_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.salary_history (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    employee_id uuid,
    salary_id uuid,
    old_amount numeric(10,2),
    new_amount numeric(10,2),
    change_date timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.salary_history OWNER TO postgres;

--
-- TOC entry 240 (class 1259 OID 106700)
-- Name: salary_parameters; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.salary_parameters (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    parameter_name character varying(50) NOT NULL,
    parameter_value numeric(10,2) NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.salary_parameters OWNER TO postgres;

--
-- TOC entry 6097 (class 0 OID 0)
-- Dependencies: 240
-- Name: TABLE salary_parameters; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.salary_parameters IS 'Configurable parameters for salary calculations';


--
-- TOC entry 236 (class 1259 OID 90470)
-- Name: salary_payments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.salary_payments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    employee_id uuid NOT NULL,
    month integer NOT NULL,
    year integer NOT NULL,
    status character varying(20) DEFAULT 'Paid'::character varying NOT NULL,
    paid_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    paid_by_user_id uuid,
    amount numeric(10,2),
    currency character varying(3) DEFAULT 'DA'::character varying,
    calculation_method character varying(20) DEFAULT 'algerian'::character varying,
    CONSTRAINT salary_payments_month_check CHECK (((month >= 1) AND (month <= 12))),
    CONSTRAINT salary_payments_status_check CHECK (((status)::text = ANY ((ARRAY['Paid'::character varying, 'Reversed'::character varying])::text[]))),
    CONSTRAINT salary_payments_year_check CHECK ((year >= 2000))
);


ALTER TABLE public.salary_payments OWNER TO postgres;

--
-- TOC entry 6098 (class 0 OID 0)
-- Dependencies: 236
-- Name: COLUMN salary_payments.calculation_method; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.salary_payments.calculation_method IS 'The calculation method used: algerian (Base - Deductions) or worked_days (Worked Days Ã— Daily Rate)';


--
-- TOC entry 235 (class 1259 OID 90448)
-- Name: salary_raises; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.salary_raises (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    employee_id uuid NOT NULL,
    raise_type character varying(20) NOT NULL,
    amount numeric(10,2) NOT NULL,
    effective_date date NOT NULL,
    reason text,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT salary_raises_amount_check CHECK ((amount >= (0)::numeric)),
    CONSTRAINT salary_raises_raise_type_check CHECK (((raise_type)::text = ANY ((ARRAY['Fixed'::character varying, 'Percentage'::character varying])::text[])))
);


ALTER TABLE public.salary_raises OWNER TO postgres;

--
-- TOC entry 287 (class 1259 OID 205271)
-- Name: signal_type_responsibles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.signal_type_responsibles (
    type_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    assigned_by uuid,
    assigned_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.signal_type_responsibles OWNER TO postgres;

--
-- TOC entry 288 (class 1259 OID 205275)
-- Name: signal_types; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.signal_types (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.signal_types OWNER TO postgres;

--
-- TOC entry 289 (class 1259 OID 205282)
-- Name: signalisations_status_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.signalisations_status_history (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    signalisation_id uuid NOT NULL,
    status text NOT NULL,
    changed_by uuid,
    note text,
    changed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.signalisations_status_history OWNER TO postgres;

--
-- TOC entry 290 (class 1259 OID 205289)
-- Name: signalisations_views; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.signalisations_views (
    signalisation_id uuid NOT NULL,
    viewer_id uuid NOT NULL,
    viewed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.signalisations_views OWNER TO postgres;

--
-- TOC entry 254 (class 1259 OID 164204)
-- Name: subjects; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.subjects (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(255) NOT NULL
);


ALTER TABLE public.subjects OWNER TO postgres;

--
-- TOC entry 261 (class 1259 OID 180616)
-- Name: substitution_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.substitution_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invitation_id uuid NOT NULL,
    request_id uuid NOT NULL,
    substitute_employee_id uuid NOT NULL,
    absent_employee_id uuid NOT NULL,
    date date NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    minutes integer NOT NULL,
    status character varying(20) NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT substitution_history_status_check CHECK (((status)::text = ANY ((ARRAY['completed'::character varying, 'no_show'::character varying])::text[])))
);


ALTER TABLE public.substitution_history OWNER TO postgres;

--
-- TOC entry 6099 (class 0 OID 0)
-- Dependencies: 261
-- Name: TABLE substitution_history; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.substitution_history IS 'History of completed substitution work for tracking and reporting';


--
-- TOC entry 6100 (class 0 OID 0)
-- Dependencies: 261
-- Name: COLUMN substitution_history.substitute_employee_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.substitution_history.substitute_employee_id IS 'The teacher who completed the substitution';


--
-- TOC entry 6101 (class 0 OID 0)
-- Dependencies: 261
-- Name: COLUMN substitution_history.absent_employee_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.substitution_history.absent_employee_id IS 'The teacher who was absent and needed coverage';


--
-- TOC entry 6102 (class 0 OID 0)
-- Dependencies: 261
-- Name: COLUMN substitution_history.status; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.substitution_history.status IS 'completed = substitution was taught, no_show = teacher accepted but did not show up';


--
-- TOC entry 6103 (class 0 OID 0)
-- Dependencies: 261
-- Name: COLUMN substitution_history.completed_at; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.substitution_history.completed_at IS 'When the substitution was actually completed';


--
-- TOC entry 260 (class 1259 OID 172450)
-- Name: substitution_invitations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.substitution_invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    candidate_employee_id uuid NOT NULL,
    date date NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    total_minutes integer NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    responded_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    grade_level integer,
    CONSTRAINT substitution_invitations_grade_level_check CHECK (((grade_level >= 1) AND (grade_level <= 5))),
    CONSTRAINT substitution_invitations_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'accepted'::character varying, 'denied'::character varying, 'taught'::character varying, 'dropped'::character varying, 'disabled'::character varying])::text[])))
);


ALTER TABLE public.substitution_invitations OWNER TO postgres;

--
-- TOC entry 259 (class 1259 OID 172430)
-- Name: substitution_requests; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.substitution_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    absent_employee_id uuid NOT NULL,
    exception_id uuid,
    date date NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    total_minutes integer NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    institution character varying(255),
    education_level character varying(100),
    remaining_minutes integer DEFAULT 0,
    grade_level integer,
    CONSTRAINT chk_remaining_minutes CHECK ((remaining_minutes >= 0)),
    CONSTRAINT substitution_requests_grade_level_check CHECK (((grade_level >= 1) AND (grade_level <= 5))),
    CONSTRAINT substitution_requests_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'cancelled'::character varying, 'open'::character varying])::text[])))
);


ALTER TABLE public.substitution_requests OWNER TO postgres;

--
-- TOC entry 291 (class 1259 OID 205293)
-- Name: suggestion_attachments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.suggestion_attachments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    suggestion_id uuid NOT NULL,
    file_path text NOT NULL,
    file_name text,
    uploaded_by uuid,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.suggestion_attachments OWNER TO postgres;

--
-- TOC entry 292 (class 1259 OID 205300)
-- Name: suggestion_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.suggestion_history (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    suggestion_id uuid NOT NULL,
    changed_by uuid NOT NULL,
    old_status text,
    new_status text,
    comment text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.suggestion_history OWNER TO postgres;

--
-- TOC entry 293 (class 1259 OID 205307)
-- Name: suggestion_messages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.suggestion_messages (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    suggestion_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    sender_role text NOT NULL,
    body text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT suggestion_messages_sender_role_check CHECK ((sender_role = ANY (ARRAY['employee'::text, 'director'::text])))
);


ALTER TABLE public.suggestion_messages OWNER TO postgres;

--
-- TOC entry 294 (class 1259 OID 205315)
-- Name: suggestion_notifications; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.suggestion_notifications (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    suggestion_id uuid NOT NULL,
    recipient_id uuid,
    recipient_user_id uuid,
    message text NOT NULL,
    title text,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.suggestion_notifications OWNER TO postgres;

--
-- TOC entry 295 (class 1259 OID 205323)
-- Name: suggestion_types; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.suggestion_types (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.suggestion_types OWNER TO postgres;

--
-- TOC entry 274 (class 1259 OID 190239)
-- Name: task_assignments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.task_assignments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    task_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    assigned_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    completed_at timestamp without time zone,
    status character varying(20) DEFAULT 'Pending'::character varying NOT NULL,
    CONSTRAINT task_assignments_status_check CHECK (((status)::text = ANY (ARRAY[('Pending'::character varying)::text, ('In Progress'::character varying)::text, ('Completed'::character varying)::text])))
);


ALTER TABLE public.task_assignments OWNER TO postgres;

--
-- TOC entry 275 (class 1259 OID 190246)
-- Name: task_comments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.task_comments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    task_id uuid,
    employee_id uuid,
    comment text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.task_comments OWNER TO postgres;

--
-- TOC entry 224 (class 1259 OID 41216)
-- Name: tasks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tasks (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    type character varying(20) NOT NULL,
    assigned_to uuid,
    assigned_by uuid,
    due_date date,
    status character varying(20) DEFAULT 'Pending'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    priority character varying(20) DEFAULT 'Low'::character varying,
    CONSTRAINT tasks_status_check CHECK (((status)::text = ANY ((ARRAY['Pending'::character varying, 'In Progress'::character varying, 'Completed'::character varying, 'Not Done'::character varying])::text[]))),
    CONSTRAINT tasks_type_check CHECK (((type)::text = ANY ((ARRAY['Daily'::character varying, 'Special'::character varying])::text[])))
);


ALTER TABLE public.tasks OWNER TO postgres;

--
-- TOC entry 226 (class 1259 OID 58132)
-- Name: timetables; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.timetables (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(255) NOT NULL,
    type character varying(50) NOT NULL,
    timezone character varying(100) DEFAULT 'UTC'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    grade_level_mode character varying(20) DEFAULT 'none'::character varying,
    grade_level integer,
    CONSTRAINT timetables_grade_level_check CHECK (((grade_level >= 1) AND (grade_level <= 5))),
    CONSTRAINT timetables_grade_level_mode_check CHECK (((grade_level_mode)::text = ANY ((ARRAY['none'::character varying, 'single'::character varying, 'multiple'::character varying])::text[]))),
    CONSTRAINT timetables_type_check CHECK (((type)::text = ANY ((ARRAY['Template'::character varying, 'Concrete'::character varying])::text[])))
);


ALTER TABLE public.timetables OWNER TO postgres;

--
-- TOC entry 296 (class 1259 OID 205330)
-- Name: top_contributors; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.top_contributors AS
 SELECT (((e.first_name)::text || ' '::text) || (e.last_name)::text) AS employee_name,
    d.name AS department,
    count(s.id) AS suggestions_count,
    count(sig.id) AS signals_count,
    count(s.id) FILTER (WHERE (s.status = 'accepted'::text)) AS accepted_suggestions,
    rank() OVER (ORDER BY (count(s.id)) DESC) AS suggestion_rank
   FROM ((((public.employees e
     LEFT JOIN public.employee_departments ed ON ((ed.employee_id = e.id)))
     LEFT JOIN public.departments d ON ((d.id = ed.department_id)))
     LEFT JOIN public.suggestions s ON ((e.id = s.employee_id)))
     LEFT JOIN public.signalisations sig ON ((e.id = sig.created_by)))
  GROUP BY e.id, e.first_name, e.last_name, d.name
  ORDER BY (count(s.id)) DESC
 LIMIT 10;


ALTER VIEW public.top_contributors OWNER TO postgres;

--
-- TOC entry 297 (class 1259 OID 205335)
-- Name: trend_analysis; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.trend_analysis AS
 SELECT date_trunc('month'::text, suggestions.created_at) AS month,
    'suggestions'::text AS type,
    count(*) AS count,
    count(*) FILTER (WHERE (suggestions.status = 'accepted'::text)) AS accepted
   FROM public.suggestions
  GROUP BY (date_trunc('month'::text, suggestions.created_at))
UNION ALL
 SELECT date_trunc('month'::text, signalisations.created_at) AS month,
    'signals'::text AS type,
    count(*) AS count,
    count(*) FILTER (WHERE (signalisations.is_treated = true)) AS accepted
   FROM public.signalisations
  GROUP BY (date_trunc('month'::text, signalisations.created_at));


ALTER VIEW public.trend_analysis OWNER TO postgres;

--
-- TOC entry 229 (class 1259 OID 90317)
-- Name: uploads; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.uploads (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    file_name character varying(255) NOT NULL,
    original_name character varying(255) NOT NULL,
    mime_type character varying(100) NOT NULL,
    file_size bigint NOT NULL,
    storage_path character varying(1000) NOT NULL,
    storage_type character varying(20) DEFAULT 'file'::character varying,
    uploader_user_id uuid,
    uploaded_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone,
    deleted_by_user_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb
);


ALTER TABLE public.uploads OWNER TO postgres;

--
-- TOC entry 276 (class 1259 OID 190254)
-- Name: user_sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_sessions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    token_hash character varying(255) NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    last_activity timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.user_sessions OWNER TO postgres;

--
-- TOC entry 219 (class 1259 OID 41139)
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    username character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    role character varying(50) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT users_role_check CHECK (((role)::text = ANY ((ARRAY['HR_Manager'::character varying, 'Department_Responsible'::character varying, 'Employee'::character varying, 'Director'::character varying])::text[])))
);


ALTER TABLE public.users OWNER TO postgres;

--
-- TOC entry 5596 (class 2606 OID 123191)
-- Name: attendance_calculations_cache attendance_calculations_cache_employee_date_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance_calculations_cache
    ADD CONSTRAINT attendance_calculations_cache_employee_date_unique UNIQUE (employee_id, date);


--
-- TOC entry 5598 (class 2606 OID 123189)
-- Name: attendance_calculations_cache attendance_calculations_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance_calculations_cache
    ADD CONSTRAINT attendance_calculations_cache_pkey PRIMARY KEY (id);


--
-- TOC entry 5526 (class 2606 OID 90388)
-- Name: attendance_exceptions attendance_exceptions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance_exceptions
    ADD CONSTRAINT attendance_exceptions_pkey PRIMARY KEY (id);


--
-- TOC entry 5531 (class 2606 OID 90415)
-- Name: attendance_overrides attendance_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance_overrides
    ADD CONSTRAINT attendance_overrides_pkey PRIMARY KEY (id);


--
-- TOC entry 5516 (class 2606 OID 90338)
-- Name: attendance_punches attendance_punches_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance_punches
    ADD CONSTRAINT attendance_punches_pkey PRIMARY KEY (id);


--
-- TOC entry 5654 (class 2606 OID 190262)
-- Name: attendance attendance_records_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_records_pkey PRIMARY KEY (id);


--
-- TOC entry 5522 (class 2606 OID 90368)
-- Name: attendance_settings attendance_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance_settings
    ADD CONSTRAINT attendance_settings_pkey PRIMARY KEY (id);


--
-- TOC entry 5535 (class 2606 OID 90441)
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- TOC entry 5629 (class 2606 OID 164253)
-- Name: branch_levels branch_levels_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.branch_levels
    ADD CONSTRAINT branch_levels_pkey PRIMARY KEY (branch_id, level_id);


--
-- TOC entry 5625 (class 2606 OID 164248)
-- Name: branches branches_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_name_key UNIQUE (name);


--
-- TOC entry 5627 (class 2606 OID 164246)
-- Name: branches branches_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_pkey PRIMARY KEY (id);


--
-- TOC entry 5715 (class 2606 OID 205341)
-- Name: complaint_attachments complaint_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.complaint_attachments
    ADD CONSTRAINT complaint_attachments_pkey PRIMARY KEY (id);


--
-- TOC entry 5718 (class 2606 OID 205343)
-- Name: complaint_history complaint_history_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.complaint_history
    ADD CONSTRAINT complaint_history_pkey PRIMARY KEY (id);


--
-- TOC entry 5721 (class 2606 OID 205345)
-- Name: complaint_messages complaint_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.complaint_messages
    ADD CONSTRAINT complaint_messages_pkey PRIMARY KEY (id);


--
-- TOC entry 5724 (class 2606 OID 205347)
-- Name: complaint_notifications complaint_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.complaint_notifications
    ADD CONSTRAINT complaint_notifications_pkey PRIMARY KEY (id);


--
-- TOC entry 5728 (class 2606 OID 205349)
-- Name: complaint_types complaint_types_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.complaint_types
    ADD CONSTRAINT complaint_types_code_key UNIQUE (code);


--
-- TOC entry 5730 (class 2606 OID 205351)
-- Name: complaint_types complaint_types_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.complaint_types
    ADD CONSTRAINT complaint_types_pkey PRIMARY KEY (id);


--
-- TOC entry 5732 (class 2606 OID 205353)
-- Name: complaints complaints_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.complaints
    ADD CONSTRAINT complaints_pkey PRIMARY KEY (id);


--
-- TOC entry 5486 (class 2606 OID 190264)
-- Name: departments departments_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_name_key UNIQUE (name);


--
-- TOC entry 5488 (class 2606 OID 41191)
-- Name: departments departments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_pkey PRIMARY KEY (id);


--
-- TOC entry 5609 (class 2606 OID 164190)
-- Name: employee_compensations employee_compensations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_compensations
    ADD CONSTRAINT employee_compensations_pkey PRIMARY KEY (id);


--
-- TOC entry 5789 (class 2606 OID 221583)
-- Name: employee_contracts employee_contracts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_contracts
    ADD CONSTRAINT employee_contracts_pkey PRIMARY KEY (id);


--
-- TOC entry 5588 (class 2606 OID 114936)
-- Name: employee_daily_attendance employee_daily_attendance_employee_id_date_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_daily_attendance
    ADD CONSTRAINT employee_daily_attendance_employee_id_date_key UNIQUE (employee_id, date);


--
-- TOC entry 5590 (class 2606 OID 114934)
-- Name: employee_daily_attendance employee_daily_attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_daily_attendance
    ADD CONSTRAINT employee_daily_attendance_pkey PRIMARY KEY (id);


--
-- TOC entry 5582 (class 2606 OID 114908)
-- Name: employee_monthly_summaries employee_monthly_summaries_employee_id_month_year_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_monthly_summaries
    ADD CONSTRAINT employee_monthly_summaries_employee_id_month_year_key UNIQUE (employee_id, month, year);


--
-- TOC entry 5584 (class 2606 OID 114906)
-- Name: employee_monthly_summaries employee_monthly_summaries_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_monthly_summaries
    ADD CONSTRAINT employee_monthly_summaries_pkey PRIMARY KEY (id);


--
-- TOC entry 5575 (class 2606 OID 107203)
-- Name: employee_monthly_validations employee_monthly_validations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_monthly_validations
    ADD CONSTRAINT employee_monthly_validations_pkey PRIMARY KEY (id);


--
-- TOC entry 5577 (class 2606 OID 107205)
-- Name: employee_monthly_validations employee_monthly_validations_unique_employee_month_year; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_monthly_validations
    ADD CONSTRAINT employee_monthly_validations_unique_employee_month_year UNIQUE (employee_id, month, year);


--
-- TOC entry 5567 (class 2606 OID 139605)
-- Name: employee_overtime_hours employee_overtime_hours_employee_date_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_overtime_hours
    ADD CONSTRAINT employee_overtime_hours_employee_date_unique UNIQUE (employee_id, date);


--
-- TOC entry 5569 (class 2606 OID 107179)
-- Name: employee_overtime_hours employee_overtime_hours_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_overtime_hours
    ADD CONSTRAINT employee_overtime_hours_pkey PRIMARY KEY (id);


--
-- TOC entry 5657 (class 2606 OID 190268)
-- Name: employee_reports employee_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_reports
    ADD CONSTRAINT employee_reports_pkey PRIMARY KEY (id);


--
-- TOC entry 5560 (class 2606 OID 106722)
-- Name: employee_salary_adjustments employee_salary_adjustments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_salary_adjustments
    ADD CONSTRAINT employee_salary_adjustments_pkey PRIMARY KEY (id);


--
-- TOC entry 5509 (class 2606 OID 58166)
-- Name: employee_timetables employee_timetables_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_timetables
    ADD CONSTRAINT employee_timetables_pkey PRIMARY KEY (id);


--
-- TOC entry 5481 (class 2606 OID 41173)
-- Name: employees employees_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_pkey PRIMARY KEY (id);


--
-- TOC entry 5667 (class 2606 OID 190270)
-- Name: instruction_recipients instruction_recipients_instruction_id_employee_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.instruction_recipients
    ADD CONSTRAINT instruction_recipients_instruction_id_employee_id_key UNIQUE (instruction_id, employee_id);


--
-- TOC entry 5673 (class 2606 OID 190272)
-- Name: instructions instructions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.instructions
    ADD CONSTRAINT instructions_pkey PRIMARY KEY (id);


--
-- TOC entry 5623 (class 2606 OID 164224)
-- Name: level_subjects level_subjects_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.level_subjects
    ADD CONSTRAINT level_subjects_pkey PRIMARY KEY (level_id, subject_id);


--
-- TOC entry 5617 (class 2606 OID 164219)
-- Name: levels levels_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.levels
    ADD CONSTRAINT levels_name_key UNIQUE (name);


--
-- TOC entry 5619 (class 2606 OID 164217)
-- Name: levels levels_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.levels
    ADD CONSTRAINT levels_pkey PRIMARY KEY (id);


--
-- TOC entry 5785 (class 2606 OID 205641)
-- Name: localisations localisations_code_emplacement_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.localisations
    ADD CONSTRAINT localisations_code_emplacement_key UNIQUE (code_emplacement);


--
-- TOC entry 5787 (class 2606 OID 205639)
-- Name: localisations localisations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.localisations
    ADD CONSTRAINT localisations_pkey PRIMARY KEY (id);


--
-- TOC entry 5675 (class 2606 OID 190274)
-- Name: meeting_attendees meeting_attendees_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.meeting_attendees
    ADD CONSTRAINT meeting_attendees_pkey PRIMARY KEY (meeting_id, employee_id);


--
-- TOC entry 5679 (class 2606 OID 190276)
-- Name: meetings meetings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_pkey PRIMARY KEY (id);


--
-- TOC entry 5684 (class 2606 OID 190278)
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- TOC entry 5594 (class 2606 OID 123158)
-- Name: overtime_requests overtime_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.overtime_requests
    ADD CONSTRAINT overtime_requests_pkey PRIMARY KEY (id);


--
-- TOC entry 5601 (class 2606 OID 147813)
-- Name: payslip_batches payslip_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payslip_batches
    ADD CONSTRAINT payslip_batches_pkey PRIMARY KEY (id);


--
-- TOC entry 5606 (class 2606 OID 147831)
-- Name: payslips payslips_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payslips
    ADD CONSTRAINT payslips_pkey PRIMARY KEY (id);


--
-- TOC entry 5688 (class 2606 OID 190280)
-- Name: permission_requests permission_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.permission_requests
    ADD CONSTRAINT permission_requests_pkey PRIMARY KEY (id);


--
-- TOC entry 5499 (class 2606 OID 190282)
-- Name: position_salaries position_salaries_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.position_salaries
    ADD CONSTRAINT position_salaries_pkey PRIMARY KEY (id);


--
-- TOC entry 5477 (class 2606 OID 190284)
-- Name: positions positions_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.positions
    ADD CONSTRAINT positions_name_key UNIQUE (name);


--
-- TOC entry 5479 (class 2606 OID 190286)
-- Name: positions positions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.positions
    ADD CONSTRAINT positions_pkey PRIMARY KEY (id);


--
-- TOC entry 5549 (class 2606 OID 90511)
-- Name: punch_file_uploads punch_file_uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.punch_file_uploads
    ADD CONSTRAINT punch_file_uploads_pkey PRIMARY KEY (id);


--
-- TOC entry 5693 (class 2606 OID 190288)
-- Name: report_acknowledgements report_acknowledgements_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.report_acknowledgements
    ADD CONSTRAINT report_acknowledgements_pkey PRIMARY KEY (id);


--
-- TOC entry 5779 (class 2606 OID 205593)
-- Name: report_viewed_tracking report_viewed_tracking_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.report_viewed_tracking
    ADD CONSTRAINT report_viewed_tracking_pkey PRIMARY KEY (id);


--
-- TOC entry 5781 (class 2606 OID 205595)
-- Name: report_viewed_tracking report_viewed_tracking_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.report_viewed_tracking
    ADD CONSTRAINT report_viewed_tracking_unique UNIQUE (report_id, viewer_id);


--
-- TOC entry 5698 (class 2606 OID 190290)
-- Name: reports reports_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_pkey PRIMARY KEY (id);


--
-- TOC entry 5700 (class 2606 OID 190292)
-- Name: salaries salaries_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.salaries
    ADD CONSTRAINT salaries_pkey PRIMARY KEY (id);


--
-- TOC entry 5554 (class 2606 OID 90529)
-- Name: salary_calculations salary_calculations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.salary_calculations
    ADD CONSTRAINT salary_calculations_pkey PRIMARY KEY (id);


--
-- TOC entry 5702 (class 2606 OID 190294)
-- Name: salary_history salary_history_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.salary_history
    ADD CONSTRAINT salary_history_pkey PRIMARY KEY (id);


--
-- TOC entry 5556 (class 2606 OID 106711)
-- Name: salary_parameters salary_parameters_parameter_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.salary_parameters
    ADD CONSTRAINT salary_parameters_parameter_name_key UNIQUE (parameter_name);


--
-- TOC entry 5558 (class 2606 OID 106709)
-- Name: salary_parameters salary_parameters_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.salary_parameters
    ADD CONSTRAINT salary_parameters_pkey PRIMARY KEY (id);


--
-- TOC entry 5542 (class 2606 OID 90482)
-- Name: salary_payments salary_payments_employee_id_month_year_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.salary_payments
    ADD CONSTRAINT salary_payments_employee_id_month_year_key UNIQUE (employee_id, month, year);


--
-- TOC entry 5544 (class 2606 OID 90480)
-- Name: salary_payments salary_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.salary_payments
    ADD CONSTRAINT salary_payments_pkey PRIMARY KEY (id);


--
-- TOC entry 5539 (class 2606 OID 90458)
-- Name: salary_raises salary_raises_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.salary_raises
    ADD CONSTRAINT salary_raises_pkey PRIMARY KEY (id);


--
-- TOC entry 5748 (class 2606 OID 205355)
-- Name: signal_type_responsibles signal_type_responsibles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.signal_type_responsibles
    ADD CONSTRAINT signal_type_responsibles_pkey PRIMARY KEY (type_id, employee_id);


--
-- TOC entry 5750 (class 2606 OID 205357)
-- Name: signal_types signal_types_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.signal_types
    ADD CONSTRAINT signal_types_code_key UNIQUE (code);


--
-- TOC entry 5752 (class 2606 OID 205359)
-- Name: signal_types signal_types_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.signal_types
    ADD CONSTRAINT signal_types_pkey PRIMARY KEY (id);


--
-- TOC entry 5740 (class 2606 OID 205361)
-- Name: signalisations signalisations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.signalisations
    ADD CONSTRAINT signalisations_pkey PRIMARY KEY (id);


--
-- TOC entry 5754 (class 2606 OID 205363)
-- Name: signalisations_status_history signalisations_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.signalisations_status_history
    ADD CONSTRAINT signalisations_status_history_pkey PRIMARY KEY (id);


--
-- TOC entry 5757 (class 2606 OID 205365)
-- Name: signalisations_views signalisations_views_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.signalisations_views
    ADD CONSTRAINT signalisations_views_pkey PRIMARY KEY (signalisation_id, viewer_id);


--
-- TOC entry 5613 (class 2606 OID 164211)
-- Name: subjects subjects_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subjects
    ADD CONSTRAINT subjects_name_key UNIQUE (name);


--
-- TOC entry 5615 (class 2606 OID 164209)
-- Name: subjects subjects_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subjects
    ADD CONSTRAINT subjects_pkey PRIMARY KEY (id);


--
-- TOC entry 5652 (class 2606 OID 180623)
-- Name: substitution_history substitution_history_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.substitution_history
    ADD CONSTRAINT substitution_history_pkey PRIMARY KEY (id);


--
-- TOC entry 5644 (class 2606 OID 172458)
-- Name: substitution_invitations substitution_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.substitution_invitations
    ADD CONSTRAINT substitution_invitations_pkey PRIMARY KEY (id);


--
-- TOC entry 5646 (class 2606 OID 172460)
-- Name: substitution_invitations substitution_invitations_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.substitution_invitations
    ADD CONSTRAINT substitution_invitations_unique UNIQUE (request_id, candidate_employee_id, date, start_time);


--
-- TOC entry 5637 (class 2606 OID 172439)
-- Name: substitution_requests substitution_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.substitution_requests
    ADD CONSTRAINT substitution_requests_pkey PRIMARY KEY (id);


--
-- TOC entry 5760 (class 2606 OID 205367)
-- Name: suggestion_attachments suggestion_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.suggestion_attachments
    ADD CONSTRAINT suggestion_attachments_pkey PRIMARY KEY (id);


--
-- TOC entry 5763 (class 2606 OID 205369)
-- Name: suggestion_history suggestion_history_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.suggestion_history
    ADD CONSTRAINT suggestion_history_pkey PRIMARY KEY (id);


--
-- TOC entry 5766 (class 2606 OID 205371)
-- Name: suggestion_messages suggestion_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.suggestion_messages
    ADD CONSTRAINT suggestion_messages_pkey PRIMARY KEY (id);


--
-- TOC entry 5770 (class 2606 OID 205373)
-- Name: suggestion_notifications suggestion_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.suggestion_notifications
    ADD CONSTRAINT suggestion_notifications_pkey PRIMARY KEY (id);


--
-- TOC entry 5772 (class 2606 OID 205375)
-- Name: suggestion_types suggestion_types_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.suggestion_types
    ADD CONSTRAINT suggestion_types_code_key UNIQUE (code);


--
-- TOC entry 5774 (class 2606 OID 205377)
-- Name: suggestion_types suggestion_types_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.suggestion_types
    ADD CONSTRAINT suggestion_types_pkey PRIMARY KEY (id);


--
-- TOC entry 5745 (class 2606 OID 205379)
-- Name: suggestions suggestions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.suggestions
    ADD CONSTRAINT suggestions_pkey PRIMARY KEY (id);


--
-- TOC entry 5706 (class 2606 OID 190296)
-- Name: task_assignments task_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.task_assignments
    ADD CONSTRAINT task_assignments_pkey PRIMARY KEY (id);


--
-- TOC entry 5709 (class 2606 OID 190298)
-- Name: task_comments task_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.task_comments
    ADD CONSTRAINT task_comments_pkey PRIMARY KEY (id);


--
-- TOC entry 5495 (class 2606 OID 41228)
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- TOC entry 5507 (class 2606 OID 58152)
-- Name: timetable_intervals timetable_intervals_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.timetable_intervals
    ADD CONSTRAINT timetable_intervals_pkey PRIMARY KEY (id);


--
-- TOC entry 5502 (class 2606 OID 58141)
-- Name: timetables timetables_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.timetables
    ADD CONSTRAINT timetables_pkey PRIMARY KEY (id);


--
-- TOC entry 5695 (class 2606 OID 190300)
-- Name: report_acknowledgements unique_report_employee; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.report_acknowledgements
    ADD CONSTRAINT unique_report_employee UNIQUE (report_id, employee_id);


--
-- TOC entry 5514 (class 2606 OID 90327)
-- Name: uploads uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.uploads
    ADD CONSTRAINT uploads_pkey PRIMARY KEY (id);


--
-- TOC entry 5713 (class 2606 OID 190302)
-- Name: user_sessions user_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_pkey PRIMARY KEY (id);


--
-- TOC entry 5473 (class 2606 OID 41149)
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- TOC entry 5475 (class 2606 OID 190304)
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- TOC entry 5599 (class 1259 OID 123197)
-- Name: idx_attendance_calculations_cache_employee_month; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_attendance_calculations_cache_employee_month ON public.attendance_calculations_cache USING btree (employee_id, month, year);


--
-- TOC entry 5655 (class 1259 OID 190305)
-- Name: idx_attendance_employee_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_attendance_employee_id ON public.attendance USING btree (employee_id);


--
-- TOC entry 5527 (class 1259 OID 147803)
-- Name: idx_attendance_exceptions_document_upload_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_attendance_exceptions_document_upload_id ON public.attendance_exceptions USING btree (document_upload_id);


--
-- TOC entry 5528 (class 1259 OID 123244)
-- Name: idx_attendance_exceptions_employee_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_attendance_exceptions_employee_date ON public.attendance_exceptions USING btree (employee_id, date);


--
-- TOC entry 5529 (class 1259 OID 90405)
-- Name: idx_attendance_exceptions_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_attendance_exceptions_status ON public.attendance_exceptions USING btree (status);


--
-- TOC entry 5532 (class 1259 OID 90431)
-- Name: idx_attendance_overrides_employee_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_attendance_overrides_employee_date ON public.attendance_overrides USING btree (employee_id, date);


--
-- TOC entry 5533 (class 1259 OID 156001)
-- Name: idx_attendance_overrides_pending; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_attendance_overrides_pending ON public.attendance_overrides USING btree (employee_id, date) WHERE (pending_status IS NOT NULL);


--
-- TOC entry 5517 (class 1259 OID 107228)
-- Name: idx_attendance_punches_employee_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_attendance_punches_employee_id ON public.attendance_punches USING btree (employee_id);


--
-- TOC entry 5518 (class 1259 OID 90349)
-- Name: idx_attendance_punches_employee_time; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_attendance_punches_employee_time ON public.attendance_punches USING btree (employee_id, punch_time);


--
-- TOC entry 5519 (class 1259 OID 107229)
-- Name: idx_attendance_punches_punch_time; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_attendance_punches_punch_time ON public.attendance_punches USING btree (punch_time);


--
-- TOC entry 5520 (class 1259 OID 90350)
-- Name: idx_attendance_punches_upload_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_attendance_punches_upload_id ON public.attendance_punches USING btree (upload_id);


--
-- TOC entry 5536 (class 1259 OID 90447)
-- Name: idx_audit_logs_entity; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_audit_logs_entity ON public.audit_logs USING btree (entity_type, entity_id);


--
-- TOC entry 5630 (class 1259 OID 164264)
-- Name: idx_branch_levels_branch; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_branch_levels_branch ON public.branch_levels USING btree (branch_id);


--
-- TOC entry 5631 (class 1259 OID 164265)
-- Name: idx_branch_levels_level; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_branch_levels_level ON public.branch_levels USING btree (level_id);


--
-- TOC entry 5716 (class 1259 OID 205380)
-- Name: idx_complaint_attachments_complaint; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_complaint_attachments_complaint ON public.complaint_attachments USING btree (complaint_id, created_at DESC);


--
-- TOC entry 5719 (class 1259 OID 205381)
-- Name: idx_complaint_history_complaint; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_complaint_history_complaint ON public.complaint_history USING btree (complaint_id, created_at DESC);


--
-- TOC entry 5722 (class 1259 OID 205382)
-- Name: idx_complaint_messages_complaint; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_complaint_messages_complaint ON public.complaint_messages USING btree (complaint_id, created_at);


--
-- TOC entry 5725 (class 1259 OID 205383)
-- Name: idx_complaint_notifications_recipient; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_complaint_notifications_recipient ON public.complaint_notifications USING btree (recipient_id, is_read, created_at DESC);


--
-- TOC entry 5726 (class 1259 OID 205384)
-- Name: idx_complaint_notifications_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_complaint_notifications_user ON public.complaint_notifications USING btree (recipient_user_id, is_read, created_at DESC);


--
-- TOC entry 5733 (class 1259 OID 205385)
-- Name: idx_complaints_employee; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_complaints_employee ON public.complaints USING btree (employee_id, created_at DESC);


--
-- TOC entry 5734 (class 1259 OID 205386)
-- Name: idx_complaints_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_complaints_status ON public.complaints USING btree (status, created_at DESC);


--
-- TOC entry 5610 (class 1259 OID 164197)
-- Name: idx_employee_compensations_effective_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_employee_compensations_effective_date ON public.employee_compensations USING btree (effective_date);


--
-- TOC entry 5611 (class 1259 OID 164196)
-- Name: idx_employee_compensations_employee_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_employee_compensations_employee_id ON public.employee_compensations USING btree (employee_id);


--
-- TOC entry 5790 (class 1259 OID 221594)
-- Name: idx_employee_contracts_employee_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_employee_contracts_employee_id ON public.employee_contracts USING btree (employee_id);


--
-- TOC entry 5791 (class 1259 OID 221596)
-- Name: idx_employee_contracts_is_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_employee_contracts_is_active ON public.employee_contracts USING btree (is_active);


--
-- TOC entry 5792 (class 1259 OID 221595)
-- Name: idx_employee_contracts_start_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_employee_contracts_start_date ON public.employee_contracts USING btree (start_date);


--
-- TOC entry 5489 (class 1259 OID 190306)
-- Name: idx_employee_departments_department_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_employee_departments_department_id ON public.employee_departments USING btree (department_id);


--
-- TOC entry 5490 (class 1259 OID 190307)
-- Name: idx_employee_departments_employee_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_employee_departments_employee_id ON public.employee_departments USING btree (employee_id);


--
-- TOC entry 5585 (class 1259 OID 123213)
-- Name: idx_employee_monthly_summaries_calculation_method; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_employee_monthly_summaries_calculation_method ON public.employee_monthly_summaries USING btree (calculation_method);


--
-- TOC entry 5586 (class 1259 OID 123214)
-- Name: idx_employee_monthly_summaries_validated; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_employee_monthly_summaries_validated ON public.employee_monthly_summaries USING btree (is_validated, month, year);


--
-- TOC entry 5578 (class 1259 OID 107216)
-- Name: idx_employee_monthly_validations_employee_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_employee_monthly_validations_employee_id ON public.employee_monthly_validations USING btree (employee_id);


--
-- TOC entry 5579 (class 1259 OID 107217)
-- Name: idx_employee_monthly_validations_month_year; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_employee_monthly_validations_month_year ON public.employee_monthly_validations USING btree (month, year);


--
-- TOC entry 5580 (class 1259 OID 107218)
-- Name: idx_employee_monthly_validations_validated_by; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_employee_monthly_validations_validated_by ON public.employee_monthly_validations USING btree (validated_by_user_id);


--
-- TOC entry 5570 (class 1259 OID 107191)
-- Name: idx_employee_overtime_hours_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_employee_overtime_hours_date ON public.employee_overtime_hours USING btree (date);


--
-- TOC entry 5571 (class 1259 OID 107192)
-- Name: idx_employee_overtime_hours_employee_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_employee_overtime_hours_employee_date ON public.employee_overtime_hours USING btree (employee_id, date);


--
-- TOC entry 5572 (class 1259 OID 107190)
-- Name: idx_employee_overtime_hours_employee_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_employee_overtime_hours_employee_id ON public.employee_overtime_hours USING btree (employee_id);


--
-- TOC entry 5573 (class 1259 OID 123215)
-- Name: idx_employee_overtime_hours_employee_month; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_employee_overtime_hours_employee_month ON public.employee_overtime_hours USING btree (employee_id, EXTRACT(month FROM date), EXTRACT(year FROM date));


--
-- TOC entry 5658 (class 1259 OID 190308)
-- Name: idx_employee_reports_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_employee_reports_created ON public.employee_reports USING btree (created_at);


--
-- TOC entry 5659 (class 1259 OID 190309)
-- Name: idx_employee_reports_employee; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_employee_reports_employee ON public.employee_reports USING btree (employee_id);


--
-- TOC entry 5660 (class 1259 OID 190310)
-- Name: idx_employee_reports_recipient_ids; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_employee_reports_recipient_ids ON public.employee_reports USING gin (recipients);


--
-- TOC entry 5661 (class 1259 OID 190311)
-- Name: idx_employee_reports_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_employee_reports_status ON public.employee_reports USING btree (status);


--
-- TOC entry 5561 (class 1259 OID 107231)
-- Name: idx_employee_salary_adjustments_effective_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_employee_salary_adjustments_effective_date ON public.employee_salary_adjustments USING btree (effective_date);


--
-- TOC entry 5562 (class 1259 OID 106733)
-- Name: idx_employee_salary_adjustments_employee_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_employee_salary_adjustments_employee_date ON public.employee_salary_adjustments USING btree (employee_id, effective_date);


--
-- TOC entry 5563 (class 1259 OID 107230)
-- Name: idx_employee_salary_adjustments_employee_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_employee_salary_adjustments_employee_id ON public.employee_salary_adjustments USING btree (employee_id);


--
-- TOC entry 5564 (class 1259 OID 123216)
-- Name: idx_employee_salary_adjustments_employee_month; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_employee_salary_adjustments_employee_month ON public.employee_salary_adjustments USING btree (employee_id, EXTRACT(month FROM effective_date), EXTRACT(year FROM effective_date));


--
-- TOC entry 5565 (class 1259 OID 106734)
-- Name: idx_employee_salary_adjustments_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_employee_salary_adjustments_type ON public.employee_salary_adjustments USING btree (adjustment_type);


--
-- TOC entry 5510 (class 1259 OID 58181)
-- Name: idx_employee_timetables_effective_dates; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_employee_timetables_effective_dates ON public.employee_timetables USING btree (effective_from, effective_to);


--
-- TOC entry 5511 (class 1259 OID 58179)
-- Name: idx_employee_timetables_employee_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_employee_timetables_employee_id ON public.employee_timetables USING btree (employee_id);


--
-- TOC entry 5512 (class 1259 OID 58180)
-- Name: idx_employee_timetables_timetable_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_employee_timetables_timetable_id ON public.employee_timetables USING btree (timetable_id);


--
-- TOC entry 5482 (class 1259 OID 190312)
-- Name: idx_employees_email; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_employees_email ON public.employees USING btree (email);


--
-- TOC entry 5483 (class 1259 OID 190313)
-- Name: idx_employees_position_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_employees_position_id ON public.employees USING btree (position_id);


--
-- TOC entry 5484 (class 1259 OID 190314)
-- Name: idx_employees_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_employees_user_id ON public.employees USING btree (user_id);


--
-- TOC entry 5662 (class 1259 OID 190315)
-- Name: idx_instr_rec_acknowledged; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_instr_rec_acknowledged ON public.instruction_recipients USING btree (acknowledged);


--
-- TOC entry 5663 (class 1259 OID 190316)
-- Name: idx_instr_rec_completed; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_instr_rec_completed ON public.instruction_recipients USING btree (completed);


--
-- TOC entry 5664 (class 1259 OID 190317)
-- Name: idx_instr_rec_employee; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_instr_rec_employee ON public.instruction_recipients USING btree (employee_id);


--
-- TOC entry 5665 (class 1259 OID 190318)
-- Name: idx_instr_rec_instruction; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_instr_rec_instruction ON public.instruction_recipients USING btree (instruction_id);


--
-- TOC entry 5668 (class 1259 OID 190319)
-- Name: idx_instructions_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_instructions_created_at ON public.instructions USING btree (created_at DESC);


--
-- TOC entry 5669 (class 1259 OID 190320)
-- Name: idx_instructions_due_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_instructions_due_at ON public.instructions USING btree (due_at);


--
-- TOC entry 5670 (class 1259 OID 190321)
-- Name: idx_instructions_priority; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_instructions_priority ON public.instructions USING btree (priority);


--
-- TOC entry 5671 (class 1259 OID 190322)
-- Name: idx_instructions_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_instructions_status ON public.instructions USING btree (status);


--
-- TOC entry 5620 (class 1259 OID 164235)
-- Name: idx_level_subjects_level; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_level_subjects_level ON public.level_subjects USING btree (level_id);


--
-- TOC entry 5621 (class 1259 OID 164236)
-- Name: idx_level_subjects_subject; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_level_subjects_subject ON public.level_subjects USING btree (subject_id);


--
-- TOC entry 5782 (class 1259 OID 205642)
-- Name: idx_localisations_batiment; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_localisations_batiment ON public.localisations USING btree (batiment, etage);


--
-- TOC entry 5783 (class 1259 OID 205643)
-- Name: idx_localisations_code; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_localisations_code ON public.localisations USING btree (code_emplacement);


--
-- TOC entry 5676 (class 1259 OID 190323)
-- Name: idx_meetings_scheduled_by; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_meetings_scheduled_by ON public.meetings USING btree (scheduled_by);


--
-- TOC entry 5677 (class 1259 OID 190324)
-- Name: idx_meetings_start_time; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_meetings_start_time ON public.meetings USING btree (start_time);


--
-- TOC entry 5680 (class 1259 OID 190325)
-- Name: idx_notifications_recipient_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_notifications_recipient_id ON public.notifications USING btree (recipient_id);


--
-- TOC entry 5681 (class 1259 OID 190326)
-- Name: idx_notifications_user_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_notifications_user_created ON public.notifications USING btree (user_id, created_at DESC);


--
-- TOC entry 5682 (class 1259 OID 190327)
-- Name: idx_notifications_user_read; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_notifications_user_read ON public.notifications USING btree (user_id, is_read);


--
-- TOC entry 5591 (class 1259 OID 123174)
-- Name: idx_overtime_requests_employee_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_overtime_requests_employee_date ON public.overtime_requests USING btree (employee_id, date);


--
-- TOC entry 5592 (class 1259 OID 123175)
-- Name: idx_overtime_requests_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_overtime_requests_status ON public.overtime_requests USING btree (status);


--
-- TOC entry 5602 (class 1259 OID 147849)
-- Name: idx_payslips_batch; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_payslips_batch ON public.payslips USING btree (batch_id);


--
-- TOC entry 5603 (class 1259 OID 147848)
-- Name: idx_payslips_month_year; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_payslips_month_year ON public.payslips USING btree (year, month);


--
-- TOC entry 5685 (class 1259 OID 190328)
-- Name: idx_permission_requests_employee_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_permission_requests_employee_id ON public.permission_requests USING btree (employee_id);


--
-- TOC entry 5686 (class 1259 OID 190329)
-- Name: idx_permission_requests_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_permission_requests_status ON public.permission_requests USING btree (status);


--
-- TOC entry 5496 (class 1259 OID 190330)
-- Name: idx_position_salaries_effective_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_position_salaries_effective_date ON public.position_salaries USING btree (effective_date);


--
-- TOC entry 5497 (class 1259 OID 190331)
-- Name: idx_position_salaries_position_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_position_salaries_position_id ON public.position_salaries USING btree (position_id);


--
-- TOC entry 5545 (class 1259 OID 90544)
-- Name: idx_punch_file_uploads_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_punch_file_uploads_status ON public.punch_file_uploads USING btree (status);


--
-- TOC entry 5546 (class 1259 OID 90545)
-- Name: idx_punch_file_uploads_upload_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_punch_file_uploads_upload_date ON public.punch_file_uploads USING btree (upload_date);


--
-- TOC entry 5547 (class 1259 OID 90543)
-- Name: idx_punch_file_uploads_uploaded_by; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_punch_file_uploads_uploaded_by ON public.punch_file_uploads USING btree (uploaded_by_user_id);


--
-- TOC entry 5689 (class 1259 OID 190332)
-- Name: idx_report_acknowledgements_acknowledged; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_report_acknowledgements_acknowledged ON public.report_acknowledgements USING btree (acknowledged);


--
-- TOC entry 5690 (class 1259 OID 190333)
-- Name: idx_report_acknowledgements_employee_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_report_acknowledgements_employee_id ON public.report_acknowledgements USING btree (employee_id);


--
-- TOC entry 5691 (class 1259 OID 190334)
-- Name: idx_report_acknowledgements_report_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_report_acknowledgements_report_id ON public.report_acknowledgements USING btree (report_id);


--
-- TOC entry 5775 (class 1259 OID 205606)
-- Name: idx_report_viewed_tracking_report_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_report_viewed_tracking_report_id ON public.report_viewed_tracking USING btree (report_id);


--
-- TOC entry 5776 (class 1259 OID 205608)
-- Name: idx_report_viewed_tracking_viewed_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_report_viewed_tracking_viewed_at ON public.report_viewed_tracking USING btree (viewed_at DESC NULLS LAST);


--
-- TOC entry 5777 (class 1259 OID 205607)
-- Name: idx_report_viewed_tracking_viewer_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_report_viewed_tracking_viewer_id ON public.report_viewed_tracking USING btree (viewer_id);


--
-- TOC entry 5696 (class 1259 OID 190335)
-- Name: idx_reports_task_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_reports_task_id ON public.reports USING btree (task_id);


--
-- TOC entry 5550 (class 1259 OID 90546)
-- Name: idx_salary_calculations_employee_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_salary_calculations_employee_id ON public.salary_calculations USING btree (employee_id);


--
-- TOC entry 5551 (class 1259 OID 90547)
-- Name: idx_salary_calculations_period; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_salary_calculations_period ON public.salary_calculations USING btree (calculation_period_start, calculation_period_end);


--
-- TOC entry 5552 (class 1259 OID 90548)
-- Name: idx_salary_calculations_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_salary_calculations_status ON public.salary_calculations USING btree (status);


--
-- TOC entry 5540 (class 1259 OID 90493)
-- Name: idx_salary_payments_period; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_salary_payments_period ON public.salary_payments USING btree (year, month);


--
-- TOC entry 5537 (class 1259 OID 90469)
-- Name: idx_salary_raises_employee_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_salary_raises_employee_date ON public.salary_raises USING btree (employee_id, effective_date);


--
-- TOC entry 5746 (class 1259 OID 205387)
-- Name: idx_signal_type_responsibles_employee; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_signal_type_responsibles_employee ON public.signal_type_responsibles USING btree (employee_id);


--
-- TOC entry 5735 (class 1259 OID 205388)
-- Name: idx_signalisations_created_by; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_signalisations_created_by ON public.signalisations USING btree (created_by, created_at DESC);


--
-- TOC entry 5736 (class 1259 OID 205389)
-- Name: idx_signalisations_localisation_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_signalisations_localisation_id ON public.signalisations USING btree (localisation_id);


--
-- TOC entry 5737 (class 1259 OID 205390)
-- Name: idx_signalisations_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_signalisations_status ON public.signalisations USING btree (is_treated, created_at DESC);


--
-- TOC entry 5738 (class 1259 OID 205391)
-- Name: idx_signalisations_type_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_signalisations_type_created ON public.signalisations USING btree (type_id, created_at DESC);


--
-- TOC entry 5755 (class 1259 OID 205392)
-- Name: idx_signalisations_views_viewer; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_signalisations_views_viewer ON public.signalisations_views USING btree (viewer_id);


--
-- TOC entry 5647 (class 1259 OID 180645)
-- Name: idx_substitution_history_absent; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_substitution_history_absent ON public.substitution_history USING btree (absent_employee_id);


--
-- TOC entry 5648 (class 1259 OID 180646)
-- Name: idx_substitution_history_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_substitution_history_date ON public.substitution_history USING btree (date);


--
-- TOC entry 5649 (class 1259 OID 180647)
-- Name: idx_substitution_history_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_substitution_history_status ON public.substitution_history USING btree (status);


--
-- TOC entry 5650 (class 1259 OID 180644)
-- Name: idx_substitution_history_substitute; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_substitution_history_substitute ON public.substitution_history USING btree (substitute_employee_id);


--
-- TOC entry 5638 (class 1259 OID 172474)
-- Name: idx_substitution_invitations_candidate; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_substitution_invitations_candidate ON public.substitution_invitations USING btree (candidate_employee_id);


--
-- TOC entry 5639 (class 1259 OID 172477)
-- Name: idx_substitution_invitations_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_substitution_invitations_date ON public.substitution_invitations USING btree (date);


--
-- TOC entry 5640 (class 1259 OID 180732)
-- Name: idx_substitution_invitations_grade_level; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_substitution_invitations_grade_level ON public.substitution_invitations USING btree (grade_level);


--
-- TOC entry 5641 (class 1259 OID 172475)
-- Name: idx_substitution_invitations_request; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_substitution_invitations_request ON public.substitution_invitations USING btree (request_id);


--
-- TOC entry 5642 (class 1259 OID 172476)
-- Name: idx_substitution_invitations_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_substitution_invitations_status ON public.substitution_invitations USING btree (status);


--
-- TOC entry 5632 (class 1259 OID 172471)
-- Name: idx_substitution_requests_absent_employee; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_substitution_requests_absent_employee ON public.substitution_requests USING btree (absent_employee_id);


--
-- TOC entry 5633 (class 1259 OID 172472)
-- Name: idx_substitution_requests_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_substitution_requests_date ON public.substitution_requests USING btree (date);


--
-- TOC entry 5634 (class 1259 OID 180731)
-- Name: idx_substitution_requests_grade_level; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_substitution_requests_grade_level ON public.substitution_requests USING btree (grade_level);


--
-- TOC entry 5635 (class 1259 OID 172473)
-- Name: idx_substitution_requests_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_substitution_requests_status ON public.substitution_requests USING btree (status);


--
-- TOC entry 5758 (class 1259 OID 205393)
-- Name: idx_suggestion_attachments_suggestion; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_suggestion_attachments_suggestion ON public.suggestion_attachments USING btree (suggestion_id, created_at DESC);


--
-- TOC entry 5761 (class 1259 OID 205394)
-- Name: idx_suggestion_history_suggestion; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_suggestion_history_suggestion ON public.suggestion_history USING btree (suggestion_id, created_at DESC);


--
-- TOC entry 5764 (class 1259 OID 205395)
-- Name: idx_suggestion_messages_suggestion; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_suggestion_messages_suggestion ON public.suggestion_messages USING btree (suggestion_id, created_at);


--
-- TOC entry 5767 (class 1259 OID 205396)
-- Name: idx_suggestion_notifications_recipient; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_suggestion_notifications_recipient ON public.suggestion_notifications USING btree (recipient_id, is_read, created_at DESC);


--
-- TOC entry 5768 (class 1259 OID 205397)
-- Name: idx_suggestion_notifications_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_suggestion_notifications_user ON public.suggestion_notifications USING btree (recipient_user_id, is_read, created_at DESC);


--
-- TOC entry 5741 (class 1259 OID 205398)
-- Name: idx_suggestions_department; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_suggestions_department ON public.suggestions USING btree (department_id);


--
-- TOC entry 5742 (class 1259 OID 205399)
-- Name: idx_suggestions_employee; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_suggestions_employee ON public.suggestions USING btree (employee_id, created_at DESC);


--
-- TOC entry 5743 (class 1259 OID 205400)
-- Name: idx_suggestions_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_suggestions_status ON public.suggestions USING btree (status, created_at DESC);


--
-- TOC entry 5703 (class 1259 OID 190336)
-- Name: idx_task_assignments_employee_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_task_assignments_employee_id ON public.task_assignments USING btree (employee_id);


--
-- TOC entry 5704 (class 1259 OID 190337)
-- Name: idx_task_assignments_task_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_task_assignments_task_id ON public.task_assignments USING btree (task_id);


--
-- TOC entry 5707 (class 1259 OID 190338)
-- Name: idx_task_comments_task_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_task_comments_task_id ON public.task_comments USING btree (task_id);


--
-- TOC entry 5491 (class 1259 OID 190339)
-- Name: idx_tasks_assigned_by; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tasks_assigned_by ON public.tasks USING btree (assigned_by);


--
-- TOC entry 5492 (class 1259 OID 41386)
-- Name: idx_tasks_assigned_to; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tasks_assigned_to ON public.tasks USING btree (assigned_to);


--
-- TOC entry 5493 (class 1259 OID 190340)
-- Name: idx_tasks_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tasks_status ON public.tasks USING btree (status);


--
-- TOC entry 5503 (class 1259 OID 180730)
-- Name: idx_timetable_intervals_grade_level; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_timetable_intervals_grade_level ON public.timetable_intervals USING btree (grade_level);


--
-- TOC entry 5504 (class 1259 OID 58177)
-- Name: idx_timetable_intervals_timetable_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_timetable_intervals_timetable_id ON public.timetable_intervals USING btree (timetable_id);


--
-- TOC entry 5505 (class 1259 OID 58178)
-- Name: idx_timetable_intervals_weekday; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_timetable_intervals_weekday ON public.timetable_intervals USING btree (weekday);


--
-- TOC entry 5500 (class 1259 OID 180729)
-- Name: idx_timetables_grade_level_mode; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_timetables_grade_level_mode ON public.timetables USING btree (grade_level_mode);


--
-- TOC entry 5710 (class 1259 OID 190341)
-- Name: idx_user_sessions_token_hash; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_user_sessions_token_hash ON public.user_sessions USING btree (token_hash);


--
-- TOC entry 5711 (class 1259 OID 190342)
-- Name: idx_user_sessions_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_user_sessions_user_id ON public.user_sessions USING btree (user_id);


--
-- TOC entry 5471 (class 1259 OID 190343)
-- Name: idx_users_username; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_username ON public.users USING btree (username);


--
-- TOC entry 5604 (class 1259 OID 147847)
-- Name: payslips_employee_period_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX payslips_employee_period_unique ON public.payslips USING btree (employee_id, month, year) WHERE (employee_id IS NOT NULL);


--
-- TOC entry 5523 (class 1259 OID 90375)
-- Name: uniq_attendance_settings_dept; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uniq_attendance_settings_dept ON public.attendance_settings USING btree (scope, department_id) WHERE ((scope)::text = 'department'::text);


--
-- TOC entry 5524 (class 1259 OID 90374)
-- Name: uniq_attendance_settings_global; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uniq_attendance_settings_global ON public.attendance_settings USING btree (scope) WHERE ((scope)::text = 'global'::text);


--
-- TOC entry 5607 (class 1259 OID 147850)
-- Name: ux_payslips_emp_month_year; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX ux_payslips_emp_month_year ON public.payslips USING btree (employee_id, month, year);


--
-- TOC entry 5903 (class 2620 OID 114963)
-- Name: employee_daily_attendance set_updated_at_employee_daily_attendance; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER set_updated_at_employee_daily_attendance BEFORE UPDATE ON public.employee_daily_attendance FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- TOC entry 5902 (class 2620 OID 114962)
-- Name: employee_monthly_summaries set_updated_at_employee_monthly_summaries; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER set_updated_at_employee_monthly_summaries BEFORE UPDATE ON public.employee_monthly_summaries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- TOC entry 5898 (class 2620 OID 172421)
-- Name: attendance_exceptions trg_attendance_exceptions_status_change; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_attendance_exceptions_status_change AFTER UPDATE ON public.attendance_exceptions FOR EACH ROW EXECUTE FUNCTION public.on_attendance_exception_status_change();


--
-- TOC entry 5895 (class 2620 OID 190344)
-- Name: tasks trg_check_task_completion; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_check_task_completion BEFORE UPDATE OF status ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.check_task_completion();


--
-- TOC entry 5908 (class 2620 OID 190345)
-- Name: instructions trg_instructions_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_instructions_updated_at BEFORE UPDATE ON public.instructions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- TOC entry 5912 (class 2620 OID 190346)
-- Name: task_assignments trg_update_task_status; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_update_task_status AFTER UPDATE OF status ON public.task_assignments FOR EACH ROW WHEN (((new.status)::text = 'Completed'::text)) EXECUTE FUNCTION public.update_task_status_on_completion();


--
-- TOC entry 5907 (class 2620 OID 190347)
-- Name: attendance update_attendance_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_attendance_updated_at BEFORE UPDATE ON public.attendance FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- TOC entry 5906 (class 2620 OID 164266)
-- Name: branches update_branches_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_branches_updated_at BEFORE UPDATE ON public.branches FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- TOC entry 5894 (class 2620 OID 190348)
-- Name: departments update_departments_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_departments_updated_at BEFORE UPDATE ON public.departments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- TOC entry 5905 (class 2620 OID 164198)
-- Name: employee_compensations update_employee_compensations_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_employee_compensations_updated_at BEFORE UPDATE ON public.employee_compensations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- TOC entry 5901 (class 2620 OID 106735)
-- Name: employee_salary_adjustments update_employee_salary_adjustments_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_employee_salary_adjustments_updated_at BEFORE UPDATE ON public.employee_salary_adjustments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- TOC entry 5893 (class 2620 OID 190349)
-- Name: employees update_employees_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_employees_updated_at BEFORE UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- TOC entry 5909 (class 2620 OID 190350)
-- Name: meetings update_meetings_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_meetings_updated_at BEFORE UPDATE ON public.meetings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- TOC entry 5904 (class 2620 OID 123176)
-- Name: overtime_requests update_overtime_requests_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_overtime_requests_updated_at BEFORE UPDATE ON public.overtime_requests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- TOC entry 5910 (class 2620 OID 190351)
-- Name: permission_requests update_permission_requests_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_permission_requests_updated_at BEFORE UPDATE ON public.permission_requests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- TOC entry 5897 (class 2620 OID 190352)
-- Name: position_salaries update_position_salaries_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_position_salaries_updated_at BEFORE UPDATE ON public.position_salaries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- TOC entry 5899 (class 2620 OID 90551)
-- Name: punch_file_uploads update_punch_file_uploads_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_punch_file_uploads_updated_at BEFORE UPDATE ON public.punch_file_uploads FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- TOC entry 5911 (class 2620 OID 190353)
-- Name: salaries update_salaries_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_salaries_updated_at BEFORE UPDATE ON public.salaries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- TOC entry 5900 (class 2620 OID 90552)
-- Name: salary_calculations update_salary_calculations_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_salary_calculations_updated_at BEFORE UPDATE ON public.salary_calculations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- TOC entry 5896 (class 2620 OID 190354)
-- Name: tasks update_tasks_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- TOC entry 5913 (class 2620 OID 190355)
-- Name: user_sessions update_user_sessions_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_user_sessions_updated_at BEFORE UPDATE ON public.user_sessions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- TOC entry 5892 (class 2620 OID 190356)
-- Name: users update_users_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- TOC entry 5832 (class 2606 OID 123192)
-- Name: attendance_calculations_cache attendance_calculations_cache_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance_calculations_cache
    ADD CONSTRAINT attendance_calculations_cache_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id);


--
-- TOC entry 5805 (class 2606 OID 147798)
-- Name: attendance_exceptions attendance_exceptions_document_upload_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance_exceptions
    ADD CONSTRAINT attendance_exceptions_document_upload_id_fkey FOREIGN KEY (document_upload_id) REFERENCES public.uploads(id) ON DELETE SET NULL;


--
-- TOC entry 5806 (class 2606 OID 123245)
-- Name: attendance_exceptions attendance_exceptions_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance_exceptions
    ADD CONSTRAINT attendance_exceptions_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- TOC entry 5807 (class 2606 OID 90399)
-- Name: attendance_exceptions attendance_exceptions_reviewed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance_exceptions
    ADD CONSTRAINT attendance_exceptions_reviewed_by_user_id_fkey FOREIGN KEY (reviewed_by_user_id) REFERENCES public.users(id);


--
-- TOC entry 5808 (class 2606 OID 90394)
-- Name: attendance_exceptions attendance_exceptions_submitted_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance_exceptions
    ADD CONSTRAINT attendance_exceptions_submitted_by_user_id_fkey FOREIGN KEY (submitted_by_user_id) REFERENCES public.users(id);


--
-- TOC entry 5809 (class 2606 OID 90426)
-- Name: attendance_overrides attendance_overrides_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance_overrides
    ADD CONSTRAINT attendance_overrides_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);


--
-- TOC entry 5810 (class 2606 OID 90416)
-- Name: attendance_overrides attendance_overrides_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance_overrides
    ADD CONSTRAINT attendance_overrides_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- TOC entry 5811 (class 2606 OID 90421)
-- Name: attendance_overrides attendance_overrides_exception_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance_overrides
    ADD CONSTRAINT attendance_overrides_exception_id_fkey FOREIGN KEY (exception_id) REFERENCES public.attendance_exceptions(id) ON DELETE SET NULL;


--
-- TOC entry 5802 (class 2606 OID 90339)
-- Name: attendance_punches attendance_punches_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance_punches
    ADD CONSTRAINT attendance_punches_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- TOC entry 5803 (class 2606 OID 90344)
-- Name: attendance_punches attendance_punches_upload_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance_punches
    ADD CONSTRAINT attendance_punches_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES public.uploads(id) ON DELETE SET NULL;


--
-- TOC entry 5850 (class 2606 OID 190357)
-- Name: attendance attendance_records_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_records_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id);


--
-- TOC entry 5804 (class 2606 OID 90369)
-- Name: attendance_settings attendance_settings_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance_settings
    ADD CONSTRAINT attendance_settings_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id);


--
-- TOC entry 5812 (class 2606 OID 90442)
-- Name: audit_logs audit_logs_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- TOC entry 5840 (class 2606 OID 164254)
-- Name: branch_levels branch_levels_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.branch_levels
    ADD CONSTRAINT branch_levels_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- TOC entry 5841 (class 2606 OID 164259)
-- Name: branch_levels branch_levels_level_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.branch_levels
    ADD CONSTRAINT branch_levels_level_id_fkey FOREIGN KEY (level_id) REFERENCES public.levels(id) ON DELETE CASCADE;


--
-- TOC entry 5867 (class 2606 OID 205401)
-- Name: complaint_attachments complaint_attachments_complaint_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.complaint_attachments
    ADD CONSTRAINT complaint_attachments_complaint_id_fkey FOREIGN KEY (complaint_id) REFERENCES public.complaints(id) ON DELETE CASCADE;


--
-- TOC entry 5868 (class 2606 OID 205416)
-- Name: complaint_history complaint_history_complaint_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.complaint_history
    ADD CONSTRAINT complaint_history_complaint_id_fkey FOREIGN KEY (complaint_id) REFERENCES public.complaints(id) ON DELETE CASCADE;


--
-- TOC entry 5869 (class 2606 OID 205421)
-- Name: complaint_messages complaint_messages_complaint_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.complaint_messages
    ADD CONSTRAINT complaint_messages_complaint_id_fkey FOREIGN KEY (complaint_id) REFERENCES public.complaints(id) ON DELETE CASCADE;


--
-- TOC entry 5870 (class 2606 OID 205431)
-- Name: complaint_notifications complaint_notifications_complaint_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.complaint_notifications
    ADD CONSTRAINT complaint_notifications_complaint_id_fkey FOREIGN KEY (complaint_id) REFERENCES public.complaints(id) ON DELETE CASCADE;


--
-- TOC entry 5871 (class 2606 OID 205446)
-- Name: complaints complaints_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.complaints
    ADD CONSTRAINT complaints_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id);


--
-- TOC entry 5872 (class 2606 OID 205456)
-- Name: complaints complaints_handled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.complaints
    ADD CONSTRAINT complaints_handled_by_fkey FOREIGN KEY (handled_by) REFERENCES public.employees(id);


--
-- TOC entry 5873 (class 2606 OID 205461)
-- Name: complaints complaints_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.complaints
    ADD CONSTRAINT complaints_type_id_fkey FOREIGN KEY (type_id) REFERENCES public.complaint_types(id) ON DELETE RESTRICT;


--
-- TOC entry 5837 (class 2606 OID 164191)
-- Name: employee_compensations employee_compensations_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_compensations
    ADD CONSTRAINT employee_compensations_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- TOC entry 5890 (class 2606 OID 221584)
-- Name: employee_contracts employee_contracts_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_contracts
    ADD CONSTRAINT employee_contracts_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- TOC entry 5891 (class 2606 OID 221589)
-- Name: employee_contracts employee_contracts_position_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_contracts
    ADD CONSTRAINT employee_contracts_position_id_fkey FOREIGN KEY (position_id) REFERENCES public.positions(id);


--
-- TOC entry 5826 (class 2606 OID 114957)
-- Name: employee_daily_attendance employee_daily_attendance_audit_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_daily_attendance
    ADD CONSTRAINT employee_daily_attendance_audit_entry_id_fkey FOREIGN KEY (audit_entry_id) REFERENCES public.audit_logs(id);


--
-- TOC entry 5827 (class 2606 OID 114937)
-- Name: employee_daily_attendance employee_daily_attendance_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_daily_attendance
    ADD CONSTRAINT employee_daily_attendance_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id);


--
-- TOC entry 5828 (class 2606 OID 114942)
-- Name: employee_daily_attendance employee_daily_attendance_validated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_daily_attendance
    ADD CONSTRAINT employee_daily_attendance_validated_by_user_id_fkey FOREIGN KEY (validated_by_user_id) REFERENCES public.users(id);


--
-- TOC entry 5795 (class 2606 OID 190367)
-- Name: employee_departments employee_departments_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_departments
    ADD CONSTRAINT employee_departments_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE CASCADE;


--
-- TOC entry 5823 (class 2606 OID 114952)
-- Name: employee_monthly_summaries employee_monthly_summaries_audit_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_monthly_summaries
    ADD CONSTRAINT employee_monthly_summaries_audit_entry_id_fkey FOREIGN KEY (audit_entry_id) REFERENCES public.audit_logs(id);


--
-- TOC entry 5824 (class 2606 OID 114909)
-- Name: employee_monthly_summaries employee_monthly_summaries_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_monthly_summaries
    ADD CONSTRAINT employee_monthly_summaries_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id);


--
-- TOC entry 5825 (class 2606 OID 114914)
-- Name: employee_monthly_summaries employee_monthly_summaries_validated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_monthly_summaries
    ADD CONSTRAINT employee_monthly_summaries_validated_by_user_id_fkey FOREIGN KEY (validated_by_user_id) REFERENCES public.users(id);


--
-- TOC entry 5821 (class 2606 OID 107206)
-- Name: employee_monthly_validations employee_monthly_validations_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_monthly_validations
    ADD CONSTRAINT employee_monthly_validations_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- TOC entry 5822 (class 2606 OID 107211)
-- Name: employee_monthly_validations employee_monthly_validations_validated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_monthly_validations
    ADD CONSTRAINT employee_monthly_validations_validated_by_user_id_fkey FOREIGN KEY (validated_by_user_id) REFERENCES public.users(id);


--
-- TOC entry 5819 (class 2606 OID 107185)
-- Name: employee_overtime_hours employee_overtime_hours_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_overtime_hours
    ADD CONSTRAINT employee_overtime_hours_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);


--
-- TOC entry 5820 (class 2606 OID 107180)
-- Name: employee_overtime_hours employee_overtime_hours_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_overtime_hours
    ADD CONSTRAINT employee_overtime_hours_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- TOC entry 5817 (class 2606 OID 106728)
-- Name: employee_salary_adjustments employee_salary_adjustments_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_salary_adjustments
    ADD CONSTRAINT employee_salary_adjustments_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);


--
-- TOC entry 5818 (class 2606 OID 106723)
-- Name: employee_salary_adjustments employee_salary_adjustments_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_salary_adjustments
    ADD CONSTRAINT employee_salary_adjustments_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- TOC entry 5800 (class 2606 OID 58167)
-- Name: employee_timetables employee_timetables_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_timetables
    ADD CONSTRAINT employee_timetables_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- TOC entry 5801 (class 2606 OID 58172)
-- Name: employee_timetables employee_timetables_timetable_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_timetables
    ADD CONSTRAINT employee_timetables_timetable_id_fkey FOREIGN KEY (timetable_id) REFERENCES public.timetables(id) ON DELETE CASCADE;


--
-- TOC entry 5793 (class 2606 OID 190382)
-- Name: employees employees_position_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_position_id_fkey FOREIGN KEY (position_id) REFERENCES public.positions(id);


--
-- TOC entry 5794 (class 2606 OID 190387)
-- Name: employees employees_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- TOC entry 5860 (class 2606 OID 190397)
-- Name: report_acknowledgements fk_employee; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.report_acknowledgements
    ADD CONSTRAINT fk_employee FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- TOC entry 5861 (class 2606 OID 190402)
-- Name: report_acknowledgements fk_report; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.report_acknowledgements
    ADD CONSTRAINT fk_report FOREIGN KEY (report_id) REFERENCES public.employee_reports(id) ON DELETE CASCADE;


--
-- TOC entry 5851 (class 2606 OID 190417)
-- Name: instruction_recipients instruction_recipients_instruction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.instruction_recipients
    ADD CONSTRAINT instruction_recipients_instruction_id_fkey FOREIGN KEY (instruction_id) REFERENCES public.instructions(id) ON DELETE CASCADE;


--
-- TOC entry 5852 (class 2606 OID 190422)
-- Name: instructions instructions_created_by_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.instructions
    ADD CONSTRAINT instructions_created_by_employee_id_fkey FOREIGN KEY (created_by_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- TOC entry 5853 (class 2606 OID 190427)
-- Name: instructions instructions_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.instructions
    ADD CONSTRAINT instructions_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- TOC entry 5838 (class 2606 OID 164225)
-- Name: level_subjects level_subjects_level_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.level_subjects
    ADD CONSTRAINT level_subjects_level_id_fkey FOREIGN KEY (level_id) REFERENCES public.levels(id) ON DELETE CASCADE;


--
-- TOC entry 5839 (class 2606 OID 164230)
-- Name: level_subjects level_subjects_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.level_subjects
    ADD CONSTRAINT level_subjects_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subjects(id) ON DELETE CASCADE;


--
-- TOC entry 5854 (class 2606 OID 190432)
-- Name: meeting_attendees meeting_attendees_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.meeting_attendees
    ADD CONSTRAINT meeting_attendees_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- TOC entry 5855 (class 2606 OID 190437)
-- Name: meeting_attendees meeting_attendees_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.meeting_attendees
    ADD CONSTRAINT meeting_attendees_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.meetings(id) ON DELETE CASCADE;


--
-- TOC entry 5856 (class 2606 OID 190442)
-- Name: meetings meetings_scheduled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_scheduled_by_fkey FOREIGN KEY (scheduled_by) REFERENCES public.employees(id);


--
-- TOC entry 5857 (class 2606 OID 190452)
-- Name: notifications notifications_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.employees(id);


--
-- TOC entry 5829 (class 2606 OID 123159)
-- Name: overtime_requests overtime_requests_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.overtime_requests
    ADD CONSTRAINT overtime_requests_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id);


--
-- TOC entry 5830 (class 2606 OID 123169)
-- Name: overtime_requests overtime_requests_reviewed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.overtime_requests
    ADD CONSTRAINT overtime_requests_reviewed_by_user_id_fkey FOREIGN KEY (reviewed_by_user_id) REFERENCES public.users(id);


--
-- TOC entry 5831 (class 2606 OID 123164)
-- Name: overtime_requests overtime_requests_submitted_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.overtime_requests
    ADD CONSTRAINT overtime_requests_submitted_by_user_id_fkey FOREIGN KEY (submitted_by_user_id) REFERENCES public.users(id);


--
-- TOC entry 5833 (class 2606 OID 147814)
-- Name: payslip_batches payslip_batches_uploaded_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payslip_batches
    ADD CONSTRAINT payslip_batches_uploaded_by_user_id_fkey FOREIGN KEY (uploaded_by_user_id) REFERENCES public.users(id);


--
-- TOC entry 5834 (class 2606 OID 147842)
-- Name: payslips payslips_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payslips
    ADD CONSTRAINT payslips_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.payslip_batches(id) ON DELETE SET NULL;


--
-- TOC entry 5835 (class 2606 OID 147832)
-- Name: payslips payslips_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payslips
    ADD CONSTRAINT payslips_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id);


--
-- TOC entry 5836 (class 2606 OID 147837)
-- Name: payslips payslips_upload_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payslips
    ADD CONSTRAINT payslips_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES public.uploads(id) ON DELETE SET NULL;


--
-- TOC entry 5858 (class 2606 OID 190457)
-- Name: permission_requests permission_requests_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.permission_requests
    ADD CONSTRAINT permission_requests_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id);


--
-- TOC entry 5859 (class 2606 OID 190462)
-- Name: permission_requests permission_requests_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.permission_requests
    ADD CONSTRAINT permission_requests_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.employees(id);


--
-- TOC entry 5798 (class 2606 OID 190467)
-- Name: position_salaries position_salaries_position_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.position_salaries
    ADD CONSTRAINT position_salaries_position_id_fkey FOREIGN KEY (position_id) REFERENCES public.positions(id) ON DELETE CASCADE;


--
-- TOC entry 5888 (class 2606 OID 205596)
-- Name: report_viewed_tracking report_viewed_tracking_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.report_viewed_tracking
    ADD CONSTRAINT report_viewed_tracking_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.employee_reports(id) ON DELETE CASCADE;


--
-- TOC entry 5889 (class 2606 OID 205601)
-- Name: report_viewed_tracking report_viewed_tracking_viewer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.report_viewed_tracking
    ADD CONSTRAINT report_viewed_tracking_viewer_id_fkey FOREIGN KEY (viewer_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- TOC entry 5862 (class 2606 OID 190472)
-- Name: salaries salaries_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.salaries
    ADD CONSTRAINT salaries_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id);


--
-- TOC entry 5863 (class 2606 OID 190477)
-- Name: salaries salaries_position_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.salaries
    ADD CONSTRAINT salaries_position_id_fkey FOREIGN KEY (position_id) REFERENCES public.positions(id);


--
-- TOC entry 5864 (class 2606 OID 190482)
-- Name: salary_history salary_history_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.salary_history
    ADD CONSTRAINT salary_history_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id);


--
-- TOC entry 5865 (class 2606 OID 190487)
-- Name: salary_history salary_history_salary_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.salary_history
    ADD CONSTRAINT salary_history_salary_id_fkey FOREIGN KEY (salary_id) REFERENCES public.salaries(id);


--
-- TOC entry 5815 (class 2606 OID 90483)
-- Name: salary_payments salary_payments_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.salary_payments
    ADD CONSTRAINT salary_payments_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- TOC entry 5816 (class 2606 OID 90488)
-- Name: salary_payments salary_payments_paid_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.salary_payments
    ADD CONSTRAINT salary_payments_paid_by_user_id_fkey FOREIGN KEY (paid_by_user_id) REFERENCES public.users(id);


--
-- TOC entry 5813 (class 2606 OID 90464)
-- Name: salary_raises salary_raises_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.salary_raises
    ADD CONSTRAINT salary_raises_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);


--
-- TOC entry 5814 (class 2606 OID 90459)
-- Name: salary_raises salary_raises_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.salary_raises
    ADD CONSTRAINT salary_raises_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- TOC entry 5879 (class 2606 OID 205476)
-- Name: signal_type_responsibles signal_type_responsibles_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.signal_type_responsibles
    ADD CONSTRAINT signal_type_responsibles_type_id_fkey FOREIGN KEY (type_id) REFERENCES public.signal_types(id) ON DELETE CASCADE;


--
-- TOC entry 5874 (class 2606 OID 205644)
-- Name: signalisations signalisations_localisation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.signalisations
    ADD CONSTRAINT signalisations_localisation_id_fkey FOREIGN KEY (localisation_id) REFERENCES public.localisations(id) ON DELETE SET NULL;


--
-- TOC entry 5880 (class 2606 OID 205491)
-- Name: signalisations_status_history signalisations_status_history_signalisation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.signalisations_status_history
    ADD CONSTRAINT signalisations_status_history_signalisation_id_fkey FOREIGN KEY (signalisation_id) REFERENCES public.signalisations(id) ON DELETE CASCADE;


--
-- TOC entry 5875 (class 2606 OID 205501)
-- Name: signalisations signalisations_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.signalisations
    ADD CONSTRAINT signalisations_type_id_fkey FOREIGN KEY (type_id) REFERENCES public.signal_types(id) ON DELETE RESTRICT;


--
-- TOC entry 5881 (class 2606 OID 205506)
-- Name: signalisations_views signalisations_views_signalisation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.signalisations_views
    ADD CONSTRAINT signalisations_views_signalisation_id_fkey FOREIGN KEY (signalisation_id) REFERENCES public.signalisations(id) ON DELETE CASCADE;


--
-- TOC entry 5846 (class 2606 OID 180639)
-- Name: substitution_history substitution_history_absent_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.substitution_history
    ADD CONSTRAINT substitution_history_absent_employee_id_fkey FOREIGN KEY (absent_employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- TOC entry 5847 (class 2606 OID 180624)
-- Name: substitution_history substitution_history_invitation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.substitution_history
    ADD CONSTRAINT substitution_history_invitation_id_fkey FOREIGN KEY (invitation_id) REFERENCES public.substitution_invitations(id) ON DELETE CASCADE;


--
-- TOC entry 5848 (class 2606 OID 180629)
-- Name: substitution_history substitution_history_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.substitution_history
    ADD CONSTRAINT substitution_history_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.substitution_requests(id) ON DELETE CASCADE;


--
-- TOC entry 5849 (class 2606 OID 180634)
-- Name: substitution_history substitution_history_substitute_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.substitution_history
    ADD CONSTRAINT substitution_history_substitute_employee_id_fkey FOREIGN KEY (substitute_employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- TOC entry 5844 (class 2606 OID 172466)
-- Name: substitution_invitations substitution_invitations_candidate_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.substitution_invitations
    ADD CONSTRAINT substitution_invitations_candidate_employee_id_fkey FOREIGN KEY (candidate_employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- TOC entry 5845 (class 2606 OID 172461)
-- Name: substitution_invitations substitution_invitations_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.substitution_invitations
    ADD CONSTRAINT substitution_invitations_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.substitution_requests(id) ON DELETE CASCADE;


--
-- TOC entry 5842 (class 2606 OID 172440)
-- Name: substitution_requests substitution_requests_absent_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.substitution_requests
    ADD CONSTRAINT substitution_requests_absent_employee_id_fkey FOREIGN KEY (absent_employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- TOC entry 5843 (class 2606 OID 172445)
-- Name: substitution_requests substitution_requests_exception_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.substitution_requests
    ADD CONSTRAINT substitution_requests_exception_id_fkey FOREIGN KEY (exception_id) REFERENCES public.attendance_exceptions(id) ON DELETE CASCADE;


--
-- TOC entry 5882 (class 2606 OID 205516)
-- Name: suggestion_attachments suggestion_attachments_suggestion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.suggestion_attachments
    ADD CONSTRAINT suggestion_attachments_suggestion_id_fkey FOREIGN KEY (suggestion_id) REFERENCES public.suggestions(id) ON DELETE CASCADE;


--
-- TOC entry 5883 (class 2606 OID 205521)
-- Name: suggestion_attachments suggestion_attachments_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.suggestion_attachments
    ADD CONSTRAINT suggestion_attachments_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.employees(id);


--
-- TOC entry 5884 (class 2606 OID 205531)
-- Name: suggestion_history suggestion_history_suggestion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.suggestion_history
    ADD CONSTRAINT suggestion_history_suggestion_id_fkey FOREIGN KEY (suggestion_id) REFERENCES public.suggestions(id) ON DELETE CASCADE;


--
-- TOC entry 5885 (class 2606 OID 205536)
-- Name: suggestion_messages suggestion_messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.suggestion_messages
    ADD CONSTRAINT suggestion_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- TOC entry 5886 (class 2606 OID 205541)
-- Name: suggestion_messages suggestion_messages_suggestion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.suggestion_messages
    ADD CONSTRAINT suggestion_messages_suggestion_id_fkey FOREIGN KEY (suggestion_id) REFERENCES public.suggestions(id) ON DELETE CASCADE;


--
-- TOC entry 5887 (class 2606 OID 205556)
-- Name: suggestion_notifications suggestion_notifications_suggestion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.suggestion_notifications
    ADD CONSTRAINT suggestion_notifications_suggestion_id_fkey FOREIGN KEY (suggestion_id) REFERENCES public.suggestions(id) ON DELETE CASCADE;


--
-- TOC entry 5876 (class 2606 OID 205571)
-- Name: suggestions suggestions_handled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.suggestions
    ADD CONSTRAINT suggestions_handled_by_fkey FOREIGN KEY (handled_by) REFERENCES public.employees(id);


--
-- TOC entry 5877 (class 2606 OID 205576)
-- Name: suggestions suggestions_redirected_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.suggestions
    ADD CONSTRAINT suggestions_redirected_to_fkey FOREIGN KEY (redirected_to) REFERENCES public.departments(id);


--
-- TOC entry 5878 (class 2606 OID 205581)
-- Name: suggestions suggestions_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.suggestions
    ADD CONSTRAINT suggestions_type_id_fkey FOREIGN KEY (type_id) REFERENCES public.suggestion_types(id) ON DELETE SET NULL;


--
-- TOC entry 5796 (class 2606 OID 190512)
-- Name: tasks tasks_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.employees(id);


--
-- TOC entry 5797 (class 2606 OID 41229)
-- Name: tasks tasks_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.employees(id);


--
-- TOC entry 5799 (class 2606 OID 58153)
-- Name: timetable_intervals timetable_intervals_timetable_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.timetable_intervals
    ADD CONSTRAINT timetable_intervals_timetable_id_fkey FOREIGN KEY (timetable_id) REFERENCES public.timetables(id) ON DELETE CASCADE;


--
-- TOC entry 5866 (class 2606 OID 190517)
-- Name: user_sessions user_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


-- Completed on 2026-02-17 12:55:55

--
-- PostgreSQL database dump complete
--

