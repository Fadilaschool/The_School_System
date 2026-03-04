-- Migration: Add Contract Management System
-- Date: 2025-01-XX
-- Description: Creates employee_identities table, enhances employee_contracts table,
--              and adds contract numbering system with automatic duration calculation

-- ============================================================================
-- Step 1: Create employee_identities table for ID card information
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.employee_identities (
    id UUID DEFAULT public.uuid_generate_v4() PRIMARY KEY,
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    id_card_number VARCHAR(100) NOT NULL,
    id_issue_date DATE NOT NULL,
    id_issue_authority VARCHAR(255) NOT NULL, -- e.g., دائرة أولاد موسى ولاية بومرداس
    arabic_place_of_birth VARCHAR(255),
    arabic_address TEXT,
    arabic_nationality VARCHAR(100) DEFAULT 'جزائرية',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_employee_identity UNIQUE (employee_id)
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_employee_identities_employee_id ON public.employee_identities(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_identities_id_card_number ON public.employee_identities(id_card_number);

-- Add comments
COMMENT ON TABLE public.employee_identities IS 'Stores legal/ID card information for employees in Arabic';
COMMENT ON COLUMN public.employee_identities.id_card_number IS 'National ID card number';
COMMENT ON COLUMN public.employee_identities.id_issue_date IS 'Date when ID card was issued';
COMMENT ON COLUMN public.employee_identities.id_issue_authority IS 'Authority that issued the ID card (e.g., دائرة أولاد موسى ولاية بومرداس)';
COMMENT ON COLUMN public.employee_identities.arabic_place_of_birth IS 'Place of birth in Arabic';
COMMENT ON COLUMN public.employee_identities.arabic_address IS 'Address in Arabic';
COMMENT ON COLUMN public.employee_identities.arabic_nationality IS 'Nationality in Arabic (default: جزائرية)';

-- ============================================================================
-- Step 2: Create sequence for contract numbering
-- ============================================================================
CREATE SEQUENCE IF NOT EXISTS contract_number_seq START 1;

-- ============================================================================
-- Step 3: Enhance employee_contracts table
-- ============================================================================
ALTER TABLE public.employee_contracts
    ADD COLUMN IF NOT EXISTS contract_number VARCHAR(50) UNIQUE,
    ADD COLUMN IF NOT EXISTS duration_months INTEGER,
    ADD COLUMN IF NOT EXISTS probation_months INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS contract_salary NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS document_path TEXT;

-- Create index for contract_number
CREATE INDEX IF NOT EXISTS idx_employee_contracts_contract_number ON public.employee_contracts(contract_number);

-- Add comments
COMMENT ON COLUMN public.employee_contracts.contract_number IS 'Unique contract number (format: 00012026)';
COMMENT ON COLUMN public.employee_contracts.duration_months IS 'Contract duration in months (auto-calculated)';
COMMENT ON COLUMN public.employee_contracts.probation_months IS 'Probation period in months (default: 0)';
COMMENT ON COLUMN public.employee_contracts.contract_salary IS 'Salary specific to this contract';
COMMENT ON COLUMN public.employee_contracts.document_path IS 'Path to generated contract document (PDF/Docx)';

-- ============================================================================
-- Step 4: Create function for automatic duration calculation
-- ============================================================================
CREATE OR REPLACE FUNCTION calculate_contract_duration()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.start_date IS NOT NULL AND NEW.end_date IS NOT NULL THEN
        NEW.duration_months := (EXTRACT(year FROM age(NEW.end_date, NEW.start_date)) * 12) + 
                               EXTRACT(month FROM age(NEW.end_date, NEW.start_date));
    ELSIF NEW.start_date IS NOT NULL AND NEW.end_date IS NULL THEN
        -- For open-ended contracts, calculate from start_date to current date
        NEW.duration_months := (EXTRACT(year FROM age(CURRENT_DATE, NEW.start_date)) * 12) + 
                               EXTRACT(month FROM age(CURRENT_DATE, NEW.start_date));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Step 5: Create trigger for automatic duration calculation
-- ============================================================================
DROP TRIGGER IF EXISTS trg_calculate_contract_duration ON public.employee_contracts;
CREATE TRIGGER trg_calculate_contract_duration
BEFORE INSERT OR UPDATE ON public.employee_contracts
FOR EACH ROW EXECUTE FUNCTION calculate_contract_duration();

-- ============================================================================
-- Step 6: Create function to generate contract number
-- ============================================================================
CREATE OR REPLACE FUNCTION generate_contract_number(contract_start_date DATE)
RETURNS VARCHAR(50) AS $$
DECLARE
    seq_val INTEGER;
    year_val INTEGER;
    contract_num VARCHAR(50);
BEGIN
    -- Get next sequence value
    seq_val := nextval('contract_number_seq');
    
    -- Get year from start date
    year_val := EXTRACT(YEAR FROM contract_start_date);
    
    -- Format: 4-digit sequence + year (e.g., 00012026)
    contract_num := LPAD(seq_val::TEXT, 4, '0') || year_val::TEXT;
    
    RETURN contract_num;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Step 7: Create function to update updated_at timestamp
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for employee_identities updated_at
DROP TRIGGER IF EXISTS trg_update_employee_identities_updated_at ON public.employee_identities;
CREATE TRIGGER trg_update_employee_identities_updated_at
BEFORE UPDATE ON public.employee_identities
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Verification queries (commented out - run manually to verify)
-- ============================================================================
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'employee_identities';
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'employee_contracts';
-- SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public' AND sequence_name = 'contract_number_seq';
