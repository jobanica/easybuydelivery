/**
 * Feature flags.
 *
 * REQUIRE_ACCOUNT — when true, riders must sign in with phone OTP. Keep this
 * false until an SMS provider is configured; while false the OTP screen is
 * hidden and a background anonymous session is used so riders can still apply
 * and (once approved) take orders. Flip to true to enable OTP sign-in.
 */
export const REQUIRE_ACCOUNT = false;

/** Operator hotline shown in rider Settings → Help (tap to call/message). */
export const SUPPORT_CONTACT = '0917 123 4567';

/** App version shown in Settings → About. */
export const APP_VERSION = '1.0.0';

/** Where "Terms & Privacy" points (the customer site for now). */
export const TERMS_URL = 'https://ebd-customer.vercel.app';
