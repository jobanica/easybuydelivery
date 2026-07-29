/**
 * Feature flags.
 *
 * REQUIRE_ACCOUNT — when true, riders must sign in with phone OTP. Keep this
 * false until an SMS provider is configured; while false the OTP screen is
 * hidden and a background anonymous session is used so riders can still apply
 * and (once approved) take orders. Flip to true to enable OTP sign-in.
 */
export const REQUIRE_ACCOUNT = false;
