-- Migration: Add fields for document generation (Attestation de Travail and Certificat de Travail)
-- Date: 2025-01-XX
-- Description: Adds necessary fields to employees and branches tables, and creates employee_contracts table

-- Step A: Modify employees Table
-- Add Place of Birth and Social Security Number
ALTER TABLE public.employees
ADD COLUMN IF NOT EXISTS place_of_birth VARCHAR(255),
ADD COLUMN IF NOT EXISTS social_security_number VARCHAR(50);

-- Step B: Modify branches Table
-- Add address, wilaya, and registration_number (N° Adhérent)
ALTER TABLE public.branches
ADD COLUMN IF NOT EXISTS address TEXT,
ADD COLUMN IF NOT EXISTS wilaya VARCHAR(100),
ADD COLUMN IF NOT EXISTS registration_number VARCHAR(100);

-- Step C: Create New employee_contracts Table (The "Act" Table)
-- This table stores contract history for employees, supporting multiple contracts over time
-- and the "Du... Au..." (From... To...) logic in the Certificate
CREATE TABLE IF NOT EXISTS public.employee_contracts (
    id UUID DEFAULT public.uuid_generate_v4() PRIMARY KEY,
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    position_id UUID REFERENCES public.positions(id), -- The position held during this specific contract
    start_date DATE NOT NULL,
    end_date DATE, -- Keep NULL if they are currently employed (for ATS "à ce jour")
    contract_type VARCHAR(50), -- Optional: e.g., 'CDI', 'CDD', 'CIVP'
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_employee_contracts_employee_id ON public.employee_contracts(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_contracts_start_date ON public.employee_contracts(start_date);
CREATE INDEX IF NOT EXISTS idx_employee_contracts_is_active ON public.employee_contracts(is_active);

-- Add comment to table
COMMENT ON TABLE public.employee_contracts IS 'Stores employee contract history. Each contract represents a period of employment with a specific position. NULL end_date indicates current/active contract.';

-- Add comments to columns
COMMENT ON COLUMN public.employees.place_of_birth IS 'Place of birth of the employee (e.g., "EL HAMMAMAT")';
COMMENT ON COLUMN public.employees.social_security_number IS 'Social security number (e.g., "00 1076 0037 64")';
COMMENT ON COLUMN public.branches.address IS 'Full address of the branch (e.g., "Cité BENADJEL (20 août) BOUDOUAOU")';
COMMENT ON COLUMN public.branches.wilaya IS 'Wilaya (province) where the branch is located (e.g., "BOUMERDES")';
COMMENT ON COLUMN public.branches.registration_number IS 'Registration number (N° Adhérent) of the branch (e.g., "35370248 57")';
