export const signInErrors = {
  account: 'Choose the Google account approved for this StoryCursor deployment.',
  exchange: 'Google could not verify this sign-in. Start a new sign-in from StoryCursor.',
  expired: 'This sign-in has expired or was already used. Start again.',
  cancelled: 'Google sign-in was cancelled. You can try again.',
  busy: 'StoryCursor is busy. Try signing in again.',
  'service-client': 'The deployment owner needs to check the Google client credentials and redirect URL.',
  'service-permission': 'The deployment owner needs to authorize external requests in Apps Script.',
  service: 'StoryCursor could not contact Google to verify your account. Try again.',
};

export function signInError(reason: unknown) {
  return typeof reason === 'string' && Object.hasOwn(signInErrors, reason)
    ? signInErrors[reason as keyof typeof signInErrors] : 'Google sign-in could not finish.';
}
