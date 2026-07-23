/**
 * Feature flags.
 *
 * REQUIRE_ACCOUNT — when true, customers must create a phone-verified account
 * (OTP) before ordering. Keep this false until an SMS provider is configured on
 * the Supabase project; while false the app is open and ordering uses a
 * background anonymous session. Flip to true (and enable an SMS provider +
 * anonymous sign-ins off) to turn the account gate on.
 */
export const REQUIRE_ACCOUNT = false;
