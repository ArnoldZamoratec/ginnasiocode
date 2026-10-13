import type { MembershipState } from './format.ts';

export interface Freeze { id: number; start_date: string; end_date: string; reason: string; ended_early_at: string | null }
export interface Membership {
  id: number; memberId: number; planId: number; planName: string; includesClasses: boolean;
  startDate: string; endDate: string; status: 'active' | 'replaced' | 'cancelled'; state: MembershipState;
  daysLeft: number | null; frozenUntil: string | null; totalDays: number;
  listPriceCents: number; creditCents: number; amountDueCents: number; paidCents: number; balanceCents: number;
  freezes: Freeze[]; freezeDaysUsed: number; freezeDaysAllowed: number; planActive: boolean; replacesId: number | null; createdAt: string;
}
export interface Debt { totalCents: number; items: { membershipId: number; plan: string; startDate: string; endDate: string; amountDueCents: number; paidCents: number; balanceCents: number }[] }
export interface Plan { id: number; name: string; description: string; duration_days: number; price_cents: number; includes_classes: boolean; max_freeze_days: number; active: boolean }

export interface MemberListItem {
  id: number; fullName: string; firstName: string; lastName: string; dni: string; phone: string | null; email: string | null;
  trainerName: string | null; state: MembershipState; planName: string | null; endDate: string | null; daysLeft: number | null;
  debtCents: number; lastVisit: string | null;
}
export interface MemberDetail {
  member: {
    id: number; firstName: string; lastName: string; fullName: string; dni: string; dniMasked: boolean; email: string | null; phone: string | null;
    birthDate: string | null; emergencyContact: string | null; healthNotes: string | null; healthRestricted: boolean;
    trainerId: number | null; trainerName: string | null; homeBranchId: number | null; hasAccount: boolean; createdAt: string;
  };
  membership: Membership | null;
  debt: Debt | null;
  stats: { visitsLast30: number };
}

export interface Payment {
  id: number; receipt_number: string; member_id: number | null; membership_id: number | null; concept: string; amount_cents: number;
  method: 'cash' | 'card' | 'transfer'; reference: string | null; paid_at: string; status: 'valid' | 'voided';
  voided_at: string | null; void_reason: string | null; member_name: string | null; received_by_name: string | null; voided_by_name: string | null;
  received_by: number | null;
}

export interface CheckInResult {
  result: 'granted' | 'denied'; reason: string | null; message: string; duplicate: boolean; visitId: number; checkedInAt: string; method: string;
  member: { id: number; fullName: string; dni: string; initials: string; trainerName: string | null };
  membership: Membership | null; debtCents: number; warnings: { code: string; message: string }[];
  classesToday: { className: string; time: string; status: string }[];
}

export interface Session {
  id: number; className: string; intensity: number; branchId: number; branchName: string; trainerId: number | null; trainerName: string | null;
  startsAt: string; endsAt: string; room: string; capacity: number; booked: number; waitlist: number; spotsLeft: number;
  status: 'scheduled' | 'cancelled'; cancelReason: string | null;
  myReservation: { id: number; status: string; waitlistPosition: number | null } | null;
  roster?: { id: number; status: string; member_id: number; full_name: string; late_cancel: number; waitlist_at: string | null; promoted_at: string | null }[];
}

export interface Exercise { id: number; name: string; muscle_group: string; equipment: string; instructions: string }
export interface RoutineItem { id?: number; day_label: string; position?: number; exercise_id: number; exercise_name: string; muscle_group: string; equipment?: string; sets: number; reps: string; target_kg: number | null; rest_sec: number; notes: string | null }
export interface Routine { id: number; name: string; goal: string; member_id: number | null; trainer_id: number | null; trainer_name?: string; based_on_id: number | null; active: boolean; isTemplate: boolean; days: string[]; items: RoutineItem[]; created_at: string }
export interface WorkoutSet { id: number; exercise_id: number; exercise_name: string; set_number: number; reps: number; weight_kg: number; rpe: number | null; created_at: string }
export interface Workout {
  id: number; member_id: number; routine_id: number | null; day_label: string | null; started_at: string; finished_at: string | null; notes: string | null; routine_name: string | null;
  sets: WorkoutSet[]; plan: RoutineItem[]; previous: Record<string, { weight_kg: number; reps: number; started_at: string } | null>;
  summary?: { sets: number; volumeKg: number; exercises: number };
}
export interface Measurement { id: number; measured_on: string; weight_kg: number | null; body_fat_pct: number | null; chest_cm: number | null; waist_cm: number | null; hip_cm: number | null; arm_cm: number | null; thigh_cm: number | null; recorded_by_name: string | null }

export interface Staff { id: number; email: string; role: 'reception' | 'trainer' | 'admin'; full_name: string; phone: string | null; branch_id: number | null; branch_name: string | null; active: boolean; assigned_members: number }
